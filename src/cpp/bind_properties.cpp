#include "abc_wasm/properties.h"

namespace abc_wasm {

namespace {

emscripten::val headerToVal(const AbcA::PropertyHeader& ph, const Abc::ICompoundProperty& parent) {
    emscripten::val obj = emscripten::val::object();
    obj.set("name", ph.getName());
    int propType = ph.isCompound() ? 0 : (ph.isScalar() ? 1 : 2);
    obj.set("propertyType", propType);
    obj.set("pod", static_cast<int>(ph.getDataType().getPod()));
    obj.set("extent", static_cast<int>(ph.getDataType().getExtent()));
    obj.set("interpretation", ph.getMetaData().get("interpretation"));
    obj.set("metaData", metaDataToVal(ph.getMetaData()));

    bool isGeomParam = false;
    if (ph.getMetaData().get("isGeomParam") == "true") {
        isGeomParam = true;
    } else if (ph.isCompound()) {
        Abc::ICompoundProperty sub(parent, ph.getName());
        if (sub.getPropertyHeader(".vals") != nullptr && sub.getPropertyHeader(".indices") != nullptr) {
            isGeomParam = true;
        }
    } else if (ph.isArray() && ph.getMetaData().get("geoScope") != "") {
        isGeomParam = true;
    }
    obj.set("isGeomParam", isGeomParam);
    return obj;
}

std::wstring utf8ToWString(const std::string& str) {
    std::wstring ws;
    ws.reserve(str.size());
    std::size_t i = 0;
    while (i < str.size()) {
        std::uint32_t cp = 0;
        unsigned char c = static_cast<unsigned char>(str[i]);
        if (c < 0x80) {
            cp = c;
            i += 1;
        } else if ((c & 0xE0) == 0xC0 && i + 1 < str.size()) {
            cp = ((c & 0x1F) << 6) | (static_cast<unsigned char>(str[i + 1]) & 0x3F);
            i += 2;
        } else if ((c & 0xF0) == 0xE0 && i + 2 < str.size()) {
            cp = ((c & 0x0F) << 12) |
                 ((static_cast<unsigned char>(str[i + 1]) & 0x3F) << 6) |
                 (static_cast<unsigned char>(str[i + 2]) & 0x3F);
            i += 3;
        } else if ((c & 0xF8) == 0xF0 && i + 3 < str.size()) {
            cp = ((c & 0x07) << 18) |
                 ((static_cast<unsigned char>(str[i + 1]) & 0x3F) << 12) |
                 ((static_cast<unsigned char>(str[i + 2]) & 0x3F) << 6) |
                 (static_cast<unsigned char>(str[i + 3]) & 0x3F);
            i += 4;
        } else {
            cp = c;
            i += 1;
        }
        ws.push_back(static_cast<wchar_t>(cp));
    }
    return ws;
}

std::string wstringToUtf8(const std::wstring& ws) {
    std::string out;
    out.reserve(ws.size());
    for (wchar_t wc : ws) {
        std::uint32_t cp = static_cast<std::uint32_t>(wc);
        if (cp < 0x80) {
            out.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else if (cp < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
    }
    return out;
}

} // namespace

// ============================================================================
// IScalarWrap
// ============================================================================

BufferViewDesc IScalarWrap::getNumericSample(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    const AbcA::DataType& dt = prop_.getDataType();
    AbcU::PlainOldDataType pod = dt.getPod();
    if (pod == AbcU::kStringPOD || pod == AbcU::kWstringPOD) {
        throw std::runtime_error("Use getSpecialSample for string/wstring scalar properties.");
    }
    std::size_t bytes = dt.getNumBytes();
    scratch_.resize(bytes, 0);
    prop_.get(scratch_.data(), makeSampleSelector(selectorMode, selectorValue));

    BufferViewDesc desc;
    desc.ptr = scratch_.empty() ? 0 : reinterpret_cast<std::uintptr_t>(scratch_.data());
    desc.length = 1;
    desc.pod = static_cast<int>(pod);
    desc.extent = static_cast<int>(dt.getExtent());
    desc.byteLength = bytes;
    return desc;
}

BufferViewDesc IScalarWrap::getFloat16AsFloat32Sample(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    const AbcA::DataType& dt = prop_.getDataType();
    if (dt.getPod() != AbcU::kFloat16POD) {
        throw std::runtime_error("Property is not kFloat16POD.");
    }
    std::size_t count = dt.getExtent();
    std::vector<Imath::half> halves(count);
    prop_.get(halves.data(), makeSampleSelector(selectorMode, selectorValue));
    floatScratch_.resize(count);
    for (std::size_t i = 0; i < count; ++i) {
        floatScratch_[i] = static_cast<float>(halves[i]);
    }
    BufferViewDesc desc;
    desc.ptr = floatScratch_.empty() ? 0 : reinterpret_cast<std::uintptr_t>(floatScratch_.data());
    desc.length = 1;
    desc.pod = static_cast<int>(AbcU::kFloat32POD);
    desc.extent = static_cast<int>(count);
    desc.byteLength = count * sizeof(float);
    return desc;
}

emscripten::val IScalarWrap::getSpecialSample(int selectorMode, double selectorValue) const {
    keepAlive_->ensureOpen();
    const AbcA::DataType& dt = prop_.getDataType();
    AbcU::PlainOldDataType pod = dt.getPod();
    std::size_t extent = dt.getExtent();
    Abc::ISampleSelector sel = makeSampleSelector(selectorMode, selectorValue);
    emscripten::val arr = emscripten::val::array();

    if (pod == AbcU::kBooleanPOD) {
        std::vector<AbcU::bool_t> vals(extent);
        prop_.get(vals.data(), sel);
        for (std::size_t i = 0; i < extent; ++i) {
            arr.set(i, static_cast<bool>(vals[i]));
        }
    } else if (pod == AbcU::kStringPOD) {
        std::vector<std::string> vals(extent);
        prop_.get(vals.data(), sel);
        for (std::size_t i = 0; i < extent; ++i) {
            arr.set(i, vals[i]);
        }
    } else if (pod == AbcU::kWstringPOD) {
        std::vector<std::wstring> vals(extent);
        prop_.get(vals.data(), sel);
        for (std::size_t i = 0; i < extent; ++i) {
            arr.set(i, wstringToUtf8(vals[i]));
        }
    } else {
        throw std::runtime_error("Unsupported special scalar POD.");
    }
    return arr;
}

// ============================================================================
// IArrayWrap
// ============================================================================

BufferViewDesc IArrayWrap::getNumericSample(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    const AbcA::DataType& dt = prop_.getDataType();
    if (dt.getPod() == AbcU::kStringPOD || dt.getPod() == AbcU::kWstringPOD) {
        throw std::runtime_error("Use getSpecialSample for string/wstring array properties.");
    }
    prop_.get(lastSample_, makeSampleSelector(selectorMode, selectorValue));
    return makeBufferViewFromArraySample(lastSample_);
}

BufferViewDesc IArrayWrap::getFloat16AsFloat32Sample(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    const AbcA::DataType& dt = prop_.getDataType();
    if (dt.getPod() != AbcU::kFloat16POD) {
        throw std::runtime_error("Array property is not kFloat16POD.");
    }
    prop_.get(lastSample_, makeSampleSelector(selectorMode, selectorValue));
    BufferViewDesc desc;
    desc.pod = static_cast<int>(AbcU::kFloat32POD);
    desc.extent = static_cast<int>(dt.getExtent());
    if (!lastSample_ || lastSample_->size() == 0 || lastSample_->getData() == nullptr) {
        return desc;
    }
    std::size_t tuples = lastSample_->size();
    std::size_t totalScalars = tuples * dt.getExtent();
    const Imath::half* src = static_cast<const Imath::half*>(lastSample_->getData());
    floatScratch_.resize(totalScalars);
    for (std::size_t i = 0; i < totalScalars; ++i) {
        floatScratch_[i] = static_cast<float>(src[i]);
    }
    desc.ptr = reinterpret_cast<std::uintptr_t>(floatScratch_.data());
    desc.length = tuples;
    desc.byteLength = totalScalars * sizeof(float);
    return desc;
}

emscripten::val IArrayWrap::getSpecialSample(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    const AbcA::DataType& dt = prop_.getDataType();
    AbcU::PlainOldDataType pod = dt.getPod();
    prop_.get(lastSample_, makeSampleSelector(selectorMode, selectorValue));
    emscripten::val arr = emscripten::val::array();
    if (!lastSample_ || lastSample_->size() == 0 || lastSample_->getData() == nullptr) {
        return arr;
    }
    std::size_t totalScalars = lastSample_->size() * dt.getExtent();
    if (pod == AbcU::kBooleanPOD) {
        const AbcU::bool_t* src = static_cast<const AbcU::bool_t*>(lastSample_->getData());
        for (std::size_t i = 0; i < totalScalars; ++i) {
            arr.set(i, static_cast<bool>(src[i]));
        }
    } else if (pod == AbcU::kStringPOD) {
        const std::string* src = static_cast<const std::string*>(lastSample_->getData());
        for (std::size_t i = 0; i < totalScalars; ++i) {
            arr.set(i, src[i]);
        }
    } else if (pod == AbcU::kWstringPOD) {
        const std::wstring* src = static_cast<const std::wstring*>(lastSample_->getData());
        for (std::size_t i = 0; i < totalScalars; ++i) {
            arr.set(i, wstringToUtf8(src[i]));
        }
    } else {
        throw std::runtime_error("Unsupported special array POD.");
    }
    return arr;
}

emscripten::val IArrayWrap::getDimensions(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    AbcU::Dimensions dims;
    prop_.getDimensions(dims, makeSampleSelector(selectorMode, selectorValue));
    emscripten::val arr = emscripten::val::array();
    for (std::size_t i = 0; i < dims.rank(); ++i) {
        arr.set(i, static_cast<std::uint32_t>(dims[i]));
    }
    return arr;
}

// ============================================================================
// GenericIGeomParam
// ============================================================================

GenericIGeomParam::GenericIGeomParam(
    const Abc::ICompoundProperty& parent,
    const std::string& name,
    ReaderKeepAlivePtr keepAlive
) : name_(name), keepAlive_(std::move(keepAlive)) {
    keepAlive_->ensureOpen();
    const AbcA::PropertyHeader* ph = parent.getPropertyHeader(name);
    if (!ph) {
        throw std::runtime_error("GeomParam not found: " + name);
    }
    metaData_ = ph->getMetaData();
    scope_ = AbcG::GetGeometryScope(metaData_);
    std::string arrExtStr = metaData_.get("arrayExtent");
    if (!arrExtStr.empty()) {
        int parsed = std::atoi(arrExtStr.c_str());
        if (parsed > 0) arrayExtent_ = parsed;
    }

    if (ph->isCompound()) {
        cprop_ = Abc::ICompoundProperty(parent, name);
        valProp_ = Abc::IArrayProperty(cprop_, ".vals");
        if (cprop_.getPropertyHeader(".indices") != nullptr) {
            indicesProp_ = Abc::IArrayProperty(cprop_, ".indices");
            isIndexed_ = true;
        }
    } else if (ph->isArray()) {
        valProp_ = Abc::IArrayProperty(parent, name);
        isIndexed_ = false;
    } else {
        throw std::runtime_error("Property is not an array or indexed compound GeomParam: " + name);
    }
    interpretation_ = valProp_.getMetaData().get("interpretation");
    if (interpretation_.empty()) {
        interpretation_ = metaData_.get("interpretation");
    }
}

std::size_t GenericIGeomParam::getNumSamples() const {
    keepAlive_->ensureOpen();
    if (isIndexed_ && indicesProp_.valid()) {
        return std::max(valProp_.getNumSamples(), indicesProp_.getNumSamples());
    }
    return valProp_.getNumSamples();
}

bool GenericIGeomParam::isConstant() const {
    keepAlive_->ensureOpen();
    if (isIndexed_ && indicesProp_.valid()) {
        return valProp_.isConstant() && indicesProp_.isConstant();
    }
    return valProp_.isConstant();
}

std::uint32_t GenericIGeomParam::getTimeSamplingIndex() const {
    keepAlive_->ensureOpen();
    return findTimeSamplingIndex(valProp_.getObject().getArchive(), valProp_.getTimeSampling());
}

BufferViewDesc GenericIGeomParam::getExpandedNumericSample(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    const AbcA::DataType& dt = valProp_.getDataType();
    if (dt.getPod() == AbcU::kStringPOD || dt.getPod() == AbcU::kWstringPOD) {
        throw std::runtime_error("Expanded numeric sample not supported for string GeomParams.");
    }
    Abc::ISampleSelector sel = makeSampleSelector(selectorMode, selectorValue);
    valProp_.get(lastVals_, sel);
    if (!isIndexed_ || !indicesProp_.valid()) {
        return makeBufferViewFromArraySample(lastVals_);
    }

    indicesProp_.get(lastIndices_, sel);
    BufferViewDesc desc;
    desc.pod = static_cast<int>(dt.getPod());
    desc.extent = static_cast<int>(dt.getExtent());
    if (!lastVals_ || !lastIndices_ || lastIndices_->size() == 0 || lastVals_->size() == 0) {
        return desc;
    }

    std::size_t idxCount = lastIndices_->size();
    std::size_t valCount = lastVals_->size();
    std::size_t elemBytes = dt.getNumBytes();
    const std::uint8_t* valBytes = static_cast<const std::uint8_t*>(lastVals_->getData());
    const std::uint32_t* indices = static_cast<const std::uint32_t*>(lastIndices_->getData());

    expandedScratch_.resize(idxCount * elemBytes);
    for (std::size_t i = 0; i < idxCount; ++i) {
        std::uint32_t vIdx = indices[i];
        if (vIdx < valCount) {
            std::memcpy(expandedScratch_.data() + i * elemBytes, valBytes + vIdx * elemBytes, elemBytes);
        } else {
            std::memset(expandedScratch_.data() + i * elemBytes, 0, elemBytes);
        }
    }
    desc.ptr = reinterpret_cast<std::uintptr_t>(expandedScratch_.data());
    desc.length = idxCount;
    desc.byteLength = expandedScratch_.size();
    return desc;
}

// ============================================================================
// ICompoundWrap
// ============================================================================

emscripten::val ICompoundWrap::getPropertyHeaderInfo(std::size_t index) const {
    keepAlive_->ensureOpen();
    if (!prop_.valid() || index >= prop_.getNumProperties()) {
        throw std::out_of_range("Property index out of range.");
    }
    return headerToVal(prop_.getPropertyHeader(index), prop_);
}

emscripten::val ICompoundWrap::getPropertyHeaderByName(const std::string& name) const {
    keepAlive_->ensureOpen();
    if (!prop_.valid()) return emscripten::val::null();
    const AbcA::PropertyHeader* ph = prop_.getPropertyHeader(name);
    if (!ph) return emscripten::val::null();
    return headerToVal(*ph, prop_);
}

std::shared_ptr<ICompoundWrap> ICompoundWrap::getCompoundProperty(const std::string& name) const {
    keepAlive_->ensureOpen();
    if (!prop_.valid() || prop_.getPropertyHeader(name) == nullptr) return nullptr;
    return std::make_shared<ICompoundWrap>(Abc::ICompoundProperty(prop_, name), keepAlive_);
}

std::shared_ptr<IScalarWrap> ICompoundWrap::getScalarProperty(const std::string& name) const {
    keepAlive_->ensureOpen();
    if (!prop_.valid() || prop_.getPropertyHeader(name) == nullptr) return nullptr;
    return std::make_shared<IScalarWrap>(Abc::IScalarProperty(prop_, name), keepAlive_);
}

std::shared_ptr<IArrayWrap> ICompoundWrap::getArrayProperty(const std::string& name) const {
    keepAlive_->ensureOpen();
    if (!prop_.valid() || prop_.getPropertyHeader(name) == nullptr) return nullptr;
    return std::make_shared<IArrayWrap>(Abc::IArrayProperty(prop_, name), keepAlive_);
}

std::shared_ptr<GenericIGeomParam> ICompoundWrap::getGeomParam(const std::string& name) const {
    keepAlive_->ensureOpen();
    if (!prop_.valid() || prop_.getPropertyHeader(name) == nullptr) return nullptr;
    return std::make_shared<GenericIGeomParam>(prop_, name, keepAlive_);
}

// ============================================================================
// OScalarWrap / OArrayWrap / GenericOGeomParam / OCompoundWrap
// ============================================================================

void OScalarWrap::setNumericSample(std::uintptr_t ptr, std::size_t byteLength) {
    writerCtx_->ensureWritable();
    const AbcA::DataType& dt = prop_.getDataType();
    if (byteLength < dt.getNumBytes()) {
        throw std::runtime_error("Scalar sample buffer smaller than DataType byte size.");
    }
    prop_.set(reinterpret_cast<const void*>(ptr));
}

void OScalarWrap::setFloat32AsFloat16Sample(std::uintptr_t ptr, std::size_t floatCount) {
    writerCtx_->ensureWritable();
    const AbcA::DataType& dt = prop_.getDataType();
    if (dt.getPod() != AbcU::kFloat16POD) {
        throw std::runtime_error("Scalar property is not kFloat16POD.");
    }
    std::size_t extent = dt.getExtent();
    if (floatCount < extent) {
        throw std::runtime_error("Insufficient float32 elements for float16 scalar sample.");
    }
    const float* src = reinterpret_cast<const float*>(ptr);
    std::vector<Imath::half> halves(extent);
    for (std::size_t i = 0; i < extent; ++i) {
        halves[i] = Imath::half(src[i]);
    }
    prop_.set(halves.data());
}

void OScalarWrap::setSpecialSample(const emscripten::val& jsArray) {
    writerCtx_->ensureWritable();
    const AbcA::DataType& dt = prop_.getDataType();
    AbcU::PlainOldDataType pod = dt.getPod();
    std::size_t extent = dt.getExtent();

    if (pod == AbcU::kBooleanPOD) {
        std::vector<AbcU::bool_t> vals(extent, false);
        int len = jsArray["length"].as<int>();
        for (std::size_t i = 0; i < extent && static_cast<int>(i) < len; ++i) {
            vals[i] = jsArray[i].as<bool>();
        }
        prop_.set(vals.data());
    } else if (pod == AbcU::kStringPOD) {
        std::vector<std::string> vals(extent);
        int len = jsArray["length"].as<int>();
        for (std::size_t i = 0; i < extent && static_cast<int>(i) < len; ++i) {
            vals[i] = jsArray[i].as<std::string>();
        }
        prop_.set(vals.data());
    } else if (pod == AbcU::kWstringPOD) {
        std::vector<std::wstring> vals(extent);
        int len = jsArray["length"].as<int>();
        for (std::size_t i = 0; i < extent && static_cast<int>(i) < len; ++i) {
            vals[i] = utf8ToWString(jsArray[i].as<std::string>());
        }
        prop_.set(vals.data());
    } else {
        throw std::runtime_error("Unsupported POD for setSpecialSample.");
    }
}

void OArrayWrap::setNumericSample(std::uintptr_t ptr, std::size_t tupleCount) {
    writerCtx_->ensureWritable();
    const AbcA::DataType& dt = prop_.getDataType();
    const void* dataPtr = (tupleCount == 0) ? nullptr : reinterpret_cast<const void*>(ptr);
    AbcA::ArraySample samp(dataPtr, dt, AbcU::Dimensions(tupleCount));
    prop_.set(samp);
}

void OArrayWrap::setFloat32AsFloat16Sample(std::uintptr_t ptr, std::size_t tupleCount) {
    writerCtx_->ensureWritable();
    const AbcA::DataType& dt = prop_.getDataType();
    if (dt.getPod() != AbcU::kFloat16POD) {
        throw std::runtime_error("Array property is not kFloat16POD.");
    }
    std::size_t totalScalars = tupleCount * dt.getExtent();
    std::vector<Imath::half> halves(totalScalars);
    if (totalScalars > 0 && ptr != 0) {
        const float* src = reinterpret_cast<const float*>(ptr);
        for (std::size_t i = 0; i < totalScalars; ++i) {
            halves[i] = Imath::half(src[i]);
        }
    }
    const void* dataPtr = halves.empty() ? nullptr : halves.data();
    AbcA::ArraySample samp(dataPtr, dt, AbcU::Dimensions(tupleCount));
    prop_.set(samp);
}

void OArrayWrap::setSpecialSample(const emscripten::val& jsArray) {
    writerCtx_->ensureWritable();
    const AbcA::DataType& dt = prop_.getDataType();
    AbcU::PlainOldDataType pod = dt.getPod();
    std::size_t extent = dt.getExtent();
    int totalScalars = jsArray["length"].as<int>();
    std::size_t tupleCount = (extent > 0) ? (static_cast<std::size_t>(totalScalars) / extent) : 0;

    if (pod == AbcU::kBooleanPOD) {
        std::vector<AbcU::bool_t> vals(tupleCount * extent);
        for (std::size_t i = 0; i < vals.size(); ++i) {
            vals[i] = jsArray[i].as<bool>();
        }
        AbcA::ArraySample samp(vals.empty() ? nullptr : vals.data(), dt, AbcU::Dimensions(tupleCount));
        prop_.set(samp);
    } else if (pod == AbcU::kStringPOD) {
        std::vector<std::string> vals(tupleCount * extent);
        for (std::size_t i = 0; i < vals.size(); ++i) {
            vals[i] = jsArray[i].as<std::string>();
        }
        AbcA::ArraySample samp(vals.empty() ? nullptr : vals.data(), dt, AbcU::Dimensions(tupleCount));
        prop_.set(samp);
    } else if (pod == AbcU::kWstringPOD) {
        std::vector<std::wstring> vals(tupleCount * extent);
        for (std::size_t i = 0; i < vals.size(); ++i) {
            vals[i] = utf8ToWString(jsArray[i].as<std::string>());
        }
        AbcA::ArraySample samp(vals.empty() ? nullptr : vals.data(), dt, AbcU::Dimensions(tupleCount));
        prop_.set(samp);
    } else {
        throw std::runtime_error("Unsupported POD for OArrayWrap::setSpecialSample.");
    }
}

GenericOGeomParam::GenericOGeomParam(
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
) : name_(name),
    dataType_(static_cast<AbcU::PlainOldDataType>(pod), static_cast<std::uint8_t>(extent)),
    isIndexed_(isIndexed),
    scope_(static_cast<AbcG::GeometryScope>(scope)),
    writerCtx_(std::move(writerCtx)) {
    writerCtx_->ensureWritable();

    AbcA::MetaData md = valToMetaData(extraMeta);
    AbcG::SetGeometryScope(md, scope_);
    md.set("isGeomParam", "true");
    md.set("podName", std::string(AbcU::PODName(dataType_.getPod())));
    md.set("podExtent", std::to_string(extent));
    md.set("arrayExtent", std::to_string(arrayExtent > 0 ? arrayExtent : 1));
    md.set("interpretation", interpretation);

    if (isIndexed_) {
        cprop_ = Abc::OCompoundProperty(parent, name, md);
        valProp_ = Abc::OArrayProperty(cprop_, ".vals", dataType_, md, tsIndex);
        indicesProp_ = Abc::OUInt32ArrayProperty(cprop_, ".indices", tsIndex);
    } else {
        valProp_ = Abc::OArrayProperty(parent, name, dataType_, md, tsIndex);
    }
}

std::size_t GenericOGeomParam::getNumSamples() const {
    writerCtx_->ensureWritable();
    if (isIndexed_ && indicesProp_.valid()) {
        return std::max(valProp_.getNumSamples(), indicesProp_.getNumSamples());
    }
    return valProp_.getNumSamples();
}

void GenericOGeomParam::setNumericSample(
    std::uintptr_t valsPtr,
    std::size_t valsTupleCount,
    std::uintptr_t indicesPtr,
    std::size_t indicesCount
) {
    writerCtx_->ensureWritable();
    if (dataType_.getPod() == AbcU::kFloat16POD) {
        std::size_t totalScalars = valsTupleCount * dataType_.getExtent();
        std::vector<Imath::half> halves(totalScalars);
        if (totalScalars > 0 && valsPtr != 0) {
            const float* src = reinterpret_cast<const float*>(valsPtr);
            for (std::size_t i = 0; i < totalScalars; ++i) {
                halves[i] = Imath::half(src[i]);
            }
        }
        AbcA::ArraySample valSamp(halves.empty() ? nullptr : halves.data(), dataType_, AbcU::Dimensions(valsTupleCount));
        valProp_.set(valSamp);
    } else {
        const void* dataPtr = (valsTupleCount == 0) ? nullptr : reinterpret_cast<const void*>(valsPtr);
        AbcA::ArraySample valSamp(dataPtr, dataType_, AbcU::Dimensions(valsTupleCount));
        valProp_.set(valSamp);
    }

    if (isIndexed_) {
        const std::uint32_t* idxData = (indicesCount == 0) ? nullptr : reinterpret_cast<const std::uint32_t*>(indicesPtr);
        indicesProp_.set(Abc::UInt32ArraySample(idxData, indicesCount));
    }
}

void GenericOGeomParam::setSpecialSample(
    const emscripten::val& jsVals,
    std::uintptr_t indicesPtr,
    std::size_t indicesCount
) {
    writerCtx_->ensureWritable();
    AbcU::PlainOldDataType pod = dataType_.getPod();
    std::size_t extent = dataType_.getExtent();
    int totalScalars = jsVals["length"].as<int>();
    std::size_t tupleCount = (extent > 0) ? (static_cast<std::size_t>(totalScalars) / extent) : 0;

    if (pod == AbcU::kStringPOD) {
        std::vector<std::string> vals(tupleCount * extent);
        for (std::size_t i = 0; i < vals.size(); ++i) vals[i] = jsVals[i].as<std::string>();
        AbcA::ArraySample samp(vals.empty() ? nullptr : vals.data(), dataType_, AbcU::Dimensions(tupleCount));
        valProp_.set(samp);
    } else if (pod == AbcU::kWstringPOD) {
        std::vector<std::wstring> vals(tupleCount * extent);
        for (std::size_t i = 0; i < vals.size(); ++i) vals[i] = utf8ToWString(jsVals[i].as<std::string>());
        AbcA::ArraySample samp(vals.empty() ? nullptr : vals.data(), dataType_, AbcU::Dimensions(tupleCount));
        valProp_.set(samp);
    } else if (pod == AbcU::kBooleanPOD) {
        std::vector<AbcU::bool_t> vals(tupleCount * extent);
        for (std::size_t i = 0; i < vals.size(); ++i) vals[i] = jsVals[i].as<bool>();
        AbcA::ArraySample samp(vals.empty() ? nullptr : vals.data(), dataType_, AbcU::Dimensions(tupleCount));
        valProp_.set(samp);
    } else {
        throw std::runtime_error("Unsupported special POD for GenericOGeomParam.");
    }

    if (isIndexed_) {
        const std::uint32_t* idxData = (indicesCount == 0) ? nullptr : reinterpret_cast<const std::uint32_t*>(indicesPtr);
        indicesProp_.set(Abc::UInt32ArraySample(idxData, indicesCount));
    }
}

void GenericOGeomParam::setFromPrevious() {
    writerCtx_->ensureWritable();
    valProp_.setFromPrevious();
    if (isIndexed_) {
        indicesProp_.setFromPrevious();
    }
}

void GenericOGeomParam::setTimeSampling(std::uint32_t tsIndex) {
    writerCtx_->ensureWritable();
    valProp_.setTimeSampling(tsIndex);
    if (isIndexed_) {
        indicesProp_.setTimeSampling(tsIndex);
    }
}

std::shared_ptr<OCompoundWrap> OCompoundWrap::createCompoundProperty(
    const std::string& name,
    const emscripten::val& metaObj
) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    Abc::OCompoundProperty sub(prop_, name, md);
    auto wrap = std::make_shared<OCompoundWrap>(std::move(sub), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OScalarWrap> OCompoundWrap::createScalarProperty(
    const std::string& name,
    int pod,
    int extent,
    const std::string& interpretation,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    if (!interpretation.empty()) {
        md.set("interpretation", interpretation);
    }
    AbcA::DataType dt(static_cast<AbcU::PlainOldDataType>(pod), static_cast<std::uint8_t>(extent));
    Abc::OScalarProperty sp(prop_, name, dt, md, tsIndex);
    auto wrap = std::make_shared<OScalarWrap>(std::move(sp), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OArrayWrap> OCompoundWrap::createArrayProperty(
    const std::string& name,
    int pod,
    int extent,
    const std::string& interpretation,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    if (!interpretation.empty()) {
        md.set("interpretation", interpretation);
    }
    AbcA::DataType dt(static_cast<AbcU::PlainOldDataType>(pod), static_cast<std::uint8_t>(extent));
    Abc::OArrayProperty ap(prop_, name, dt, md, tsIndex);
    auto wrap = std::make_shared<OArrayWrap>(std::move(ap), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<GenericOGeomParam> OCompoundWrap::createGeomParam(
    const std::string& name,
    int pod,
    int extent,
    int arrayExtent,
    const std::string& interpretation,
    bool isIndexed,
    int scope,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<GenericOGeomParam>(
        prop_, name, pod, extent, arrayExtent, interpretation, isIndexed, scope, tsIndex, metaObj, writerCtx_
    );
    writerCtx_->registerHandle(wrap);
    return wrap;
}

EMSCRIPTEN_BINDINGS(abc_wasm_properties) {
    using namespace emscripten;

    class_<IScalarWrap>("IScalarWrap")
        .smart_ptr<std::shared_ptr<IScalarWrap>>("IScalarWrap")
        .function("valid", &IScalarWrap::valid)
        .function("getName", &IScalarWrap::getName)
        .function("getPod", &IScalarWrap::getPod)
        .function("getExtent", &IScalarWrap::getExtent)
        .function("getInterpretation", &IScalarWrap::getInterpretation)
        .function("getMetaData", &IScalarWrap::getMetaData)
        .function("getNumSamples", &IScalarWrap::getNumSamples)
        .function("isConstant", &IScalarWrap::isConstant)
        .function("getTimeSamplingIndex", &IScalarWrap::getTimeSamplingIndex)
        .function("getNumericSample", &IScalarWrap::getNumericSample)
        .function("getFloat16AsFloat32Sample", &IScalarWrap::getFloat16AsFloat32Sample)
        .function("getSpecialSample", &IScalarWrap::getSpecialSample);

    class_<IArrayWrap>("IArrayWrap")
        .smart_ptr<std::shared_ptr<IArrayWrap>>("IArrayWrap")
        .function("valid", &IArrayWrap::valid)
        .function("getName", &IArrayWrap::getName)
        .function("getPod", &IArrayWrap::getPod)
        .function("getExtent", &IArrayWrap::getExtent)
        .function("getInterpretation", &IArrayWrap::getInterpretation)
        .function("getMetaData", &IArrayWrap::getMetaData)
        .function("getNumSamples", &IArrayWrap::getNumSamples)
        .function("isConstant", &IArrayWrap::isConstant)
        .function("getTimeSamplingIndex", &IArrayWrap::getTimeSamplingIndex)
        .function("getNumericSample", &IArrayWrap::getNumericSample)
        .function("getFloat16AsFloat32Sample", &IArrayWrap::getFloat16AsFloat32Sample)
        .function("getSpecialSample", &IArrayWrap::getSpecialSample)
        .function("getDimensions", &IArrayWrap::getDimensions);

    class_<GenericIGeomParam>("GenericIGeomParam")
        .smart_ptr<std::shared_ptr<GenericIGeomParam>>("GenericIGeomParam")
        .function("valid", &GenericIGeomParam::valid)
        .function("getName", &GenericIGeomParam::getName)
        .function("isIndexed", &GenericIGeomParam::isIndexed)
        .function("getScope", &GenericIGeomParam::getScope)
        .function("getPod", &GenericIGeomParam::getPod)
        .function("getExtent", &GenericIGeomParam::getExtent)
        .function("getArrayExtent", &GenericIGeomParam::getArrayExtent)
        .function("getInterpretation", &GenericIGeomParam::getInterpretation)
        .function("getMetaData", &GenericIGeomParam::getMetaData)
        .function("getNumSamples", &GenericIGeomParam::getNumSamples)
        .function("isConstant", &GenericIGeomParam::isConstant)
        .function("getTimeSamplingIndex", &GenericIGeomParam::getTimeSamplingIndex)
        .function("getValueProperty", &GenericIGeomParam::getValueProperty)
        .function("getIndexProperty", &GenericIGeomParam::getIndexProperty)
        .function("getExpandedNumericSample", &GenericIGeomParam::getExpandedNumericSample);

    class_<ICompoundWrap>("ICompoundWrap")
        .smart_ptr<std::shared_ptr<ICompoundWrap>>("ICompoundWrap")
        .function("valid", &ICompoundWrap::valid)
        .function("getName", &ICompoundWrap::getName)
        .function("getMetaData", &ICompoundWrap::getMetaData)
        .function("getNumProperties", &ICompoundWrap::getNumProperties)
        .function("getPropertyHeaderInfo", &ICompoundWrap::getPropertyHeaderInfo)
        .function("getPropertyHeaderByName", &ICompoundWrap::getPropertyHeaderByName)
        .function("hasProperty", &ICompoundWrap::hasProperty)
        .function("getCompoundProperty", &ICompoundWrap::getCompoundProperty)
        .function("getScalarProperty", &ICompoundWrap::getScalarProperty)
        .function("getArrayProperty", &ICompoundWrap::getArrayProperty)
        .function("getGeomParam", &ICompoundWrap::getGeomParam);

    class_<OScalarWrap>("OScalarWrap")
        .smart_ptr<std::shared_ptr<OScalarWrap>>("OScalarWrap")
        .function("valid", &OScalarWrap::valid)
        .function("getName", &OScalarWrap::getName)
        .function("getPod", &OScalarWrap::getPod)
        .function("getExtent", &OScalarWrap::getExtent)
        .function("getNumSamples", &OScalarWrap::getNumSamples)
        .function("setNumericSample", &OScalarWrap::setNumericSample)
        .function("setFloat32AsFloat16Sample", &OScalarWrap::setFloat32AsFloat16Sample)
        .function("setSpecialSample", &OScalarWrap::setSpecialSample)
        .function("setFromPrevious", &OScalarWrap::setFromPrevious)
        .function("setTimeSampling", &OScalarWrap::setTimeSampling);

    class_<OArrayWrap>("OArrayWrap")
        .smart_ptr<std::shared_ptr<OArrayWrap>>("OArrayWrap")
        .function("valid", &OArrayWrap::valid)
        .function("getName", &OArrayWrap::getName)
        .function("getPod", &OArrayWrap::getPod)
        .function("getExtent", &OArrayWrap::getExtent)
        .function("getNumSamples", &OArrayWrap::getNumSamples)
        .function("setNumericSample", &OArrayWrap::setNumericSample)
        .function("setFloat32AsFloat16Sample", &OArrayWrap::setFloat32AsFloat16Sample)
        .function("setSpecialSample", &OArrayWrap::setSpecialSample)
        .function("setFromPrevious", &OArrayWrap::setFromPrevious)
        .function("setTimeSampling", &OArrayWrap::setTimeSampling);

    class_<GenericOGeomParam>("GenericOGeomParam")
        .smart_ptr<std::shared_ptr<GenericOGeomParam>>("GenericOGeomParam")
        .function("valid", &GenericOGeomParam::valid)
        .function("getName", &GenericOGeomParam::getName)
        .function("isIndexed", &GenericOGeomParam::isIndexed)
        .function("getScope", &GenericOGeomParam::getScope)
        .function("getPod", &GenericOGeomParam::getPod)
        .function("getExtent", &GenericOGeomParam::getExtent)
        .function("getNumSamples", &GenericOGeomParam::getNumSamples)
        .function("setNumericSample", &GenericOGeomParam::setNumericSample)
        .function("setSpecialSample", &GenericOGeomParam::setSpecialSample)
        .function("setFromPrevious", &GenericOGeomParam::setFromPrevious)
        .function("setTimeSampling", &GenericOGeomParam::setTimeSampling);

    class_<OCompoundWrap>("OCompoundWrap")
        .smart_ptr<std::shared_ptr<OCompoundWrap>>("OCompoundWrap")
        .function("valid", &OCompoundWrap::valid)
        .function("getName", &OCompoundWrap::getName)
        .function("getMetaData", &OCompoundWrap::getMetaData)
        .function("createCompoundProperty", &OCompoundWrap::createCompoundProperty)
        .function("createScalarProperty", &OCompoundWrap::createScalarProperty)
        .function("createArrayProperty", &OCompoundWrap::createArrayProperty)
        .function("createGeomParam", &OCompoundWrap::createGeomParam);
}

} // namespace abc_wasm
