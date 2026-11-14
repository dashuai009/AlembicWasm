#pragma once

#include "abc_wasm/memory_streams.h"

namespace abc_wasm {

class ICompoundWrap;
class OCompoundWrap;
class IScalarWrap;
class OScalarWrap;
class IArrayWrap;
class OArrayWrap;
class GenericIGeomParam;
class GenericOGeomParam;

inline std::string detectObjectSchemaType(const AbcA::ObjectHeader& hdr) {
    if (AbcG::IXform::matches(hdr)) return "Xform";
    if (AbcG::IPolyMesh::matches(hdr)) return "PolyMesh";
    if (AbcG::ISubD::matches(hdr)) return "SubD";
    if (AbcG::ICamera::matches(hdr)) return "Camera";
    if (AbcG::ICurves::matches(hdr)) return "Curves";
    if (AbcG::IPoints::matches(hdr)) return "Points";
    if (AbcG::INuPatch::matches(hdr)) return "NuPatch";
    if (AbcG::ILight::matches(hdr)) return "Light";
    if (AbcG::IFaceSet::matches(hdr)) return "FaceSet";
    if (AbcM::IMaterial::matches(hdr)) return "Material";
    if (AbcC::ICollections::matches(hdr)) return "Collections";
    return "None";
}

inline std::uint32_t findTimeSamplingIndex(Abc::IArchive archive, const AbcA::TimeSamplingPtr& ts) {
    if (!archive.valid() || !ts) return 0;
    std::uint32_t n = static_cast<std::uint32_t>(archive.getNumTimeSamplings());
    for (std::uint32_t i = 0; i < n; ++i) {
        AbcA::TimeSamplingPtr candidate = archive.getTimeSampling(i);
        if (candidate == ts || (candidate && *candidate == *ts)) {
            return i;
        }
    }
    return 0;
}

class IScalarWrap {
public:
    IScalarWrap() = default;
    IScalarWrap(Abc::IScalarProperty prop, ReaderKeepAlivePtr keepAlive)
        : prop_(std::move(prop)), keepAlive_(std::move(keepAlive)) {}

    bool valid() const { return !keepAlive_->closed && prop_.valid(); }
    std::string getName() const { keepAlive_->ensureOpen(); return prop_.getName(); }
    int getPod() const { keepAlive_->ensureOpen(); return static_cast<int>(prop_.getDataType().getPod()); }
    int getExtent() const { keepAlive_->ensureOpen(); return static_cast<int>(prop_.getDataType().getExtent()); }
    std::string getInterpretation() const { keepAlive_->ensureOpen(); return prop_.getMetaData().get("interpretation"); }
    emscripten::val getMetaData() const { keepAlive_->ensureOpen(); return metaDataToVal(prop_.getMetaData()); }
    std::size_t getNumSamples() const { keepAlive_->ensureOpen(); return prop_.getNumSamples(); }
    bool isConstant() const { keepAlive_->ensureOpen(); return prop_.isConstant(); }
    std::uint32_t getTimeSamplingIndex() const {
        keepAlive_->ensureOpen();
        return findTimeSamplingIndex(prop_.getObject().getArchive(), prop_.getTimeSampling());
    }

    BufferViewDesc getNumericSample(int selectorMode, double selectorValue);
    BufferViewDesc getFloat16AsFloat32Sample(int selectorMode, double selectorValue);
    emscripten::val getSpecialSample(int selectorMode, double selectorValue) const;

private:
    Abc::IScalarProperty prop_;
    ReaderKeepAlivePtr keepAlive_;
    std::vector<std::uint8_t> scratch_;
    std::vector<float> floatScratch_;
};

class IArrayWrap {
public:
    IArrayWrap() = default;
    IArrayWrap(Abc::IArrayProperty prop, ReaderKeepAlivePtr keepAlive)
        : prop_(std::move(prop)), keepAlive_(std::move(keepAlive)) {}

    bool valid() const { return !keepAlive_->closed && prop_.valid(); }
    std::string getName() const { keepAlive_->ensureOpen(); return prop_.getName(); }
    int getPod() const { keepAlive_->ensureOpen(); return static_cast<int>(prop_.getDataType().getPod()); }
    int getExtent() const { keepAlive_->ensureOpen(); return static_cast<int>(prop_.getDataType().getExtent()); }
    std::string getInterpretation() const { keepAlive_->ensureOpen(); return prop_.getMetaData().get("interpretation"); }
    emscripten::val getMetaData() const { keepAlive_->ensureOpen(); return metaDataToVal(prop_.getMetaData()); }
    std::size_t getNumSamples() const { keepAlive_->ensureOpen(); return prop_.getNumSamples(); }
    bool isConstant() const { keepAlive_->ensureOpen(); return prop_.isConstant(); }
    std::uint32_t getTimeSamplingIndex() const {
        keepAlive_->ensureOpen();
        return findTimeSamplingIndex(prop_.getObject().getArchive(), prop_.getTimeSampling());
    }

    BufferViewDesc getNumericSample(int selectorMode, double selectorValue);
    BufferViewDesc getFloat16AsFloat32Sample(int selectorMode, double selectorValue);
    emscripten::val getSpecialSample(int selectorMode, double selectorValue);
    emscripten::val getDimensions(int selectorMode, double selectorValue);

private:
    Abc::IArrayProperty prop_;
    ReaderKeepAlivePtr keepAlive_;
    AbcA::ArraySamplePtr lastSample_;
    std::vector<float> floatScratch_;
};

class GenericIGeomParam {
public:
    GenericIGeomParam() = default;
    GenericIGeomParam(const Abc::ICompoundProperty& parent, const std::string& name, ReaderKeepAlivePtr keepAlive);

    bool valid() const { return keepAlive_ && !keepAlive_->closed && valProp_.valid(); }
    std::string getName() const { return name_; }
    bool isIndexed() const { return isIndexed_; }
    int getScope() const { return static_cast<int>(scope_); }
    int getPod() const { keepAlive_->ensureOpen(); return static_cast<int>(valProp_.getDataType().getPod()); }
    int getExtent() const { keepAlive_->ensureOpen(); return static_cast<int>(valProp_.getDataType().getExtent()); }
    int getArrayExtent() const { return arrayExtent_; }
    std::string getInterpretation() const { return interpretation_; }
    emscripten::val getMetaData() const { keepAlive_->ensureOpen(); return metaDataToVal(metaData_); }
    std::size_t getNumSamples() const;
    bool isConstant() const;
    std::uint32_t getTimeSamplingIndex() const;

    std::shared_ptr<IArrayWrap> getValueProperty() const {
        return std::make_shared<IArrayWrap>(valProp_, keepAlive_);
    }
    std::shared_ptr<IArrayWrap> getIndexProperty() const {
        if (!isIndexed_ || !indicesProp_.valid()) return nullptr;
        return std::make_shared<IArrayWrap>(indicesProp_, keepAlive_);
    }

    BufferViewDesc getExpandedNumericSample(int selectorMode, double selectorValue);

private:
    std::string name_;
    bool isIndexed_ = false;
    AbcG::GeometryScope scope_ = AbcG::kUnknownScope;
    int arrayExtent_ = 1;
    std::string interpretation_;
    AbcA::MetaData metaData_;
    Abc::ICompoundProperty cprop_;
    Abc::IArrayProperty valProp_;
    Abc::IArrayProperty indicesProp_;
    ReaderKeepAlivePtr keepAlive_;
    AbcA::ArraySamplePtr lastVals_;
    AbcA::ArraySamplePtr lastIndices_;
    std::vector<std::uint8_t> expandedScratch_;
};

class ICompoundWrap {
public:
    ICompoundWrap() = default;
    ICompoundWrap(Abc::ICompoundProperty prop, ReaderKeepAlivePtr keepAlive)
        : prop_(std::move(prop)), keepAlive_(std::move(keepAlive)) {}

    bool valid() const { return keepAlive_ && !keepAlive_->closed && prop_.valid(); }
    std::string getName() const { keepAlive_->ensureOpen(); return prop_.getName(); }
    emscripten::val getMetaData() const { keepAlive_->ensureOpen(); return metaDataToVal(prop_.getMetaData()); }
    std::size_t getNumProperties() const { keepAlive_->ensureOpen(); return prop_.valid() ? prop_.getNumProperties() : 0; }

    emscripten::val getPropertyHeaderInfo(std::size_t index) const;
    emscripten::val getPropertyHeaderByName(const std::string& name) const;
    bool hasProperty(const std::string& name) const {
        keepAlive_->ensureOpen();
        return prop_.valid() && prop_.getPropertyHeader(name) != nullptr;
    }

    std::shared_ptr<ICompoundWrap> getCompoundProperty(const std::string& name) const;
    std::shared_ptr<IScalarWrap> getScalarProperty(const std::string& name) const;
    std::shared_ptr<IArrayWrap> getArrayProperty(const std::string& name) const;
    std::shared_ptr<GenericIGeomParam> getGeomParam(const std::string& name) const;

    const Abc::ICompoundProperty& raw() const { keepAlive_->ensureOpen(); return prop_; }
    ReaderKeepAlivePtr keepAlive() const { return keepAlive_; }

private:
    Abc::ICompoundProperty prop_;
    ReaderKeepAlivePtr keepAlive_;
};

class IObjectWrap {
public:
    IObjectWrap() = default;
    IObjectWrap(Abc::IObject obj, ReaderKeepAlivePtr keepAlive)
        : obj_(std::move(obj)), keepAlive_(std::move(keepAlive)) {}

    bool valid() const { return keepAlive_ && !keepAlive_->closed && obj_.valid(); }
    std::string getName() const { keepAlive_->ensureOpen(); return obj_.getName(); }
    std::string getFullName() const { keepAlive_->ensureOpen(); return obj_.getFullName(); }
    std::string getSchemaType() const { keepAlive_->ensureOpen(); return detectObjectSchemaType(obj_.getHeader()); }
    std::string getSchemaString() const { keepAlive_->ensureOpen(); return obj_.getMetaData().get("schema"); }
    emscripten::val getMetaData() const { keepAlive_->ensureOpen(); return metaDataToVal(obj_.getMetaData()); }

    std::size_t getNumChildren() const { keepAlive_->ensureOpen(); return obj_.getNumChildren(); }
    std::shared_ptr<IObjectWrap> getChildByIndex(std::size_t index) const;
    std::shared_ptr<IObjectWrap> getChildByName(const std::string& name) const;
    bool hasChild(const std::string& name) const {
        keepAlive_->ensureOpen();
        return obj_.getChildHeader(name) != nullptr;
    }

    std::shared_ptr<ICompoundWrap> getProperties() const {
        keepAlive_->ensureOpen();
        return std::make_shared<ICompoundWrap>(obj_.getProperties(), keepAlive_);
    }

    bool isInstanceRoot() const { keepAlive_->ensureOpen(); return obj_.isInstanceRoot(); }
    bool isInstanceDescendant() const { keepAlive_->ensureOpen(); return obj_.isInstanceDescendant(); }
    std::string instanceSourcePath() const { keepAlive_->ensureOpen(); return obj_.instanceSourcePath(); }

    int getVisibility(int selectorMode, double selectorValue) const {
        keepAlive_->ensureOpen();
        Abc::IObject copyObj = obj_;
        return static_cast<int>(AbcG::GetVisibility(copyObj, makeSampleSelector(selectorMode, selectorValue)));
    }

    bool isAncestorInvisible(int selectorMode, double selectorValue) const {
        keepAlive_->ensureOpen();
        return AbcG::IsAncestorInvisible(obj_, makeSampleSelector(selectorMode, selectorValue));
    }

    std::shared_ptr<IScalarWrap> getVisibilityProperty() const {
        keepAlive_->ensureOpen();
        Abc::IObject copyObj = obj_;
        AbcG::IVisibilityProperty visProp = AbcG::GetVisibilityProperty(copyObj);
        if (!visProp.valid()) return nullptr;
        return std::make_shared<IScalarWrap>(visProp, keepAlive_);
    }

    const Abc::IObject& raw() const { keepAlive_->ensureOpen(); return obj_; }
    ReaderKeepAlivePtr keepAlive() const { return keepAlive_; }

private:
    Abc::IObject obj_;
    ReaderKeepAlivePtr keepAlive_;
};

// ============================================================================
// Writer Property & Object Wrappers
// ============================================================================

class OScalarWrap final : public ResettableWriterHandle {
public:
    OScalarWrap(Abc::OScalarProperty prop, std::shared_ptr<ArchiveWriterContext> writerCtx)
        : prop_(std::move(prop)), writerCtx_(std::move(writerCtx)) {}

    void resetNative() override { prop_.reset(); }

    bool valid() const { return !writerCtx_->isFinalized() && prop_.valid(); }
    std::string getName() const { writerCtx_->ensureWritable(); return prop_.getName(); }
    int getPod() const { writerCtx_->ensureWritable(); return static_cast<int>(prop_.getDataType().getPod()); }
    int getExtent() const { writerCtx_->ensureWritable(); return static_cast<int>(prop_.getDataType().getExtent()); }
    std::size_t getNumSamples() const { writerCtx_->ensureWritable(); return prop_.getNumSamples(); }

    void setNumericSample(std::uintptr_t ptr, std::size_t byteLength);
    void setFloat32AsFloat16Sample(std::uintptr_t ptr, std::size_t floatCount);
    void setSpecialSample(const emscripten::val& jsArray);
    void setFromPrevious() { writerCtx_->ensureWritable(); prop_.setFromPrevious(); }
    void setTimeSampling(std::uint32_t tsIndex) { writerCtx_->ensureWritable(); prop_.setTimeSampling(tsIndex); }

private:
    Abc::OScalarProperty prop_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

class OArrayWrap final : public ResettableWriterHandle {
public:
    OArrayWrap(Abc::OArrayProperty prop, std::shared_ptr<ArchiveWriterContext> writerCtx)
        : prop_(std::move(prop)), writerCtx_(std::move(writerCtx)) {}

    void resetNative() override { prop_.reset(); }

    bool valid() const { return !writerCtx_->isFinalized() && prop_.valid(); }
    std::string getName() const { writerCtx_->ensureWritable(); return prop_.getName(); }
    int getPod() const { writerCtx_->ensureWritable(); return static_cast<int>(prop_.getDataType().getPod()); }
    int getExtent() const { writerCtx_->ensureWritable(); return static_cast<int>(prop_.getDataType().getExtent()); }
    std::size_t getNumSamples() const { writerCtx_->ensureWritable(); return prop_.getNumSamples(); }

    void setNumericSample(std::uintptr_t ptr, std::size_t tupleCount);
    void setFloat32AsFloat16Sample(std::uintptr_t ptr, std::size_t tupleCount);
    void setSpecialSample(const emscripten::val& jsArray);
    void setFromPrevious() { writerCtx_->ensureWritable(); prop_.setFromPrevious(); }
    void setTimeSampling(std::uint32_t tsIndex) { writerCtx_->ensureWritable(); prop_.setTimeSampling(tsIndex); }

private:
    Abc::OArrayProperty prop_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

class GenericOGeomParam final : public ResettableWriterHandle {
public:
    GenericOGeomParam(
        Abc::OCompoundProperty parent,
        const std::string& name,
        int pod,
        int extent,
        int arrayExtent,
        const std::string& interpretation,
        bool isIndexed,
        int scope,
        std::uint32_t tsIndex,
        const emscripten::val& extraMeta,
        std::shared_ptr<ArchiveWriterContext> writerCtx
    );

    void resetNative() override {
        indicesProp_.reset();
        valProp_.reset();
        cprop_.reset();
    }

    bool valid() const { return !writerCtx_->isFinalized() && valProp_.valid(); }
    std::string getName() const { return name_; }
    bool isIndexed() const { return isIndexed_; }
    int getScope() const { return static_cast<int>(scope_); }
    int getPod() const { return static_cast<int>(dataType_.getPod()); }
    int getExtent() const { return static_cast<int>(dataType_.getExtent()); }
    std::size_t getNumSamples() const;

    void setNumericSample(
        std::uintptr_t valsPtr,
        std::size_t valsTupleCount,
        std::uintptr_t indicesPtr,
        std::size_t indicesCount
    );
    void setSpecialSample(
        const emscripten::val& jsVals,
        std::uintptr_t indicesPtr,
        std::size_t indicesCount
    );
    void setFromPrevious();
    void setTimeSampling(std::uint32_t tsIndex);

private:
    std::string name_;
    AbcA::DataType dataType_;
    bool isIndexed_ = false;
    AbcG::GeometryScope scope_ = AbcG::kUnknownScope;
    Abc::OCompoundProperty cprop_;
    Abc::OArrayProperty valProp_;
    Abc::OUInt32ArrayProperty indicesProp_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

class OCompoundWrap final : public ResettableWriterHandle {
public:
    OCompoundWrap(Abc::OCompoundProperty prop, std::shared_ptr<ArchiveWriterContext> writerCtx)
        : prop_(std::move(prop)), writerCtx_(std::move(writerCtx)) {}

    void resetNative() override { prop_.reset(); }

    bool valid() const { return !writerCtx_->isFinalized() && prop_.valid(); }
    std::string getName() const { writerCtx_->ensureWritable(); return prop_.getName(); }
    emscripten::val getMetaData() const { writerCtx_->ensureWritable(); return metaDataToVal(prop_.getMetaData()); }

    std::shared_ptr<OCompoundWrap> createCompoundProperty(
        const std::string& name,
        const emscripten::val& metaObj
    );
    std::shared_ptr<OScalarWrap> createScalarProperty(
        const std::string& name,
        int pod,
        int extent,
        const std::string& interpretation,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );
    std::shared_ptr<OArrayWrap> createArrayProperty(
        const std::string& name,
        int pod,
        int extent,
        const std::string& interpretation,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );
    std::shared_ptr<GenericOGeomParam> createGeomParam(
        const std::string& name,
        int pod,
        int extent,
        int arrayExtent,
        const std::string& interpretation,
        bool isIndexed,
        int scope,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );

    Abc::OCompoundProperty& raw() { writerCtx_->ensureWritable(); return prop_; }
    std::shared_ptr<ArchiveWriterContext> writerCtx() const { return writerCtx_; }

private:
    Abc::OCompoundProperty prop_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

class OObjectWrap final : public ResettableWriterHandle {
public:
    OObjectWrap(Abc::OObject obj, std::shared_ptr<ArchiveWriterContext> writerCtx)
        : obj_(std::move(obj)), writerCtx_(std::move(writerCtx)) {}

    void resetNative() override {
        visProp_.reset();
        obj_.reset();
    }

    bool valid() const { return !writerCtx_->isFinalized() && obj_.valid(); }
    std::string getName() const { writerCtx_->ensureWritable(); return obj_.getName(); }
    std::string getFullName() const { writerCtx_->ensureWritable(); return obj_.getFullName(); }
    emscripten::val getMetaData() const { writerCtx_->ensureWritable(); return metaDataToVal(obj_.getMetaData()); }
    std::size_t getNumChildren() { writerCtx_->ensureWritable(); return obj_.getNumChildren(); }

    std::shared_ptr<OObjectWrap> addChild(const std::string& name, const emscripten::val& metaObj);
    bool addChildInstance(const std::shared_ptr<OObjectWrap>& target, const std::string& name);
    std::shared_ptr<OCompoundWrap> getProperties();

    void setVisibility(int visValue, std::uint32_t tsIndex);

    Abc::OObject& raw() { writerCtx_->ensureWritable(); return obj_; }
    std::shared_ptr<ArchiveWriterContext> writerCtx() const { return writerCtx_; }

private:
    Abc::OObject obj_;
    AbcG::OVisibilityProperty visProp_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

} // namespace abc_wasm
