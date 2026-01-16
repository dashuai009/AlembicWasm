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
#include <sstream>

using namespace emscripten;
using namespace ::Alembic::AbcGeom;
using namespace ::Alembic::AbcCoreAbstract;

static const std::string g_sep(";");

// Forward declarations for helper functions based on existing AbcEcho code
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

void visitObject(Alembic::Abc::IObject iObj, std::stringstream &result,
                 const std::string &indent) {
    std::string path = iObj.getFullName();

    if (path != "/") {
        result << "Object " << "name=" << path << std::endl;
    }

    // Get the properties
    Alembic::Abc::ICompoundProperty props = iObj.getProperties();
    visitProperties(props, result, indent);

    // Visit child objects
    for (size_t i = 0; i < iObj.getNumChildren(); i++) {
        Alembic::Abc::IObject child(iObj, iObj.getChildHeader(i).getName());
        visitObject(child, result, indent);
    }
}

std::string read_alembic_structure(const std::string &filename) {
    std::stringstream result;

    result << "AbcEcho for Alembic WASM Module\n";
    result << "  Processing file from filesystem: " << filename << "\n";

    try {
        // Use factory to create archive from file
        Alembic::AbcCoreFactory::IFactory factory;
        factory.setPolicy(Alembic::Abc::ErrorHandler::kQuietNoopPolicy);
        Alembic::Abc::IArchive archive = factory.getArchive(filename);

        if (archive) {
            result << "  Abc version: "
                   << Alembic::AbcCoreAbstract::GetLibraryVersion() << "\n\n";

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

            visitObject(archive.getTop(), result, "");
        } else {
            result << "  Error: Could not open file " << filename << "\n";
        }
    } catch (const std::exception &e) {
        result << "  Error: " << e.what() << "\n";
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

// Memory buffer reader implementation for WASM environment
// Using proper Alembic Ogawa API for memory-based reading
std::string
read_alembic_structure_from_memory(const std::vector<std::uint8_t> &buffer) {
    std::stringstream result;

    result << "AbcEcho for Alembic WASM Module\n";
    result << "  Processing file from memory buffer: " << buffer.size()
           << " bytes\n";

    if (buffer.empty()) {
        result << "  Error: Empty buffer received.\n";
        return result.str();
    }

    try {
        using namespace Alembic::AbcCoreFactory;

        // Create an input stream from our buffer
        MemoryBufferInputStream memoryStream(buffer);
        memoryStream.clear();                 // 清除 failbit/eofbit
        memoryStream.seekg(0, std::ios::beg); // 定位到开头
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
                   << Alembic::AbcCoreAbstract::GetLibraryVersion() << "\n\n";

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

            visitObject(archive.getTop(), result, "");
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

// Binding code for JavaScript
EMSCRIPTEN_BINDINGS(my_module) {
    function("read_alembic_structure", &read_alembic_structure);
    function("read_alembic_structure_from_memory",
             &read_alembic_structure_from_memory);

    // Register std::vector bindings for array data transfer
    register_vector<std::uint8_t>("VectorU8");
};