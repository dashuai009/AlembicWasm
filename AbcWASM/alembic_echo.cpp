#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

// Alembic includes for WASM
#include <Alembic/Abc/TypedPropertyTraits.h>
#include <Alembic/AbcCoreAbstract/All.h>
#include <Alembic/AbcCoreFactory/All.h>
#include <Alembic/AbcCoreOgawa/All.h>
#include <Alembic/AbcGeom/All.h>
#include <Alembic/Util/All.h>

#include <cassert>
#include <memory>

// Function to read and return the structure of an Alembic file as a string from
// filename
std::string read_alembic_structure(const std::string &filename);

// Function to read and return the structure of an Alembic file as a string from
// memory buffer
std::string
read_alembic_structure_from_memory(const std::vector<std::uint8_t> &buffer);

// // Function returns mesh vertex data as a vector of floats
// [x1,y1,z1,x2,y2,z2,...] std::vector<float> get_mesh_vertices(const
// std::string& filename);

// Function returns a structured representation of the top-level object from
// memory buffer
std::string
get_alembic_top_object_from_memory(const std::vector<std::uint8_t> &buffer);

// Custom stream buffer that reads from a memory buffer
class MemoryBufferStreamBuf : public std::streambuf {
  public:
    MemoryBufferStreamBuf(const std::vector<std::uint8_t> &buffer)
        : buffer_(buffer) {
        char *base = (char *)buffer_.data();
        setg(base, base, base + buffer_.size());
    }

  protected:
    pos_type seekoff(off_type off, std::ios_base::seekdir way,
                     std::ios_base::openmode which) override {
        if (!(which & std::ios_base::in))
            return pos_type(off_type(-1));

        char *begin = eback();
        char *end = egptr();
        char *cur = gptr();

        char *newpos = nullptr;
        if (way == std::ios_base::beg)
            newpos = begin + off;
        else if (way == std::ios_base::cur)
            newpos = cur + off;
        else if (way == std::ios_base::end)
            newpos = end + off;

        if (newpos < begin || newpos > end)
            return pos_type(off_type(-1));
        setg(begin, newpos, end);
        return pos_type(newpos - begin);
    }

    pos_type seekpos(pos_type sp, std::ios_base::openmode which) override {
        return seekoff(off_type(sp), std::ios_base::beg, which);
    }

  private:
    const std::vector<std::uint8_t> &buffer_;
};

// Custom input stream that wraps the memory buffer
class MemoryBufferInputStream : public std::istream {
  public:
    MemoryBufferInputStream(const std::vector<std::uint8_t> &buffer)
        : std::istream(&buffer_streambuf_), buffer_streambuf_(buffer) {
        rdbuf(&buffer_streambuf_);
    }

  private:
    MemoryBufferStreamBuf buffer_streambuf_;
};

using namespace emscripten;
using namespace ::Alembic::AbcGeom;
using namespace ::Alembic::AbcCoreAbstract;

static const std::string g_sep(";");

// Forward declarations for helper functions
void visitProperties(Alembic::Abc::ICompoundProperty, std::stringstream &,
                     const std::string &);
void visitCompoundProperty(Alembic::Abc::ICompoundProperty iProp,
                           std::stringstream &result,
                           const std::string &indent);

template <class PROP>
void visitSimpleScalarProperty(PROP iProp, std::stringstream &result,
                               const std::string &indent) {
    std::string ptype = "ScalarProperty ";
    size_t asize = 0;

    const Alembic::AbcCoreAbstract::DataType &dt = iProp.getDataType();
    const Alembic::Util::uint8_t extent = dt.getExtent();
    Alembic::Util::Dimensions dims(extent);
    Alembic::AbcCoreAbstract::ArraySamplePtr samp =
        Alembic::AbcCoreAbstract::AllocateArraySample(dt, dims);
    Alembic::Abc::index_t maxSamples = iProp.getNumSamples();
    for (Alembic::Abc::index_t i = 0; i < maxSamples; ++i) {
        iProp.get(const_cast<void *>(samp->getData()),
                  Alembic::Abc::ISampleSelector(i));
        asize = samp->size();
    }

    std::string mdstring = "interpretation=";
    mdstring += iProp.getMetaData().get("interpretation");

    std::stringstream dtype;
    dtype << "datatype=";
    dtype << dt;

    std::stringstream asizestr;
    asizestr << g_sep << "arraysize=";
    asizestr << asize;

    mdstring += g_sep;
    mdstring += dtype.str();
    mdstring += asizestr.str();

    result << indent << "  " << ptype << "name=" << iProp.getName() << g_sep
           << mdstring << g_sep << "numsamps=" << iProp.getNumSamples()
           << std::endl;
}

template <class PROP>
void visitSimpleArrayProperty(PROP iProp, std::stringstream &result,
                              const std::string &indent) {
    std::string ptype = "ArrayProperty ";
    size_t asize = 0;

    Alembic::AbcCoreAbstract::ArraySamplePtr samp;
    Alembic::Abc::index_t maxSamples = iProp.getNumSamples();
    for (Alembic::Abc::index_t i = 0; i < maxSamples; ++i) {
        iProp.get(samp, Alembic::Abc::ISampleSelector(i));
        asize = samp->size();
    }

    std::string mdstring = "interpretation=";
    mdstring += iProp.getMetaData().get("interpretation");

    std::stringstream dtype;
    dtype << "datatype=";
    dtype << iProp.getDataType();

    std::stringstream asizestr;
    asizestr << g_sep << "arraysize=";
    asizestr << asize;

    mdstring += g_sep;
    mdstring += dtype.str();
    mdstring += asizestr.str();

    result << indent << "  " << ptype << "name=" << iProp.getName() << g_sep
           << mdstring << g_sep << "numsamps=" << iProp.getNumSamples()
           << std::endl;
}

void visitProperties(Alembic::Abc::ICompoundProperty iParent,
                     std::stringstream &result, const std::string &indent) {
    for (size_t i = 0; i < iParent.getNumProperties(); i++) {
        Alembic::Abc::PropertyHeader header = iParent.getPropertyHeader(i);

        if (header.isCompound()) {
            Alembic::Abc::ICompoundProperty prop(iParent, header.getName());
            visitCompoundProperty(prop, result, indent + "  ");
        } else if (header.isScalar()) {
            Alembic::Abc::IScalarProperty prop(iParent, header.getName());
            visitSimpleScalarProperty(prop, result, indent);
        } else {
            assert(header.isArray());
            Alembic::Abc::IArrayProperty prop(iParent, header.getName());
            visitSimpleArrayProperty(prop, result, indent);
        }
    }
}

void visitCompoundProperty(Alembic::Abc::ICompoundProperty iProp,
                           std::stringstream &result,
                           const std::string &indent) {
    std::string interp = "schema=";
    interp += iProp.getMetaData().get("schema");

    result << indent << "CompoundProperty " << "name=" << iProp.getName()
           << g_sep << interp << std::endl;

    visitProperties(iProp, result, indent + "  ");
}

// Enhanced function to specifically handle geometric objects and extract vertex
// data
void visitGeoObject(Alembic::Abc::IObject iObj, std::stringstream &result,
                    const std::string &indent) {
    std::string path = iObj.getFullName();
    std::string schema = iObj.getMetaData().get("schema");

    if (path != "/") {
        result << "Object " << "name=" << path << g_sep << "schema=" << schema
               << std::endl;
    }

    // Try to identify if this object is a geometric type and extract its data
    if (iObj.getMetaData().get("schema") == "AbcGeom_PolyMesh_v2") {
        // Handle PolyMesh geometry
        try {
            Alembic::AbcGeom::IPolyMesh pmesh(iObj,
                                              Alembic::Abc::kWrapExisting);
            Alembic::AbcGeom::IPolyMeshSchema pmeshSchema = pmesh.getSchema();

            // Extract vertex positions
            Alembic::Abc::P3fArraySamplePtr posSample;
            pmeshSchema.getPositionsProperty().get(posSample);

            // Output vertex count info
            if (posSample) {
                result << indent
                       << "  Geometry vertex_count=" << posSample->size()
                       << std::endl;
            }

            // Extract face counts and indices if they exist
            Alembic::Abc::Int32ArraySamplePtr faceIndices;
            pmeshSchema.getFaceIndicesProperty().get(faceIndices);

            Alembic::Abc::Int32ArraySamplePtr faceCounts;
            pmeshSchema.getFaceCountsProperty().get(faceCounts);

            if (faceIndices && faceCounts) {
                result << indent
                       << "  Geometry face_count=" << faceCounts->size()
                       << std::endl;
            }

        } catch (const std::exception &e) {
            result << indent << "  Error parsing PolyMesh: " << e.what()
                   << std::endl;
        }
    } else if (iObj.getMetaData().get("schema") == "AbcGeom_Points_v1") {
        // Handle point cloud
        try {
            Alembic::AbcGeom::IPoints pts(iObj, Alembic::Abc::kWrapExisting);
            Alembic::AbcGeom::IPointsSchema ptsSchema = pts.getSchema();

            Alembic::Abc::P3fArraySamplePtr posSample;
            ptsSchema.getPositionsProperty().get(posSample);

            if (posSample) {
                result << indent
                       << "  Geometry points_count=" << posSample->size()
                       << std::endl;
            }
        } catch (const std::exception &e) {
            result << indent << "  Error parsing Points: " << e.what()
                   << std::endl;
        }
    } else if (iObj.getMetaData().get("schema") == "AbcGeom_Curve_v2") {
        // Handle curves
        try {
            Alembic::AbcGeom::ICurves curvesObj(iObj,
                                                Alembic::Abc::kWrapExisting);
            Alembic::AbcGeom::ICurvesSchema curveSchema = curvesObj.getSchema();

            Alembic::Abc::P3fArraySamplePtr posSample;
            curveSchema.getPositionsProperty().get(posSample);

            if (posSample) {
                result << indent
                       << "  Geometry curve_points_count=" << posSample->size()
                       << std::endl;
            }
        } catch (const std::exception &e) {
            result << indent << "  Error parsing Curves: " << e.what()
                   << std::endl;
        }
    }

    // Visit child objects
    for (size_t i = 0; i < iObj.getNumChildren(); i++) {
        Alembic::Abc::IObject child(iObj, iObj.getChildHeader(i).getName());
        visitGeoObject(child, result, indent);
    }
}

std::string read_alembic_structure(const std::string &filename) {
    std::stringstream result;

    result << "AbcEcho for Alembic WASM Module\\n";
    result << "  Processing file from filesystem: " << filename << "\\n";

    try {
        // Use factory to create archive from file
        Alembic::AbcCoreFactory::IFactory factory;
        factory.setPolicy(Alembic::Abc::ErrorHandler::kQuietNoopPolicy);
        Alembic::Abc::IArchive archive = factory.getArchive(filename);

        if (archive) {
            result << "  Abc version: "
                   << Alembic::AbcCoreAbstract::GetLibraryVersion() << "\\n\\n";

            // Get archive info
            std::string appName;
            std::string libraryVersionString;
            Alembic::Util::uint32_t libraryVersion;
            std::string whenWritten;
            std::string userDescription;
            Alembic::Abc::GetArchiveInfo(archive, appName, libraryVersionString,
                                         libraryVersion, whenWritten,
                                         userDescription);

            if (!appName.empty()) {
                result << "  file written by: " << appName << std::endl;
                result << "  using Alembic : " << libraryVersionString
                       << std::endl;
                result << "  written on : " << whenWritten << std::endl;
                result << "  user description : " << userDescription
                       << std::endl;
                result << std::endl;
            } else {
                result << "  (file doesn't have any ArchiveInfo)" << std::endl;
                result << std::endl;
            }

            visitGeoObject(archive.getTop(), result, "");
        } else {
            result << "  Error: Could not open file " << filename << "\\n";
        }
    } catch (const std::exception &e) {
        result << "  Error: " << e.what() << "\\n";
    }

    return result.str();
}

// Enhanced memory-based reader that also gets geometry data
std::string
read_alembic_structure_from_memory(const std::vector<std::uint8_t> &buffer) {
    std::stringstream result;

    result << "AbcEcho for Alembic WASM Module\\n";
    result << "  Processing file from memory buffer: " << buffer.size()
           << " bytes\\n";

    if (buffer.empty()) {
        result << "  Error: Empty buffer received.\\n";
        return result.str();
    }

    try {
        using namespace Alembic::AbcCoreFactory;

        // Create an input stream from our buffer
        MemoryBufferInputStream memoryStream(buffer);
        memoryStream.clear();
        memoryStream.seekg(0, std::ios::beg);
        std::vector<std::istream *> streams;

        streams.push_back(&memoryStream);

        // Create factory
        IFactory factory;
        factory.setPolicy(Alembic::Abc::ErrorHandler::kQuietNoopPolicy);

        // Use streams to create archive
        IFactory::CoreType coreType;
        Alembic::Abc::IArchive archive = factory.getArchive(streams, coreType);

        if (archive && coreType != IFactory::kUnknown) {
            result << "  Abc version: "
                   << Alembic::AbcCoreAbstract::GetLibraryVersion() << "\\n\\n";

            // Get archive info
            std::string appName;
            std::string libraryVersionString;
            Alembic::Util::uint32_t libraryVersion;
            std::string whenWritten;
            std::string userDescription;
            Alembic::Abc::GetArchiveInfo(archive, appName, libraryVersionString,
                                         libraryVersion, whenWritten,
                                         userDescription);

            if (!appName.empty()) {
                result << "  file written by: " << appName << std::endl;
                result << "  using Alembic : " << libraryVersionString
                       << std::endl;
                result << "  written on : " << whenWritten << std::endl;
                result << "  user description : " << userDescription
                       << std::endl;
                result << std::endl;
            } else {
                result << "  (file doesn't have any ArchiveInfo)" << std::endl;
                result << std::endl;
            }

            visitGeoObject(archive.getTop(), result, "");
        } else {
            result << "  Error: Could not create valid Alembic archive from "
                      "memory buffer\\n";
        }
    } catch (const Alembic::Util::Exception &e) {
        result << "  Error: Alembic exception occurred: " << e.what() << "\\n";
    } catch (const std::exception &e) {
        result << "  Error: " << e.what() << "\\n";
    } catch (...) {
        result << "  Error: Unknown error occurred while parsing buffer\\n";
    }

    return result.str();
}
//
// // For actual vertex data extraction, we need a more complex function
// std::vector<float> get_mesh_vertices(const std::string &filename) {
//     std::vector<float> vertices;
//
//     try {
//         Alembic::AbcCoreFactory::IFactory factory;
//         factory.setPolicy(Alembic::Abc::ErrorHandler::kQuietNoopPolicy);
//         Alembic::Abc::IArchive archive = factory.getArchive(filename);
//
//         if (archive) {
//             Alembic::Abc::IObject top = archive.getTop();
//
//             // Recursive function to find PolyMesh objects and extract vertex
//             // data
//             std::function<void(Alembic::Abc::IObject, std::vector<float> &)>
//                 extractVertices = [&](Alembic::Abc::IObject obj,
//                                       std::vector<float> &verts) {
//                     // Check if this is a PolyMesh
//                     if (obj.getMetaData().get("schema") ==
//                         "AbcGeom_PolyMesh_v2") {
//                         try {
//                             Alembic::AbcGeom::IPolyMesh pmesh(
//                                 obj, Alembic::Abc::kWrapExisting);
//                             Alembic::AbcGeom::IPolyMeshSchema pmeshSchema =
//                                 pmesh.getSchema();
//
//                             Alembic::Abc::P3fArraySamplePtr posSample;
//                             pmeshSchema.getPositionsProperty().get(posSample);
//
//                             // Add all vertex positions to the vector
//                             if (posSample) {
//                                 size_t numPoints = posSample->size();
//                                 for (size_t i = 0; i < numPoints; ++i) {
//                                     Alembic::Abc::V3f v = (*posSample)[i];
//                                     verts.push_back(v.x);
//                                     verts.push_back(v.y);
//                                     verts.push_back(v.z);
//                                 }
//                             }
//                         } catch (...) {
//                             // If PolyMesh parsing fails, continue with
//                             children
//                         }
//                     }
//
//                     // Visit child objects
//                     for (size_t i = 0; i < obj.getNumChildren(); i++) {
//                         Alembic::Abc::IObject child(
//                             obj, obj.getChildHeader(i).getName());
//                         extractVertices(child, verts);
//                     }
//                 };
//
//             extractVertices(top, vertices);
//         }
//     } catch (...) {
//         // Error occurred, return empty vertices vector
//     }
//
//     return vertices;
// }

// Memory version of getting mesh vertices
std::vector<float>
get_mesh_vertices_from_memory(const std::vector<std::uint8_t> &buffer) {
    std::vector<float> vertices;

    try {
        using namespace Alembic::AbcCoreFactory;

        // The MemoryBufferInputStream is already defined in the file
        MemoryBufferInputStream memoryStream(buffer);
        memoryStream.clear();                 // Clear failbit/eofbit
        memoryStream.seekg(0, std::ios::beg); // Position to beginning
        std::vector<std::istream *> streams;

        streams.push_back(&memoryStream);

        // Create factory
        IFactory factory;
        factory.setPolicy(Alembic::Abc::ErrorHandler::kQuietNoopPolicy);

        // Use streams to create archive
        IFactory::CoreType coreType;
        Alembic::Abc::IArchive archive = factory.getArchive(streams, coreType);

        if (archive && coreType != IFactory::kUnknown) {
            Alembic::Abc::IObject top = archive.getTop();

            // Recursive function to find PolyMesh objects and extract vertex
            // data
            std::function<void(Alembic::Abc::IObject, std::vector<float> &)>
                extractVertices = [&](Alembic::Abc::IObject obj,
                                      std::vector<float> &verts) {
                    // Check if this is a PolyMesh
                    if (obj.getMetaData().get("schema") ==
                        "AbcGeom_PolyMesh_v1") {
                        try {
                            Alembic::AbcGeom::IPolyMesh pmesh(
                                obj, Alembic::Abc::kWrapExisting);
                            Alembic::AbcGeom::IPolyMeshSchema pmeshSchema =
                                pmesh.getSchema();

                            Alembic::Abc::P3fArraySamplePtr posSample;
                            pmeshSchema.getPositionsProperty().get(posSample);

                            // Add all vertex positions to the vector
                            if (posSample) {
                                size_t numPoints = posSample->size();
                                for (size_t i = 0; i < numPoints; ++i) {
                                    Alembic::Abc::V3f v = (*posSample)[i];
                                    verts.push_back(v.x);
                                    verts.push_back(v.y);
                                    verts.push_back(v.z);
                                }
                            }
                        } catch (...) {
                            // If PolyMesh parsing fails, continue with children
                        }
                    } else {
                        std::cout << obj.getMetaData().get("schema") << "\n";
                    }

                    // Visit child objects
                    for (size_t i = 0; i < obj.getNumChildren(); i++) {
                        Alembic::Abc::IObject child(
                            obj, obj.getChildHeader(i).getName());
                        extractVertices(child, verts);
                    }
                };

            extractVertices(top, vertices);
        }
    } catch (...) {
        // Error occurred, return empty vertices vector
    }

    std::cout << vertices.size() << "adfasdf\n";
    return vertices;
}

std::string
get_alembic_top_object_from_memory(const std::vector<std::uint8_t> &buffer) {
    std::stringstream result;

    result << "Top Object from AbcEcho for Alembic WASM Module\n";
    result << "  Processing top object from memory buffer: " << buffer.size()
           << " bytes\n";

    if (buffer.empty()) {
        result << "  Error: Empty buffer received.\n";
        return result.str();
    }

    try {
        using namespace Alembic::AbcCoreFactory;

        // Create an input stream from our buffer
        MemoryBufferInputStream memoryStream(buffer);
        memoryStream.clear();
        memoryStream.seekg(0, std::ios::beg);
        std::vector<std::istream *> streams;

        streams.push_back(&memoryStream);

        // Create factory
        IFactory factory;
        factory.setPolicy(Alembic::Abc::ErrorHandler::kQuietNoopPolicy);

        // Use streams to create archive
        IFactory::CoreType coreType;
        Alembic::Abc::IArchive archive = factory.getArchive(streams, coreType);

        if (archive && coreType != IFactory::kUnknown) {
            // Get the top object directly
            Alembic::Abc::IObject topObject = archive.getTop();

            result << "  Top object name: " << topObject.getName() << "\n";
            result << "  Top object full name: " << topObject.getFullName()
                   << "\n";
            result << "  Top object metadata: "
                   << topObject.getMetaData().get("schema") << "\n";
            result << "  Number of children: " << topObject.getNumChildren()
                   << "\n";

            // Get additional archive info
            std::string appName;
            std::string libraryVersionString;
            Alembic::Util::uint32_t libraryVersion;
            std::string whenWritten;
            std::string userDescription;
            Alembic::Abc::GetArchiveInfo(archive, appName, libraryVersionString,
                                         libraryVersion, whenWritten,
                                         userDescription);

            if (!appName.empty()) {
                result << "  file written by: " << appName << std::endl;
                result << "  using Alembic : " << libraryVersionString
                       << std::endl;
                result << "  written on : " << whenWritten << std::endl;
                result << "  user description : " << userDescription
                       << std::endl;
            } else {
                result << "  (file doesn't have any ArchiveInfo)" << std::endl;
            }
        } else {
            result << "  Error: Could not create valid Alembic archive from "
                      "memory buffer\n";
        }
    } catch (const Alembic::Util::Exception &e) {
        result << "  Error: Alembic exception occurred: " << e.what() << "\n";
    } catch (const std::exception &e) {
        result << "  Error: " << e.what() << "\n";
    } catch (...) {
        result << "  Error: Unknown error occurred while parsing buffer\n";
    }

    return result.str();
}

// Implement constructor for AlembicObjectHandle
std::optional<IObject>
InitTopAlembicObject(MemoryBufferInputStream &memoryStream) {

    try {
        using namespace Alembic::AbcCoreFactory;

        memoryStream.clear();
        memoryStream.seekg(0, std::ios::beg);
        std::vector<std::istream *> streams;

        streams.push_back(&memoryStream);

        // Create factory
        IFactory factory;
        factory.setPolicy(Alembic::Abc::ErrorHandler::kQuietNoopPolicy);

        // Use streams to create archive
        IFactory::CoreType coreType;
        Alembic::Abc::IArchive archive = factory.getArchive(streams, coreType);

        if (archive && coreType != IFactory::kUnknown) {
            // Get the top object
            return archive.getTop();
        }
    } catch (...) {
        return std::nullopt;
    }
    return std::nullopt;
}

std::optional<Alembic::AbcGeom::M44d> xformGetMatrix(const IObject &iObj) {
    if (iObj.getMetaData().get("schema") == "AbcGeom_Xform_v3" ||
        iObj.getMetaData().get("schema") == "AbcGeom_Xform_v2" ||
        iObj.getMetaData().get("schema") == "AbcGeom_Xform_v1") {
        try {
            Alembic::AbcGeom::IXform xformObj(iObj,
                                              Alembic::Abc::kWrapExisting);
            Alembic::AbcGeom::IXformSchema xSchema = xformObj.getSchema();

            // // 是否是恒定变换（不随时间变化）
            // bool isConst = xSchema.isConstant();

            // // 当前时间采样数量（有动画时会 >1）
            // size_t numSamples = xSchema.getNumSamples();

            // 取某个采样（这里取第0帧；你也可以按时间取）
            Alembic::AbcGeom::XformSample xs;
            xSchema.get(xs, 0);

            // 直接拿 4x4 矩阵
            Alembic::AbcGeom::M44d m = xs.getMatrix();

            // // 是否“继承父变换”（常用信息）
            // bool inherits = xSchema.getInheritsXforms();

            return {m};
        } catch (const std::exception &e) {
            std::cout << "  Error parsing Xform: " << e.what() << "\n";
        }
    }
    return {};
}

std::vector<float> get_mesh_vertices(const IObject &obj) {
    std::vector<float> verts;
    Alembic::AbcGeom::IPolyMesh pmesh(obj, Alembic::Abc::kWrapExisting);
    Alembic::AbcGeom::IPolyMeshSchema pmeshSchema = pmesh.getSchema();

    Alembic::Abc::P3fArraySamplePtr posSample;
    pmeshSchema.getPositionsProperty().get(posSample);

    Alembic::Abc::Int32ArraySamplePtr faceIndicesSample;
    pmeshSchema.getFaceIndicesProperty().get(faceIndicesSample);
    Alembic::Abc::Int32ArraySamplePtr faceCountsSample;
    pmeshSchema.getFaceCountsProperty().get(faceCountsSample);

    // 根据faceIndices展开pos，每个面可能超过3个顶点，所以需要展开
    if (faceIndicesSample && faceCountsSample) {
        size_t numFaces = faceCountsSample->size();

        std::cout << "numFaces: " << numFaces << "\n";
        // 维护一个累加的起始索引
        size_t currentFaceStart = 0;

        // size_t numPoints = posSample->size();
        for (size_t i = 0; i < numFaces; ++i) {
            size_t faceCount = faceCountsSample->get()[i]; // 获取当前面的顶点数
            size_t faceEnd =
                currentFaceStart + faceCount; // 计算当前面的结束索引
            // std::cout << "face[" << i << "] count=" << faceCount
            //           << " start=" << currentFaceStart << " end=" << faceEnd
            //           << "\n";

            for (size_t j = currentFaceStart + 1; j < faceEnd - 1; ++j) {
                // std::cout << "face[" << i << "]: ";
                Alembic::Abc::V3f v =
                    (*posSample)[(*faceIndicesSample)[currentFaceStart]];
                verts.push_back(v.x);
                verts.push_back(v.y);
                verts.push_back(v.z);
                // std::cout << v.x << ", " << v.y << ", " << v.z << "   ";
                v = (*posSample)[(*faceIndicesSample)[j]];
                verts.push_back(v.x);
                verts.push_back(v.y);
                verts.push_back(v.z);
                // std::cout << v.x << ", " << v.y << ", " << v.z << "   ";
                v = (*posSample)[(*faceIndicesSample)[j + 1]];
                verts.push_back(v.x);
                verts.push_back(v.y);
                verts.push_back(v.z);
                // std::cout << v.x << ", " << v.y << ", " << v.z << "\n";
            }
            // 更新下一个面的起始索引
            currentFaceStart += faceCount;
        }
    }
    // // Add all vertex positions to the vector
    // if (posSample) {
    //     size_t numPoints = posSample->size();
    //     for (size_t i = 0; i < numPoints; ++i) {
    //         Alembic::Abc::V3f v = (*posSample)[i];
    //         verts.push_back(v.x);
    //         verts.push_back(v.y);
    //         verts.push_back(v.z);
    //     }
    // }
    return verts;
}

auto WrapCamera(const IObject &obj) -> Alembic::AbcGeom::ICamera {
    Alembic::AbcGeom::ICamera camera(obj, Alembic::Abc::kWrapExisting);
    return camera;
}

auto WrapXform(const IObject &obj) -> Alembic::AbcGeom::IXform {
    Alembic::AbcGeom::IXform xform(obj, Alembic::Abc::kWrapExisting);
    return xform;
}
auto WrapPolyMesh(const IObject &obj) -> Alembic::AbcGeom::IPolyMesh {
    Alembic::AbcGeom::IPolyMesh pmesh(obj, Alembic::Abc::kWrapExisting);
    return pmesh;
}

auto WrapCurves(const IObject &obj) -> Alembic::AbcGeom::ICurves {
    Alembic::AbcGeom::ICurves curves(obj, Alembic::Abc::kWrapExisting);
    return curves;
}
// Binding code for JavaScript
EMSCRIPTEN_BINDINGS(my_module) {
    function("read_alembic_structure", &read_alembic_structure);
    function("read_alembic_structure_from_memory",
             &read_alembic_structure_from_memory);
    function("get_mesh_vertices", &get_mesh_vertices);
    function("get_mesh_vertices_from_memory", &get_mesh_vertices_from_memory);
    function("get_alembic_top_object_from_memory",
             &get_alembic_top_object_from_memory);
    function("InitTopAlembicObject", &InitTopAlembicObject);

    // Register std::vector bindings for array data transfer
    register_vector<std::uint8_t>("VectorU8");
    register_vector<float>("VectorFloat");

    class_<Alembic::AbcGeom::M44d>("M44d").function(
        "getValueView", optional_override([](const Alembic::AbcGeom::M44d &m) {
            return emscripten::val(
                emscripten::typed_memory_view(16, m.getValue()));
        }));

    // wrap constructor
    function("WrapCamera", &WrapCamera);
    function("WrapXform", &WrapXform);
    function("WrapPolyMesh", &WrapPolyMesh);

    // wrap class
    emscripten::class_<Alembic::AbcGeom::ICameraSchema>("AbcICameraSchema")
        .function("getValue", optional_override(
                                  [](Alembic::AbcGeom::ICameraSchema &schema) {
                                      Alembic::AbcGeom::CameraSample sample;
                                      schema.get(sample);
                                      return sample;
                                  }))
        .function("getNumSamples",
                  &Alembic::AbcGeom::ICameraSchema::getNumSamples);
    emscripten::class_<Alembic::AbcGeom::CameraSample>("AbcCameraSample")
        .constructor<>()
        // Focal Length (mm)
        .function("getFocalLength",
                  &Alembic::AbcGeom::CameraSample::getFocalLength)
        .function("setFocalLength",
                  &Alembic::AbcGeom::CameraSample::setFocalLength)
        // Horizontal Aperture (cm)
        .function("getHorizontalAperture",
                  &Alembic::AbcGeom::CameraSample::getHorizontalAperture)
        .function("setHorizontalAperture",
                  &Alembic::AbcGeom::CameraSample::setHorizontalAperture)
        // Horizontal Film Offset (cm)
        .function("getHorizontalFilmOffset",
                  &Alembic::AbcGeom::CameraSample::getHorizontalFilmOffset)
        .function("setHorizontalFilmOffset",
                  &Alembic::AbcGeom::CameraSample::setHorizontalFilmOffset)
        // Vertical Aperture (cm)
        .function("getVerticalAperture",
                  &Alembic::AbcGeom::CameraSample::getVerticalAperture)
        .function("setVerticalAperture",
                  &Alembic::AbcGeom::CameraSample::setVerticalAperture)
        // Vertical Film Offset (cm)
        .function("getVerticalFilmOffset",
                  &Alembic::AbcGeom::CameraSample::getVerticalFilmOffset)
        .function("setVerticalFilmOffset",
                  &Alembic::AbcGeom::CameraSample::setVerticalFilmOffset)
        // Lens Squeeze Ratio
        .function("getLensSqueezeRatio",
                  &Alembic::AbcGeom::CameraSample::getLensSqueezeRatio)
        .function("setLensSqueezeRatio",
                  &Alembic::AbcGeom::CameraSample::setLensSqueezeRatio)
        // OverScan
        .function("getOverScanLeft",
                  &Alembic::AbcGeom::CameraSample::getOverScanLeft)
        .function("setOverScanLeft",
                  &Alembic::AbcGeom::CameraSample::setOverScanLeft)
        .function("getOverScanRight",
                  &Alembic::AbcGeom::CameraSample::getOverScanRight)
        .function("setOverScanRight",
                  &Alembic::AbcGeom::CameraSample::setOverScanRight)
        .function("getOverScanTop",
                  &Alembic::AbcGeom::CameraSample::getOverScanTop)
        .function("setOverScanTop",
                  &Alembic::AbcGeom::CameraSample::setOverScanTop)
        .function("getOverScanBottom",
                  &Alembic::AbcGeom::CameraSample::getOverScanBottom)
        .function("setOverScanBottom",
                  &Alembic::AbcGeom::CameraSample::setOverScanBottom)
        // F-Stop
        .function("getFStop", &Alembic::AbcGeom::CameraSample::getFStop)
        .function("setFStop", &Alembic::AbcGeom::CameraSample::setFStop)
        // Focus Distance (cm)
        .function("getFocusDistance",
                  &Alembic::AbcGeom::CameraSample::getFocusDistance)
        .function("setFocusDistance",
                  &Alembic::AbcGeom::CameraSample::setFocusDistance)
        // Shutter (seconds)
        .function("getShutterOpen",
                  &Alembic::AbcGeom::CameraSample::getShutterOpen)
        .function("setShutterOpen",
                  &Alembic::AbcGeom::CameraSample::setShutterOpen)
        .function("getShutterClose",
                  &Alembic::AbcGeom::CameraSample::getShutterClose)
        .function("setShutterClose",
                  &Alembic::AbcGeom::CameraSample::setShutterClose)
        // Clipping Planes (cm)
        .function("getNearClippingPlane",
                  &Alembic::AbcGeom::CameraSample::getNearClippingPlane)
        .function("setNearClippingPlane",
                  &Alembic::AbcGeom::CameraSample::setNearClippingPlane)
        .function("getFarClippingPlane",
                  &Alembic::AbcGeom::CameraSample::getFarClippingPlane)
        .function("setFarClippingPlane",
                  &Alembic::AbcGeom::CameraSample::setFarClippingPlane)
        // Field of View (calculated, degrees)
        .function("getFieldOfView",
                  &Alembic::AbcGeom::CameraSample::getFieldOfView)
        // Core Value helper
        .function("getCoreValue", &Alembic::AbcGeom::CameraSample::getCoreValue)
        // Film Back Ops
        .function("getNumOps", &Alembic::AbcGeom::CameraSample::getNumOps)
        .function("getNumOpChannels",
                  &Alembic::AbcGeom::CameraSample::getNumOpChannels)
        // Reset
        .function("reset", &Alembic::AbcGeom::CameraSample::reset);

    emscripten::class_<Alembic::AbcGeom::ICamera>("AbcICamera")
        .function("getSchema",
                  static_cast<const Alembic::AbcGeom::ICameraSchema &(
                      Alembic::AbcGeom::ICamera::*)() const>(
                      &Alembic::AbcGeom::ICamera::getSchema));

    emscripten::class_<Alembic::AbcGeom::ICurvesSchema>("AbcICurvesSchema")
        .constructor()
        .function("getNumSamples",
                  &Alembic::AbcGeom::ICurvesSchema::getNumSamples)
        .function("getTopologyVariance",
                  &Alembic::AbcGeom::ICurvesSchema::getTopologyVariance)
        .function("isConstant", &Alembic::AbcGeom::ICurvesSchema::isConstant)
        .function("getTimeSampling",
                  &Alembic::AbcGeom::ICurvesSchema::getTimeSampling)
        .function(
            "getValue",
            optional_override([](Alembic::AbcGeom::ICurvesSchema &schema) {
                Alembic::AbcGeom::ICurvesSchema::Sample sample;
                schema.get(sample);
                return sample;
            }))
        .function("getVelocitiesProperty",
                  &Alembic::AbcGeom::ICurvesSchema::getVelocitiesProperty)
        .function("getPositionsProperty",
                  &Alembic::AbcGeom::ICurvesSchema::getPositionsProperty)
        .function("getNumVerticesProperty",
                  &Alembic::AbcGeom::ICurvesSchema::getNumVerticesProperty)
        .function("getPositionWeightsProperty",
                  &Alembic::AbcGeom::ICurvesSchema::getPositionWeightsProperty)
        .function("getUVsParam", &Alembic::AbcGeom::ICurvesSchema::getUVsParam)
        .function("getNormalsParam",
                  &Alembic::AbcGeom::ICurvesSchema::getNormalsParam)
        .function("getWidthsParam",
                  &Alembic::AbcGeom::ICurvesSchema::getWidthsParam)
        .function("getOrdersProperty",
                  &Alembic::AbcGeom::ICurvesSchema::getOrdersProperty)
        .function("getKnotsProperty",
                  &Alembic::AbcGeom::ICurvesSchema::getKnotsProperty)
        .function("valid", &Alembic::AbcGeom::ICurvesSchema::valid)
        .function("reset", &Alembic::AbcGeom::ICurvesSchema::reset);

    // ICurvesSchema::Sample binding
    emscripten::class_<Alembic::AbcGeom::ICurvesSchema::Sample>(
        "AbcICurvesSchemaSample")
        .constructor()
        .function("getPositions",
                  &Alembic::AbcGeom::ICurvesSchema::Sample::getPositions)
        .function("getNumCurves",
                  &Alembic::AbcGeom::ICurvesSchema::Sample::getNumCurves)
        .function(
            "getCurvesNumVertices",
            &Alembic::AbcGeom::ICurvesSchema::Sample::getCurvesNumVertices)
        .function("getType", &Alembic::AbcGeom::ICurvesSchema::Sample::getType)
        .function("getWrap", &Alembic::AbcGeom::ICurvesSchema::Sample::getWrap)
        .function("getBasis",
                  &Alembic::AbcGeom::ICurvesSchema::Sample::getBasis)
        .function("getOrders",
                  &Alembic::AbcGeom::ICurvesSchema::Sample::getOrders)
        .function("getKnots",
                  &Alembic::AbcGeom::ICurvesSchema::Sample::getKnots)
        .function("getPositionWeights",
                  &Alembic::AbcGeom::ICurvesSchema::Sample::getPositionWeights)
        .function("getSelfBounds",
                  &Alembic::AbcGeom::ICurvesSchema::Sample::getSelfBounds)
        .function("getVelocities",
                  &Alembic::AbcGeom::ICurvesSchema::Sample::getVelocities)
        .function("valid", &Alembic::AbcGeom::ICurvesSchema::Sample::valid)
        .function("reset", &Alembic::AbcGeom::ICurvesSchema::Sample::reset);

    // Enum bindings for CurveType
    enum_<Alembic::AbcGeom::CurveType>("AbcCurveType")
        .value("kCubic", Alembic::AbcGeom::kCubic)
        .value("kLinear", Alembic::AbcGeom::kLinear)
        .value("kVariableOrder", Alembic::AbcGeom::kVariableOrder);

    // Enum bindings for CurvePeriodicity
    enum_<Alembic::AbcGeom::CurvePeriodicity>("AbcCurvePeriodicity")
        .value("kNonPeriodic", Alembic::AbcGeom::kNonPeriodic)
        .value("kPeriodic", Alembic::AbcGeom::kPeriodic);

    // Enum bindings for BasisType
    enum_<Alembic::AbcGeom::BasisType>("AbcBasisType")
        .value("kNoBasis", Alembic::AbcGeom::kNoBasis)
        .value("kBezierBasis", Alembic::AbcGeom::kBezierBasis)
        .value("kBsplineBasis", Alembic::AbcGeom::kBsplineBasis)
        .value("kCatmullromBasis", Alembic::AbcGeom::kCatmullromBasis)
        .value("kHermiteBasis", Alembic::AbcGeom::kHermiteBasis)
        .value("kPowerBasis", Alembic::AbcGeom::kPowerBasis);

    // MeshTopologyVariance enum binding
    enum_<Alembic::AbcGeom::MeshTopologyVariance>("AbcMeshTopologyVariance")
        .value("kConstantTopology", Alembic::AbcGeom::kConstantTopology)
        .value("kHomogenousTopology", Alembic::AbcGeom::kHomogenousTopology)
        .value("kHeterogenousTopology",
               Alembic::AbcGeom::kHeterogenousTopology);

    emscripten::class_<Alembic::AbcGeom::ICurves>("AbcICurves")
        .function("getSchema",
                  static_cast<const Alembic::AbcGeom::ICurvesSchema &(
                      Alembic::AbcGeom::ICurves::*)() const>(
                      &Alembic::AbcGeom::ICurves::getSchema));

    // wrap constructor
    function("WrapCurves", &WrapCurves);

    class_<Alembic::AbcGeom::Int32ArraySample>("AbcInt32ArraySample")
        .smart_ptr<std::shared_ptr<Alembic::AbcGeom::Int32ArraySample>>(
            "AbcInt32ArraySample")
        .function("getView", optional_override([](Alembic::AbcGeom::Int32ArraySample &sample) {
            return emscripten::val(emscripten::typed_memory_view(
                sample.size(), reinterpret_cast<const int32_t *>(sample.get())));
        }));
    class_<Alembic::AbcGeom::P3fArraySample>("AbcP3fArraySample")
        .smart_ptr<std::shared_ptr<Alembic::AbcGeom::P3fArraySample>>(
            "AbcP3fArraySample")
            .function("getFloatView", optional_override([](Alembic::AbcGeom::P3fArraySample &sample) {
            return emscripten::val(emscripten::typed_memory_view(
                sample.size() * 3, reinterpret_cast<const float *>(sample.get())));
        }));

    emscripten::register_optional<Alembic::AbcGeom::M44d>();
    emscripten::register_optional<IObject>();
    emscripten::function("xformGetMatrix", &xformGetMatrix);
    class_<MemoryBufferInputStream>("MemoryBufferInputStream")
        .constructor<const std::vector<std::uint8_t> &>();

    class_<Alembic::Abc::IObject>("AbcIObject")
        .function("getName", &Alembic::Abc::IObject::getName)
        .function("getFullName", &Alembic::Abc::IObject::getFullName)
        .function("getNumChildren", &Alembic::Abc::IObject::getNumChildren)
        .function("getChild",
                  static_cast<Alembic::Abc::IObject (Alembic::Abc::IObject::*)(
                      size_t) const>(&Alembic::Abc::IObject::getChild))
        .function("getMetaDataSchema",
                  optional_override([](const Alembic::Abc::IObject &obj) {
                      return obj.getMetaData().get("schema");
                  }));

    function("getMeshVertices", &get_mesh_vertices);
};