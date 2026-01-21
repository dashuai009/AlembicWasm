#include "alembic_echo.h"
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

// Enhanced function to specifically handle geometric objects and extract vertex data
void visitGeoObject(Alembic::Abc::IObject iObj, std::stringstream &result,
                    const std::string &indent) {
    std::string path = iObj.getFullName();
    std::string schema = iObj.getMetaData().get("schema");

    if (path != "/") {
        result << "Object " << "name=" << path << g_sep << "schema=" << schema << std::endl;
    }

    // Try to identify if this object is a geometric type and extract its data
    if (iObj.getMetaData().get("schema") == "AbcGeom_PolyMesh_v2") {
        // Handle PolyMesh geometry
        try {
            Alembic::AbcGeom::IPolyMesh pmesh(iObj, Alembic::Abc::kWrapExisting);
            Alembic::AbcGeom::IPolyMeshSchema pmeshSchema = pmesh.getSchema();

            // Extract vertex positions
            Alembic::Abc::P3fArraySamplePtr posSample;
            pmeshSchema.getPositionsProperty().get(posSample);

            // Output vertex count info
            if (posSample) {
                result << indent << "  Geometry vertex_count=" << posSample->size() << std::endl;
            }

            // Extract face counts and indices if they exist
            Alembic::Abc::Int32ArraySamplePtr faceIndices;
            pmeshSchema.getFaceIndicesProperty().get(faceIndices);

            Alembic::Abc::Int32ArraySamplePtr faceCounts;
            pmeshSchema.getFaceCountsProperty().get(faceCounts);

            if (faceIndices && faceCounts) {
                result << indent << "  Geometry face_count=" << faceCounts->size() << std::endl;
            }

        } catch (const std::exception& e) {
            result << indent << "  Error parsing PolyMesh: " << e.what() << std::endl;
        }
    }
    else if (iObj.getMetaData().get("schema") == "AbcGeom_Points_v1") {
        // Handle point cloud
        try {
            Alembic::AbcGeom::IPoints pts(iObj, Alembic::Abc::kWrapExisting);
            Alembic::AbcGeom::IPointsSchema ptsSchema = pts.getSchema();

            Alembic::Abc::P3fArraySamplePtr posSample;
            ptsSchema.getPositionsProperty().get(posSample);

            if (posSample) {
                result << indent << "  Geometry points_count=" << posSample->size() << std::endl;
            }
        } catch (const std::exception& e) {
            result << indent << "  Error parsing Points: " << e.what() << std::endl;
        }
    }
    else if (iObj.getMetaData().get("schema") == "AbcGeom_Curve_v2") {
        // Handle curves
        try {
            Alembic::AbcGeom::ICurves curvesObj(iObj, Alembic::Abc::kWrapExisting);
            Alembic::AbcGeom::ICurvesSchema curveSchema = curvesObj.getSchema();

            Alembic::Abc::P3fArraySamplePtr posSample;
            curveSchema.getPositionsProperty().get(posSample);

            if (posSample) {
                result << indent << "  Geometry curve_points_count=" << posSample->size() << std::endl;
            }
        } catch (const std::exception& e) {
            result << indent << "  Error parsing Curves: " << e.what() << std::endl;
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

// Custom stream buffer that reads from a memory buffer
class MemoryBufferStreamBuf : public std::streambuf {
public:
    MemoryBufferStreamBuf(const std::vector<std::uint8_t>& buffer)
        : buffer_(buffer) {
        char* base = (char*)buffer_.data();
        setg(base, base, base + buffer_.size());
    }

protected:
    pos_type seekoff(off_type off, std::ios_base::seekdir way,
                     std::ios_base::openmode which) override {
        if (!(which & std::ios_base::in)) return pos_type(off_type(-1));

        char* begin = eback();
        char* end   = egptr();
        char* cur   = gptr();

        char* newpos = nullptr;
        if (way == std::ios_base::beg) newpos = begin + off;
        else if (way == std::ios_base::cur) newpos = cur + off;
        else if (way == std::ios_base::end) newpos = end + off;

        if (newpos < begin || newpos > end) return pos_type(off_type(-1));
        setg(begin, newpos, end);
        return pos_type(newpos - begin);
    }

    pos_type seekpos(pos_type sp,
                     std::ios_base::openmode which) override {
        return seekoff(off_type(sp), std::ios_base::beg, which);
    }

private:
    const std::vector<std::uint8_t>& buffer_;
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

// Enhanced memory-based reader that also gets geometry data
std::string read_alembic_structure_from_memory(const std::vector<std::uint8_t> &buffer) {
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

// For actual vertex data extraction, we need a more complex function
std::vector<float> get_mesh_vertices(const std::string &filename) {
    std::vector<float> vertices;

    try {
        Alembic::AbcCoreFactory::IFactory factory;
        factory.setPolicy(Alembic::Abc::ErrorHandler::kQuietNoopPolicy);
        Alembic::Abc::IArchive archive = factory.getArchive(filename);

        if (archive) {
            Alembic::Abc::IObject top = archive.getTop();

            // Recursive function to find PolyMesh objects and extract vertex data
            std::function<void(Alembic::Abc::IObject, std::vector<float>&)>
            extractVertices = [&](Alembic::Abc::IObject obj, std::vector<float>& verts) {
                // Check if this is a PolyMesh
                if (obj.getMetaData().get("schema") == "AbcGeom_PolyMesh_v2") {
                    try {
                        Alembic::AbcGeom::IPolyMesh pmesh(obj, Alembic::Abc::kWrapExisting);
                        Alembic::AbcGeom::IPolyMeshSchema pmeshSchema = pmesh.getSchema();

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
                }

                // Visit child objects
                for (size_t i = 0; i < obj.getNumChildren(); i++) {
                    Alembic::Abc::IObject child(obj, obj.getChildHeader(i).getName());
                    extractVertices(child, verts);
                }
            };

            extractVertices(top, vertices);
        }
    } catch (...) {
        // Error occurred, return empty vertices vector
    }

    return vertices;
}


// Memory version of getting mesh vertices
std::vector<float> get_mesh_vertices_from_memory(const std::vector<std::uint8_t> &buffer) {
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

            // Recursive function to find PolyMesh objects and extract vertex data
            std::function<void(Alembic::Abc::IObject, std::vector<float>&)>
            extractVertices = [&](Alembic::Abc::IObject obj, std::vector<float>& verts) {
                // Check if this is a PolyMesh
                if (obj.getMetaData().get("schema") == "AbcGeom_PolyMesh_v1") {
                    try {
                        Alembic::AbcGeom::IPolyMesh pmesh(obj, Alembic::Abc::kWrapExisting);
                        Alembic::AbcGeom::IPolyMeshSchema pmeshSchema = pmesh.getSchema();

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
                    Alembic::Abc::IObject child(obj, obj.getChildHeader(i).getName());
                    extractVertices(child, verts);
                }
            };

            extractVertices(top, vertices);
        }
    } catch (...) {
        // Error occurred, return empty vertices vector
    }

    std::cout <<vertices.size() << "adfasdf\n";
    return vertices;
}

std::string get_alembic_top_object_from_memory(const std::vector<std::uint8_t> &buffer) {
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
            result << "  Top object full name: " << topObject.getFullName() << "\n";
            result << "  Top object metadata: " << topObject.getMetaData().get("schema") << "\n";
            result << "  Number of children: " << topObject.getNumChildren() << "\n";

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
                result << "  using Alembic : " << libraryVersionString << std::endl;
                result << "  written on : " << whenWritten << std::endl;
                result << "  user description : " << userDescription << std::endl;
            } else {
                result << "  (file doesn't have any ArchiveInfo)" << std::endl;
            }
        } else {
            result << "  Error: Could not create valid Alembic archive from memory buffer\n";
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
AlembicObjectHandle::AlembicObjectHandle(const std::vector<std::uint8_t>& buffer) : m_valid(false) {
    if (buffer.empty()) {
        return;
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
            // Get the top object
            m_object = archive.getTop();
            m_valid = true;
        }
    } catch (...) {
        m_valid = false;
    }
}

std::string AlembicObjectHandle::getName() const {
    if (!m_valid) return "";
    return m_object.getName();
}

std::string AlembicObjectHandle::getFullName() const {
    if (!m_valid) return "";
    return m_object.getFullName();
}

std::string AlembicObjectHandle::getSchema() const {
    if (!m_valid) return "";
    return m_object.getMetaData().get("schema");
}

int AlembicObjectHandle::getNumChildren() const {
    if (!m_valid) return 0;
    return static_cast<int>(m_object.getNumChildren());
}

bool AlembicObjectHandle::isValid() const {
    return m_valid && m_object.valid();
}

std::string AlembicObjectHandle::getChildName(int index) const {
    if (!m_valid || index < 0 || index >= static_cast<int>(m_object.getNumChildren())) {
        return "";
    }
    try {
        Alembic::Abc::IObject child = m_object.getChild(index);
        return child.getName();
    } catch (...) {
        return "";
    }
}

// Binding code for JavaScript
EMSCRIPTEN_BINDINGS(my_module) {
    function("read_alembic_structure", &read_alembic_structure);
    function("read_alembic_structure_from_memory",
             &read_alembic_structure_from_memory);
    function("get_mesh_vertices", &get_mesh_vertices);
    function("get_mesh_vertices_from_memory", &get_mesh_vertices_from_memory);
    function("get_alembic_top_object_from_memory", &get_alembic_top_object_from_memory);

    // Register std::vector bindings for array data transfer
    register_vector<std::uint8_t>("VectorU8");
    register_vector<float>("VectorFloat");

    // Register the AlembicObjectHandle class for use in JavaScript
    class_<AlembicObjectHandle>("AlembicObjectHandle")
        .constructor<const std::vector<std::uint8_t>&>()
        .function("getName", &AlembicObjectHandle::getName)
        .function("getFullName", &AlembicObjectHandle::getFullName)
        .function("getSchema", &AlembicObjectHandle::getSchema)
        .function("getNumChildren", &AlembicObjectHandle::getNumChildren)
        .function("isValid", &AlembicObjectHandle::isValid)
        .function("getChildName", &AlembicObjectHandle::getChildName);
};