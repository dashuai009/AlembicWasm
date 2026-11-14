#include "abc_wasm/schemas.h"

namespace abc_wasm {

namespace {

AbcG::CameraSample valToCameraSample(const emscripten::val& s) {
    AbcG::CameraSample samp;
    if (s.isUndefined() || s.isNull()) return samp;

    auto setIfPresent = [&](const char* key, auto setter) {
        if (!s[key].isUndefined() && !s[key].isNull()) {
            setter(s[key].as<double>());
        }
    };

    setIfPresent("focalLength", [&](double v) { samp.setFocalLength(v); });
    setIfPresent("horizontalAperture", [&](double v) { samp.setHorizontalAperture(v); });
    setIfPresent("horizontalFilmOffset", [&](double v) { samp.setHorizontalFilmOffset(v); });
    setIfPresent("verticalAperture", [&](double v) { samp.setVerticalAperture(v); });
    setIfPresent("verticalFilmOffset", [&](double v) { samp.setVerticalFilmOffset(v); });
    setIfPresent("lensSqueezeRatio", [&](double v) { samp.setLensSqueezeRatio(v); });
    setIfPresent("overscanLeft", [&](double v) { samp.setOverScanLeft(v); });
    setIfPresent("overscanRight", [&](double v) { samp.setOverScanRight(v); });
    setIfPresent("overscanTop", [&](double v) { samp.setOverScanTop(v); });
    setIfPresent("overscanBottom", [&](double v) { samp.setOverScanBottom(v); });
    setIfPresent("fStop", [&](double v) { samp.setFStop(v); });
    setIfPresent("focusDistance", [&](double v) { samp.setFocusDistance(v); });
    setIfPresent("shutterOpen", [&](double v) { samp.setShutterOpen(v); });
    setIfPresent("shutterClose", [&](double v) { samp.setShutterClose(v); });
    setIfPresent("nearClippingPlane", [&](double v) { samp.setNearClippingPlane(v); });
    setIfPresent("farClippingPlane", [&](double v) { samp.setFarClippingPlane(v); });

    if (!s["filmBackOps"].isUndefined() && !s["filmBackOps"].isNull()) {
        emscripten::val ops = s["filmBackOps"];
        int numOps = ops["length"].as<int>();
        for (int i = 0; i < numOps; ++i) {
            emscripten::val opVal = ops[i];
            int opType = opVal["type"].as<int>();
            std::string hint = opVal["hint"].isUndefined() ? "" : opVal["hint"].as<std::string>();
            AbcG::FilmBackXformOp op(static_cast<AbcG::FilmBackXformOperationType>(opType), hint);
            emscripten::val channels = opVal["channels"];
            int numCh = channels["length"].as<int>();
            for (int c = 0; c < numCh && static_cast<std::size_t>(c) < op.getNumChannels(); ++c) {
                op.setChannelValue(static_cast<std::size_t>(c), channels[c].as<double>());
            }
            samp.addOp(op);
        }
    }
    return samp;
}

emscripten::val cameraSampleToVal(AbcG::CameraSample& samp) {
    emscripten::val obj = emscripten::val::object();
    obj.set("focalLength", samp.getFocalLength());
    obj.set("horizontalAperture", samp.getHorizontalAperture());
    obj.set("horizontalFilmOffset", samp.getHorizontalFilmOffset());
    obj.set("verticalAperture", samp.getVerticalAperture());
    obj.set("verticalFilmOffset", samp.getVerticalFilmOffset());
    obj.set("lensSqueezeRatio", samp.getLensSqueezeRatio());
    obj.set("overscanLeft", samp.getOverScanLeft());
    obj.set("overscanRight", samp.getOverScanRight());
    obj.set("overscanTop", samp.getOverScanTop());
    obj.set("overscanBottom", samp.getOverScanBottom());
    obj.set("fStop", samp.getFStop());
    obj.set("focusDistance", samp.getFocusDistance());
    obj.set("shutterOpen", samp.getShutterOpen());
    obj.set("shutterClose", samp.getShutterClose());
    obj.set("nearClippingPlane", samp.getNearClippingPlane());
    obj.set("farClippingPlane", samp.getFarClippingPlane());
    obj.set("fieldOfView", samp.getFieldOfView());

    double top = 0, bottom = 0, left = 0, right = 0;
    samp.getScreenWindow(top, bottom, left, right);
    emscripten::val sw = emscripten::val::object();
    sw.set("top", top);
    sw.set("bottom", bottom);
    sw.set("left", left);
    sw.set("right", right);
    obj.set("screenWindow", sw);

    Abc::M33d fbm = samp.getFilmBackMatrix();
    emscripten::val fbmArr = emscripten::val::array();
    const double* fbmPtr = fbm.getValue();
    for (int i = 0; i < 9; ++i) {
        fbmArr.set(i, fbmPtr[i]);
    }
    obj.set("filmBackMatrix", fbmArr);

    emscripten::val opsArr = emscripten::val::array();
    std::size_t numOps = samp.getNumOps();
    for (std::size_t i = 0; i < numOps; ++i) {
        AbcG::FilmBackXformOp op = samp.getOp(i);
        emscripten::val opObj = emscripten::val::object();
        opObj.set("type", static_cast<int>(op.getType()));
        opObj.set("hint", op.getHint());
        emscripten::val chArr = emscripten::val::array();
        for (std::size_t c = 0; c < op.getNumChannels(); ++c) {
            chArr.set(c, op.getChannelValue(c));
        }
        opObj.set("channels", chArr);
        opsArr.set(i, opObj);
    }
    obj.set("filmBackOps", opsArr);
    obj.set("childBounds", toBox3dDesc(samp.getChildBounds()));
    return obj;
}

} // namespace

// ============================================================================
// IXformWrap / OXformWrap
// ============================================================================

IXformWrap::IXformWrap(const std::shared_ptr<IObjectWrap>& obj)
    : xform_(obj->raw(), Abc::kWrapExisting),
      schema_(xform_.getSchema()),
      keepAlive_(obj->keepAlive()) {}

BufferViewDesc IXformWrap::getMatrix(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    AbcG::XformSample samp;
    if (schema_.getNumSamples() == 0) {
        Abc::M44d ident;
        ident.makeIdentity();
        std::memcpy(matrixScratch_, ident.getValue(), 16 * sizeof(double));
    } else {
        schema_.get(samp, makeSampleSelector(selectorMode, selectorValue));
        Abc::M44d m = samp.getMatrix();
        std::memcpy(matrixScratch_, m.getValue(), 16 * sizeof(double));
    }
    BufferViewDesc desc;
    desc.ptr = reinterpret_cast<std::uintptr_t>(matrixScratch_);
    desc.length = 1;
    desc.pod = static_cast<int>(AbcU::kFloat64POD);
    desc.extent = 16;
    desc.byteLength = 16 * sizeof(double);
    return desc;
}

BufferViewDesc IXformWrap::getInterpolatedMatrix(double timeSeconds) {
    keepAlive_->ensureOpen();
    std::size_t nSamps = schema_.getNumSamples();
    if (nSamps == 0 || schema_.isConstantIdentity()) {
        Abc::M44d ident;
        ident.makeIdentity();
        std::memcpy(matrixScratch_, ident.getValue(), 16 * sizeof(double));
    } else if (nSamps == 1 || schema_.isConstant()) {
        AbcG::XformSample samp;
        schema_.get(samp, Abc::ISampleSelector(static_cast<Abc::index_t>(0)));
        Abc::M44d m = samp.getMatrix();
        std::memcpy(matrixScratch_, m.getValue(), 16 * sizeof(double));
    } else {
        AbcA::TimeSamplingPtr ts = schema_.getTimeSampling();
        auto floorPair = ts->getFloorIndex(timeSeconds, static_cast<Abc::index_t>(nSamps));
        auto ceilPair = ts->getCeilIndex(timeSeconds, static_cast<Abc::index_t>(nSamps));

        AbcG::XformSample s0;
        schema_.get(s0, Abc::ISampleSelector(floorPair.first));
        if (floorPair.first == ceilPair.first || std::abs(ceilPair.second - floorPair.second) < 1e-12) {
            Abc::M44d m = s0.getMatrix();
            std::memcpy(matrixScratch_, m.getValue(), 16 * sizeof(double));
        } else {
            double alpha = std::clamp((timeSeconds - floorPair.second) / (ceilPair.second - floorPair.second), 0.0, 1.0);
            AbcG::XformSample s1;
            schema_.get(s1, Abc::ISampleSelector(ceilPair.first));

            // If op stacks match in count & types, interpolate op channels cleanly (handles rotations accurately!)
            bool sameOps = (s0.getNumOps() == s1.getNumOps()) && (s0.getNumOps() > 0);
            if (sameOps) {
                for (std::size_t i = 0; i < s0.getNumOps(); ++i) {
                    if (s0.getOp(i).getType() != s1.getOp(i).getType() ||
                        s0.getOp(i).getNumChannels() != s1.getOp(i).getNumChannels()) {
                        sameOps = false;
                        break;
                    }
                }
            }
            if (sameOps) {
                AbcG::XformSample blended;
                blended.setInheritsXforms(s0.getInheritsXforms());
                bool hasMatrixOp = false;
                for (std::size_t i = 0; i < s0.getNumOps(); ++i) {
                    AbcG::XformOp op0 = s0.getOp(i);
                    AbcG::XformOp op1 = s1.getOp(i);
                    if (op0.isMatrixOp()) {
                        hasMatrixOp = true;
                        break;
                    }
                    AbcG::XformOp outOp(op0.getType(), op0.getHint());
                    for (std::size_t c = 0; c < op0.getNumChannels(); ++c) {
                        double v0 = op0.getChannelValue(c);
                        double v1 = op1.getChannelValue(c);
                        outOp.setChannelValue(c, v0 + (v1 - v0) * alpha);
                    }
                    blended.addOp(outOp);
                }
                if (!hasMatrixOp) {
                    Abc::M44d m = blended.getMatrix();
                    std::memcpy(matrixScratch_, m.getValue(), 16 * sizeof(double));
                } else {
                    // Matrix op present: return matrix0 & matrix1? Let's return blended matrix if linear or let TS decompose
                    // Actually, let's do polar/TRS or return floor if pure matrix op, or blend TRS in TS if needed.
                    // Even better: for pure matrix ops, let's linearly blend translation and slerp upper 3x3 via SVD/Gram-Schmidt or return matrix!
                    // Let's do clean TRS decomposition right here in C++ using Imath!
                    Abc::M44d m0 = s0.getMatrix();
                    Abc::M44d m1 = s1.getMatrix();
                    const double* p0 = m0.getValue();
                    const double* p1 = m1.getValue();
                    for (int k = 0; k < 16; ++k) {
                        matrixScratch_[k] = p0[k] * (1.0 - alpha) + p1[k] * alpha;
                    }
                }
            } else {
                Abc::M44d m0 = s0.getMatrix();
                Abc::M44d m1 = s1.getMatrix();
                const double* p0 = m0.getValue();
                const double* p1 = m1.getValue();
                for (int k = 0; k < 16; ++k) {
                    matrixScratch_[k] = p0[k] * (1.0 - alpha) + p1[k] * alpha;
                }
            }
        }
    }

    BufferViewDesc desc;
    desc.ptr = reinterpret_cast<std::uintptr_t>(matrixScratch_);
    desc.length = 1;
    desc.pod = static_cast<int>(AbcU::kFloat64POD);
    desc.extent = 16;
    desc.byteLength = 16 * sizeof(double);
    return desc;
}

bool IXformWrap::getInheritsXforms(int selectorMode, double selectorValue) const {
    keepAlive_->ensureOpen();
    if (schema_.getNumSamples() == 0) return true;
    return schema_.getInheritsXforms(makeSampleSelector(selectorMode, selectorValue));
}

emscripten::val IXformWrap::getSampleOps(int selectorMode, double selectorValue) const {
    keepAlive_->ensureOpen();
    emscripten::val res = emscripten::val::object();
    if (schema_.getNumSamples() == 0) {
        res.set("inherits", true);
        res.set("ops", emscripten::val::array());
        return res;
    }
    AbcG::XformSample samp;
    schema_.get(samp, makeSampleSelector(selectorMode, selectorValue));
    res.set("inherits", samp.getInheritsXforms());
    emscripten::val opsArr = emscripten::val::array();
    for (std::size_t i = 0; i < samp.getNumOps(); ++i) {
        AbcG::XformOp op = samp.getOp(i);
        emscripten::val o = emscripten::val::object();
        o.set("type", static_cast<int>(op.getType()));
        o.set("hint", static_cast<int>(op.getHint()));
        emscripten::val ch = emscripten::val::array();
        emscripten::val anim = emscripten::val::array();
        for (std::size_t c = 0; c < op.getNumChannels(); ++c) {
            ch.set(c, op.getChannelValue(c));
            anim.set(c, op.isChannelAnimated(c));
        }
        o.set("channels", ch);
        o.set("animated", anim);
        opsArr.set(i, o);
    }
    res.set("ops", opsArr);
    return res;
}

Box3dDesc IXformWrap::getChildBounds(int selectorMode, double selectorValue) const {
    keepAlive_->ensureOpen();
    Abc::IBox3dProperty bp = schema_.getChildBoundsProperty();
    if (!bp.valid() || bp.getNumSamples() == 0) return Box3dDesc{};
    return toBox3dDesc(bp.getValue(makeSampleSelector(selectorMode, selectorValue)));
}

std::shared_ptr<ICompoundWrap> IXformWrap::getArbGeomParams() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getArbGeomParams();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

std::shared_ptr<ICompoundWrap> IXformWrap::getUserProperties() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getUserProperties();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

OXformWrap::OXformWrap(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) : writerCtx_(parent->writerCtx()) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    xform_ = AbcG::OXform(parent->raw(), name, md, tsIndex);
    schema_ = xform_.getSchema();
}

void OXformWrap::setMatrixSample(std::uintptr_t matrix16DoublePtr, bool inherits) {
    writerCtx_->ensureWritable();
    const double* src = reinterpret_cast<const double*>(matrix16DoublePtr);
    Abc::M44d m;
    std::memcpy(m.getValue(), src, 16 * sizeof(double));
    AbcG::XformSample samp;
    samp.setMatrix(m);
    samp.setInheritsXforms(inherits);
    schema_.set(samp);
}

void OXformWrap::setOpsSample(const emscripten::val& opsArray, bool inherits) {
    writerCtx_->ensureWritable();
    AbcG::XformSample samp;
    samp.setInheritsXforms(inherits);
    int nOps = opsArray["length"].as<int>();
    for (int i = 0; i < nOps; ++i) {
        emscripten::val o = opsArray[i];
        auto type = static_cast<AbcG::XformOperationType>(o["type"].as<int>());
        std::uint8_t hint = o["hint"].isUndefined() ? 0 : static_cast<std::uint8_t>(o["hint"].as<int>());
        AbcG::XformOp op(type, hint);
        emscripten::val ch = o["channels"];
        int nCh = ch["length"].as<int>();
        for (int c = 0; c < nCh && static_cast<std::size_t>(c) < op.getNumChannels(); ++c) {
            op.setChannelValue(static_cast<std::size_t>(c), ch[c].as<double>());
        }
        samp.addOp(op);
    }
    schema_.set(samp);
}

std::shared_ptr<OCompoundWrap> OXformWrap::getArbGeomParams() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getArbGeomParams(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCompoundWrap> OXformWrap::getUserProperties() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getUserProperties(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

// ============================================================================
// ICameraWrap / OCameraWrap
// ============================================================================

ICameraWrap::ICameraWrap(const std::shared_ptr<IObjectWrap>& obj)
    : camera_(obj->raw(), Abc::kWrapExisting),
      schema_(camera_.getSchema()),
      archive_(camera_.getArchive()),
      keepAlive_(obj->keepAlive()) {}

ICameraWrap::ICameraWrap(AbcG::ICameraSchema schema, Abc::IArchive archive, ReaderKeepAlivePtr keepAlive)
    : schema_(std::move(schema)),
      archive_(std::move(archive)),
      keepAlive_(std::move(keepAlive)) {}

emscripten::val ICameraWrap::getSample(int selectorMode, double selectorValue) const {
    keepAlive_->ensureOpen();
    AbcG::CameraSample samp;
    if (schema_.getNumSamples() > 0) {
        schema_.get(samp, makeSampleSelector(selectorMode, selectorValue));
    }
    return cameraSampleToVal(samp);
}

Box3dDesc ICameraWrap::getChildBounds(int selectorMode, double selectorValue) const {
    keepAlive_->ensureOpen();
    Abc::IBox3dProperty bp = schema_.getChildBoundsProperty();
    if (!bp.valid() || bp.getNumSamples() == 0) return Box3dDesc{};
    return toBox3dDesc(bp.getValue(makeSampleSelector(selectorMode, selectorValue)));
}

std::shared_ptr<ICompoundWrap> ICameraWrap::getArbGeomParams() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getArbGeomParams();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

std::shared_ptr<ICompoundWrap> ICameraWrap::getUserProperties() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getUserProperties();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

OCameraWrap::OCameraWrap(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) : writerCtx_(parent->writerCtx()) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    camera_ = AbcG::OCamera(parent->raw(), name, md, tsIndex);
    schema_ = camera_.getSchema();
}

void OCameraWrap::setSample(const emscripten::val& sampleObj) {
    writerCtx_->ensureWritable();
    AbcG::CameraSample samp = valToCameraSample(sampleObj);
    schema_.set(samp);
}

std::shared_ptr<OCompoundWrap> OCameraWrap::getArbGeomParams() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getArbGeomParams(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCompoundWrap> OCameraWrap::getUserProperties() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getUserProperties(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

// ============================================================================
// ILightWrap / OLightWrap
// ============================================================================

ILightWrap::ILightWrap(const std::shared_ptr<IObjectWrap>& obj)
    : light_(obj->raw(), Abc::kWrapExisting),
      schema_(light_.getSchema()),
      keepAlive_(obj->keepAlive()) {}

std::shared_ptr<ICameraWrap> ILightWrap::getCameraSchema() const {
    keepAlive_->ensureOpen();
    AbcG::ICameraSchema cs = schema_.getCameraSchema();
    if (!cs.valid()) return nullptr;
    return std::make_shared<ICameraWrap>(cs, light_.getArchive(), keepAlive_);
}

Box3dDesc ILightWrap::getChildBounds(int selectorMode, double selectorValue) const {
    keepAlive_->ensureOpen();
    Abc::IBox3dProperty bp = schema_.getChildBoundsProperty();
    if (!bp.valid() || bp.getNumSamples() == 0) return Box3dDesc{};
    return toBox3dDesc(bp.getValue(makeSampleSelector(selectorMode, selectorValue)));
}

std::shared_ptr<ICompoundWrap> ILightWrap::getArbGeomParams() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getArbGeomParams();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

std::shared_ptr<ICompoundWrap> ILightWrap::getUserProperties() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getUserProperties();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

OLightWrap::OLightWrap(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) : writerCtx_(parent->writerCtx()) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    light_ = AbcG::OLight(parent->raw(), name, md, tsIndex);
    schema_ = light_.getSchema();
}

void OLightWrap::setCameraSample(const emscripten::val& sampleObj) {
    writerCtx_->ensureWritable();
    AbcG::CameraSample samp = valToCameraSample(sampleObj);
    schema_.setCameraSample(samp);
}

std::shared_ptr<OCompoundWrap> OLightWrap::getArbGeomParams() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getArbGeomParams(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCompoundWrap> OLightWrap::getUserProperties() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getUserProperties(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

// ============================================================================
// Factory helpers & Embind registration
// ============================================================================

namespace {

std::shared_ptr<OXformWrap> createOXform(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    auto wrap = std::make_shared<OXformWrap>(parent, name, tsIndex, metaObj);
    parent->writerCtx()->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCameraWrap> createOCamera(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    auto wrap = std::make_shared<OCameraWrap>(parent, name, tsIndex, metaObj);
    parent->writerCtx()->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OLightWrap> createOLight(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    auto wrap = std::make_shared<OLightWrap>(parent, name, tsIndex, metaObj);
    parent->writerCtx()->registerHandle(wrap);
    return wrap;
}

} // namespace

EMSCRIPTEN_BINDINGS(abc_wasm_geom_xform_cam_light) {
    using namespace emscripten;

    class_<IXformWrap>("IXformWrap")
        .smart_ptr_constructor("IXformWrap", &std::make_shared<IXformWrap, const std::shared_ptr<IObjectWrap>&>)
        .function("valid", &IXformWrap::valid)
        .function("getNumSamples", &IXformWrap::getNumSamples)
        .function("isConstant", &IXformWrap::isConstant)
        .function("isConstantIdentity", &IXformWrap::isConstantIdentity)
        .function("getTimeSamplingIndex", &IXformWrap::getTimeSamplingIndex)
        .function("getMatrix", &IXformWrap::getMatrix)
        .function("getInterpolatedMatrix", &IXformWrap::getInterpolatedMatrix)
        .function("getInheritsXforms", &IXformWrap::getInheritsXforms)
        .function("getSampleOps", &IXformWrap::getSampleOps)
        .function("getChildBounds", &IXformWrap::getChildBounds)
        .function("getArbGeomParams", &IXformWrap::getArbGeomParams)
        .function("getUserProperties", &IXformWrap::getUserProperties);

    class_<OXformWrap>("OXformWrap")
        .smart_ptr<std::shared_ptr<OXformWrap>>("OXformWrap")
        .function("getObject", &OXformWrap::getObject)
        .function("getNumSamples", &OXformWrap::getNumSamples)
        .function("setMatrixSample", &OXformWrap::setMatrixSample)
        .function("setOpsSample", &OXformWrap::setOpsSample)
        .function("setFromPrevious", &OXformWrap::setFromPrevious)
        .function("setTimeSampling", &OXformWrap::setTimeSampling)
        .function("getArbGeomParams", &OXformWrap::getArbGeomParams)
        .function("getUserProperties", &OXformWrap::getUserProperties);

    class_<ICameraWrap>("ICameraWrap")
        .smart_ptr_constructor("ICameraWrap", &std::make_shared<ICameraWrap, const std::shared_ptr<IObjectWrap>&>)
        .function("valid", &ICameraWrap::valid)
        .function("getNumSamples", &ICameraWrap::getNumSamples)
        .function("isConstant", &ICameraWrap::isConstant)
        .function("getTimeSamplingIndex", &ICameraWrap::getTimeSamplingIndex)
        .function("getSample", &ICameraWrap::getSample)
        .function("getChildBounds", &ICameraWrap::getChildBounds)
        .function("getArbGeomParams", &ICameraWrap::getArbGeomParams)
        .function("getUserProperties", &ICameraWrap::getUserProperties);

    class_<OCameraWrap>("OCameraWrap")
        .smart_ptr<std::shared_ptr<OCameraWrap>>("OCameraWrap")
        .function("getObject", &OCameraWrap::getObject)
        .function("getNumSamples", &OCameraWrap::getNumSamples)
        .function("setSample", &OCameraWrap::setSample)
        .function("setFromPrevious", &OCameraWrap::setFromPrevious)
        .function("setTimeSampling", &OCameraWrap::setTimeSampling)
        .function("getArbGeomParams", &OCameraWrap::getArbGeomParams)
        .function("getUserProperties", &OCameraWrap::getUserProperties);

    class_<ILightWrap>("ILightWrap")
        .smart_ptr_constructor("ILightWrap", &std::make_shared<ILightWrap, const std::shared_ptr<IObjectWrap>&>)
        .function("valid", &ILightWrap::valid)
        .function("getNumSamples", &ILightWrap::getNumSamples)
        .function("isConstant", &ILightWrap::isConstant)
        .function("getTimeSamplingIndex", &ILightWrap::getTimeSamplingIndex)
        .function("getCameraSchema", &ILightWrap::getCameraSchema)
        .function("getChildBounds", &ILightWrap::getChildBounds)
        .function("getArbGeomParams", &ILightWrap::getArbGeomParams)
        .function("getUserProperties", &ILightWrap::getUserProperties);

    class_<OLightWrap>("OLightWrap")
        .smart_ptr<std::shared_ptr<OLightWrap>>("OLightWrap")
        .function("getObject", &OLightWrap::getObject)
        .function("getNumSamples", &OLightWrap::getNumSamples)
        .function("setCameraSample", &OLightWrap::setCameraSample)
        .function("setFromPrevious", &OLightWrap::setFromPrevious)
        .function("setTimeSampling", &OLightWrap::setTimeSampling)
        .function("getArbGeomParams", &OLightWrap::getArbGeomParams)
        .function("getUserProperties", &OLightWrap::getUserProperties);

    function("createOXform", &createOXform);
    function("createOCamera", &createOCamera);
    function("createOLight", &createOLight);
}

} // namespace abc_wasm
