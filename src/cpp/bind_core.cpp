#include "abc_wasm/properties.h"

namespace abc_wasm {

namespace {

std::shared_ptr<ArchiveReaderContext> createReaderBuffer(std::size_t byteLength) {
    return std::make_shared<ArchiveReaderContext>(byteLength);
}

std::shared_ptr<IArchiveWrap> openReaderArchive(const std::shared_ptr<ArchiveReaderContext>& ctx) {
    if (!ctx) {
        throw std::runtime_error("Null ArchiveReaderContext passed to openReaderArchive.");
    }
    ctx->open();
    return std::make_shared<IArchiveWrap>(ctx);
}

std::shared_ptr<IArchiveWrap> openLayeredReaderArchive(const emscripten::val& jsCtxArray) {
    int count = jsCtxArray["length"].as<int>();
    std::vector<std::shared_ptr<ArchiveReaderContext>> layers;
    layers.reserve(static_cast<std::size_t>(count));
    for (int i = 0; i < count; ++i) {
        auto ctx = jsCtxArray[i].as<std::shared_ptr<ArchiveReaderContext>>();
        layers.push_back(ctx);
    }
    auto layered = std::make_shared<LayeredArchiveContext>(layers);
    return std::make_shared<IArchiveWrap>(layered);
}

std::shared_ptr<ArchiveWriterContext> createWriterArchive(
    const std::string& appName,
    const std::string& userDescription,
    double dccFps,
    const emscripten::val& extraMeta
) {
    return std::make_shared<ArchiveWriterContext>(appName, userDescription, dccFps, extraMeta);
}

emscripten::val applyLayerPruneMeta(const emscripten::val& metaObj, bool prune) {
    AbcA::MetaData md = valToMetaData(metaObj);
    AbcL::SetPrune(md, prune);
    return metaDataToVal(md);
}

emscripten::val applyLayerReplaceMeta(const emscripten::val& metaObj, bool replace) {
    AbcA::MetaData md = valToMetaData(metaObj);
    AbcL::SetReplace(md, replace);
    return metaDataToVal(md);
}

std::string getAlembicLibraryVersion() {
    return Abc::GetLibraryVersion();
}

std::string getAlembicLibraryVersionShort() {
    return Abc::GetLibraryVersionShort();
}

std::string getCppExceptionMessage(std::uintptr_t excPtr) {
    if (excPtr == 0) return "Unknown C++ exception";
    const auto* ex = reinterpret_cast<const std::exception*>(excPtr);
    return ex->what() ? std::string(ex->what()) : "Unknown C++ exception";
}

} // namespace

EMSCRIPTEN_BINDINGS(abc_wasm_core) {
    using namespace emscripten;

    value_object<BufferViewDesc>("BufferViewDesc")
        .field("ptr", &BufferViewDesc::ptr)
        .field("length", &BufferViewDesc::length)
        .field("pod", &BufferViewDesc::pod)
        .field("extent", &BufferViewDesc::extent)
        .field("byteLength", &BufferViewDesc::byteLength);

    value_object<Box3dDesc>("Box3dDesc")
        .field("hasValue", &Box3dDesc::hasValue)
        .field("minX", &Box3dDesc::minX)
        .field("minY", &Box3dDesc::minY)
        .field("minZ", &Box3dDesc::minZ)
        .field("maxX", &Box3dDesc::maxX)
        .field("maxY", &Box3dDesc::maxY)
        .field("maxZ", &Box3dDesc::maxZ);

    class_<ArchiveReaderContext>("ArchiveReaderContext")
        .smart_ptr<std::shared_ptr<ArchiveReaderContext>>("ArchiveReaderContext")
        .function("dataPtr", &ArchiveReaderContext::dataPtr)
        .function("byteLength", &ArchiveReaderContext::byteLength)
        .function("open", &ArchiveReaderContext::open)
        .function("close", &ArchiveReaderContext::close)
        .function("isClosed", &ArchiveReaderContext::isClosed)
        .function("getCoreType", &ArchiveReaderContext::getCoreType);

    class_<IArchiveWrap>("IArchiveWrap")
        .smart_ptr<std::shared_ptr<IArchiveWrap>>("IArchiveWrap")
        .function("getInfo", &IArchiveWrap::getInfo)
        .function("getCoreType", &IArchiveWrap::getCoreType)
        .function("getNumTimeSamplings", &IArchiveWrap::getNumTimeSamplings)
        .function("getTimeSamplingInfo", &IArchiveWrap::getTimeSamplingInfo)
        .function("getArchiveBounds", &IArchiveWrap::getArchiveBounds)
        .function("echo", &IArchiveWrap::echo)
        .function("close", &IArchiveWrap::close)
        .function("isClosed", &IArchiveWrap::isClosed);

    class_<ArchiveWriterContext>("ArchiveWriterContext")
        .smart_ptr<std::shared_ptr<ArchiveWriterContext>>("ArchiveWriterContext")
        .function("addTimeSampling", &ArchiveWriterContext::addTimeSampling)
        .function("setArchiveBounds", &ArchiveWriterContext::setArchiveBounds)
        .function("finalize", &ArchiveWriterContext::finalize)
        .function("dispose", &ArchiveWriterContext::dispose)
        .function("isFinalized", &ArchiveWriterContext::isFinalized);

    function("createReaderBuffer", &createReaderBuffer);
    function("openReaderArchive", &openReaderArchive);
    function("openLayeredReaderArchive", &openLayeredReaderArchive);
    function("createWriterArchive", &createWriterArchive);
    function("applyLayerPruneMeta", &applyLayerPruneMeta);
    function("applyLayerReplaceMeta", &applyLayerReplaceMeta);
    function("getAlembicLibraryVersion", &getAlembicLibraryVersion);
    function("getAlembicLibraryVersionShort", &getAlembicLibraryVersionShort);
    function("getCppExceptionMessage", &getCppExceptionMessage);
}

} // namespace abc_wasm
