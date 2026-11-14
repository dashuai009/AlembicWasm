#include "abc_wasm/properties.h"

namespace abc_wasm {

namespace {

void echoProperties(
    const Abc::ICompoundProperty& props,
    const std::string& indent,
    std::ostringstream& out
) {
    if (!props.valid()) return;
    std::size_t n = props.getNumProperties();
    for (std::size_t i = 0; i < n; ++i) {
        const AbcA::PropertyHeader& ph = props.getPropertyHeader(i);
        out << indent << "Property name=" << ph.getName();
        if (ph.isCompound()) {
            out << " [Compound]\n";
            Abc::ICompoundProperty child(props, ph.getName());
            echoProperties(child, indent + "  ", out);
        } else if (ph.isScalar()) {
            Abc::IScalarProperty sp(props, ph.getName());
            out << " [Scalar pod=" << AbcU::PODName(ph.getDataType().getPod())
                << " extent=" << static_cast<int>(ph.getDataType().getExtent())
                << " samples=" << sp.getNumSamples() << "]\n";
        } else if (ph.isArray()) {
            Abc::IArrayProperty ap(props, ph.getName());
            out << " [Array pod=" << AbcU::PODName(ph.getDataType().getPod())
                << " extent=" << static_cast<int>(ph.getDataType().getExtent())
                << " samples=" << ap.getNumSamples() << "]\n";
        }
    }
}

void echoObjectTree(
    const Abc::IObject& obj,
    const std::string& indent,
    std::ostringstream& out
) {
    if (!obj.valid()) return;
    std::string schemaType = detectObjectSchemaType(obj.getHeader());
    out << indent << "Object " << obj.getFullName()
        << " (schema=" << schemaType;
    std::string rawSchema = obj.getMetaData().get("schema");
    if (!rawSchema.empty()) {
        out << ", id=" << rawSchema;
    }
    if (obj.isInstanceRoot()) {
        out << ", instanceSource=" << obj.instanceSourcePath();
    }
    out << ")\n";

    echoProperties(obj.getProperties(), indent + "  ", out);

    std::size_t numChildren = obj.getNumChildren();
    for (std::size_t i = 0; i < numChildren; ++i) {
        echoObjectTree(obj.getChild(i), indent + "  ", out);
    }
}

std::shared_ptr<IObjectWrap> getArchiveTopObject(const std::shared_ptr<IArchiveWrap>& ar) {
    if (!ar) throw std::runtime_error("Null archive passed to getArchiveTopObject.");
    return std::make_shared<IObjectWrap>(ar->archive().getTop(), ar->keepAlive());
}

std::shared_ptr<OObjectWrap> getWriterTopObject(const std::shared_ptr<ArchiveWriterContext>& ctx) {
    if (!ctx) throw std::runtime_error("Null writer context passed to getWriterTopObject.");
    auto wrap = std::make_shared<OObjectWrap>(ctx->archive().getTop(), ctx);
    ctx->registerHandle(wrap);
    return wrap;
}

} // namespace

std::string IArchiveWrap::echo() const {
    Abc::IArchive& ar = archive();
    std::ostringstream out;
    std::string appName;
    std::string libVersionStr;
    AbcU::uint32_t apiVersion = 0;
    std::string dateWritten;
    std::string description;
    double dccFps = 0.0;
    Abc::GetArchiveInfo(ar, appName, libVersionStr, apiVersion, dateWritten, description, dccFps);

    out << "AbcEcho for Archive (" << getCoreType() << ")\n";
    out << "  LibraryVersion: " << libVersionStr << " (API " << apiVersion << ")\n";
    if (!appName.empty()) out << "  Application: " << appName << "\n";
    if (!dateWritten.empty()) out << "  DateWritten: " << dateWritten << "\n";
    if (!description.empty()) out << "  Description: " << description << "\n";
    if (dccFps > 0.0) out << "  DCC FPS: " << dccFps << "\n";
    out << "  TimeSamplings: " << ar.getNumTimeSamplings() << "\n";

    echoObjectTree(ar.getTop(), "  ", out);
    return out.str();
}

std::shared_ptr<IObjectWrap> IObjectWrap::getChildByIndex(std::size_t index) const {
    keepAlive_->ensureOpen();
    if (index >= obj_.getNumChildren()) {
        throw std::out_of_range("IObject child index out of range.");
    }
    return std::make_shared<IObjectWrap>(obj_.getChild(index), keepAlive_);
}

std::shared_ptr<IObjectWrap> IObjectWrap::getChildByName(const std::string& name) const {
    keepAlive_->ensureOpen();
    if (obj_.getChildHeader(name) == nullptr) {
        return nullptr;
    }
    return std::make_shared<IObjectWrap>(obj_.getChild(name), keepAlive_);
}

std::shared_ptr<OObjectWrap> OObjectWrap::addChild(
    const std::string& name,
    const emscripten::val& metaObj
) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    Abc::OObject child(obj_, name, md);
    auto wrap = std::make_shared<OObjectWrap>(std::move(child), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

bool OObjectWrap::addChildInstance(
    const std::shared_ptr<OObjectWrap>& target,
    const std::string& name
) {
    writerCtx_->ensureWritable();
    if (!target) {
        throw std::runtime_error("Null target OObject passed to addChildInstance.");
    }
    return obj_.addChildInstance(target->raw(), name);
}

std::shared_ptr<OCompoundWrap> OObjectWrap::getProperties() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(obj_.getProperties(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

void OObjectWrap::setVisibility(int visValue, std::uint32_t tsIndex) {
    writerCtx_->ensureWritable();
    if (!visProp_.valid()) {
        visProp_ = AbcG::CreateVisibilityProperty(obj_, tsIndex);
    }
    visProp_.set(static_cast<std::int8_t>(visValue));
}

EMSCRIPTEN_BINDINGS(abc_wasm_objects) {
    using namespace emscripten;

    class_<IObjectWrap>("IObjectWrap")
        .smart_ptr<std::shared_ptr<IObjectWrap>>("IObjectWrap")
        .function("valid", &IObjectWrap::valid)
        .function("getName", &IObjectWrap::getName)
        .function("getFullName", &IObjectWrap::getFullName)
        .function("getSchemaType", &IObjectWrap::getSchemaType)
        .function("getSchemaString", &IObjectWrap::getSchemaString)
        .function("getMetaData", &IObjectWrap::getMetaData)
        .function("getNumChildren", &IObjectWrap::getNumChildren)
        .function("getChildByIndex", &IObjectWrap::getChildByIndex)
        .function("getChildByName", &IObjectWrap::getChildByName)
        .function("hasChild", &IObjectWrap::hasChild)
        .function("getProperties", &IObjectWrap::getProperties)
        .function("isInstanceRoot", &IObjectWrap::isInstanceRoot)
        .function("isInstanceDescendant", &IObjectWrap::isInstanceDescendant)
        .function("instanceSourcePath", &IObjectWrap::instanceSourcePath)
        .function("getVisibility", &IObjectWrap::getVisibility)
        .function("isAncestorInvisible", &IObjectWrap::isAncestorInvisible)
        .function("getVisibilityProperty", &IObjectWrap::getVisibilityProperty);

    class_<OObjectWrap>("OObjectWrap")
        .smart_ptr<std::shared_ptr<OObjectWrap>>("OObjectWrap")
        .function("valid", &OObjectWrap::valid)
        .function("getName", &OObjectWrap::getName)
        .function("getFullName", &OObjectWrap::getFullName)
        .function("getMetaData", &OObjectWrap::getMetaData)
        .function("getNumChildren", &OObjectWrap::getNumChildren)
        .function("addChild", &OObjectWrap::addChild)
        .function("addChildInstance", &OObjectWrap::addChildInstance)
        .function("getProperties", &OObjectWrap::getProperties)
        .function("setVisibility", &OObjectWrap::setVisibility);

    function("getArchiveTopObject", &getArchiveTopObject);
    function("getWriterTopObject", &getWriterTopObject);
}

} // namespace abc_wasm
