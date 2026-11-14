#pragma once

#include "abc_wasm/tessellation.h"

namespace abc_wasm {

// ============================================================================
// Xform, Camera, Light Wrappers
// ============================================================================

class IXformWrap {
public:
    IXformWrap(const std::shared_ptr<IObjectWrap>& obj);

    bool valid() const { return !keepAlive_->closed && schema_.valid(); }
    std::size_t getNumSamples() const { keepAlive_->ensureOpen(); return schema_.getNumSamples(); }
    bool isConstant() const { keepAlive_->ensureOpen(); return schema_.isConstant(); }
    bool isConstantIdentity() const { keepAlive_->ensureOpen(); return schema_.isConstantIdentity(); }
    std::uint32_t getTimeSamplingIndex() const {
        keepAlive_->ensureOpen();
        return findTimeSamplingIndex(xform_.getArchive(), schema_.getTimeSampling());
    }

    BufferViewDesc getMatrix(int selectorMode, double selectorValue);
    BufferViewDesc getInterpolatedMatrix(double timeSeconds);
    bool getInheritsXforms(int selectorMode, double selectorValue) const;
    emscripten::val getSampleOps(int selectorMode, double selectorValue) const;
    Box3dDesc getChildBounds(int selectorMode, double selectorValue) const;
    std::shared_ptr<ICompoundWrap> getArbGeomParams() const;
    std::shared_ptr<ICompoundWrap> getUserProperties() const;

private:
    AbcG::IXform xform_;
    AbcG::IXformSchema schema_;
    ReaderKeepAlivePtr keepAlive_;
    double matrixScratch_[16] = {0};
};

class OXformWrap final : public ResettableWriterHandle {
public:
    OXformWrap(
        const std::shared_ptr<OObjectWrap>& parent,
        const std::string& name,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );

    void resetNative() override {
        schema_.reset();
        xform_.reset();
    }

    std::shared_ptr<OObjectWrap> getObject() const {
        auto wrap = std::make_shared<OObjectWrap>(xform_, writerCtx_);
        writerCtx_->registerHandle(wrap);
        return wrap;
    }
    std::size_t getNumSamples() const { writerCtx_->ensureWritable(); return schema_.getNumSamples(); }
    void setMatrixSample(std::uintptr_t matrix16DoublePtr, bool inherits);
    void setOpsSample(const emscripten::val& opsArray, bool inherits);
    void setFromPrevious() { writerCtx_->ensureWritable(); schema_.setFromPrevious(); }
    void setTimeSampling(std::uint32_t tsIndex) { writerCtx_->ensureWritable(); schema_.setTimeSampling(tsIndex); }
    std::shared_ptr<OCompoundWrap> getArbGeomParams();
    std::shared_ptr<OCompoundWrap> getUserProperties();

private:
    AbcG::OXform xform_;
    AbcG::OXformSchema schema_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

class ICameraWrap {
public:
    ICameraWrap(const std::shared_ptr<IObjectWrap>& obj);
    ICameraWrap(AbcG::ICameraSchema schema, Abc::IArchive archive, ReaderKeepAlivePtr keepAlive);

    bool valid() const { return !keepAlive_->closed && schema_.valid(); }
    std::size_t getNumSamples() const { keepAlive_->ensureOpen(); return schema_.getNumSamples(); }
    bool isConstant() const { keepAlive_->ensureOpen(); return schema_.isConstant(); }
    std::uint32_t getTimeSamplingIndex() const {
        keepAlive_->ensureOpen();
        return findTimeSamplingIndex(archive_, schema_.getTimeSampling());
    }

    emscripten::val getSample(int selectorMode, double selectorValue) const;
    Box3dDesc getChildBounds(int selectorMode, double selectorValue) const;
    std::shared_ptr<ICompoundWrap> getArbGeomParams() const;
    std::shared_ptr<ICompoundWrap> getUserProperties() const;

private:
    AbcG::ICamera camera_;
    AbcG::ICameraSchema schema_;
    Abc::IArchive archive_;
    ReaderKeepAlivePtr keepAlive_;
};

class OCameraWrap final : public ResettableWriterHandle {
public:
    OCameraWrap(
        const std::shared_ptr<OObjectWrap>& parent,
        const std::string& name,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );

    void resetNative() override {
        schema_.reset();
        camera_.reset();
    }

    std::shared_ptr<OObjectWrap> getObject() const {
        auto wrap = std::make_shared<OObjectWrap>(camera_, writerCtx_);
        writerCtx_->registerHandle(wrap);
        return wrap;
    }
    std::size_t getNumSamples() { writerCtx_->ensureWritable(); return schema_.getNumSamples(); }
    void setSample(const emscripten::val& sampleObj);
    void setFromPrevious() { writerCtx_->ensureWritable(); schema_.setFromPrevious(); }
    void setTimeSampling(std::uint32_t tsIndex) { writerCtx_->ensureWritable(); schema_.setTimeSampling(tsIndex); }
    std::shared_ptr<OCompoundWrap> getArbGeomParams();
    std::shared_ptr<OCompoundWrap> getUserProperties();

private:
    AbcG::OCamera camera_;
    AbcG::OCameraSchema schema_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

class ILightWrap {
public:
    ILightWrap(const std::shared_ptr<IObjectWrap>& obj);

    bool valid() const { return !keepAlive_->closed && schema_.valid(); }
    std::size_t getNumSamples() const { keepAlive_->ensureOpen(); return schema_.getNumSamples(); }
    bool isConstant() const { keepAlive_->ensureOpen(); return schema_.isConstant(); }
    std::uint32_t getTimeSamplingIndex() const {
        keepAlive_->ensureOpen();
        return findTimeSamplingIndex(light_.getArchive(), schema_.getTimeSampling());
    }
    std::shared_ptr<ICameraWrap> getCameraSchema() const;
    Box3dDesc getChildBounds(int selectorMode, double selectorValue) const;
    std::shared_ptr<ICompoundWrap> getArbGeomParams() const;
    std::shared_ptr<ICompoundWrap> getUserProperties() const;

private:
    AbcG::ILight light_;
    AbcG::ILightSchema schema_;
    ReaderKeepAlivePtr keepAlive_;
};

class OLightWrap final : public ResettableWriterHandle {
public:
    OLightWrap(
        const std::shared_ptr<OObjectWrap>& parent,
        const std::string& name,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );

    void resetNative() override {
        schema_.reset();
        light_.reset();
    }

    std::shared_ptr<OObjectWrap> getObject() const {
        auto wrap = std::make_shared<OObjectWrap>(light_, writerCtx_);
        writerCtx_->registerHandle(wrap);
        return wrap;
    }
    std::size_t getNumSamples() { writerCtx_->ensureWritable(); return schema_.getNumSamples(); }
    void setCameraSample(const emscripten::val& sampleObj);
    void setFromPrevious() { writerCtx_->ensureWritable(); schema_.setFromPrevious(); }
    void setTimeSampling(std::uint32_t tsIndex) { writerCtx_->ensureWritable(); schema_.setTimeSampling(tsIndex); }
    std::shared_ptr<OCompoundWrap> getArbGeomParams();
    std::shared_ptr<OCompoundWrap> getUserProperties();

private:
    AbcG::OLight light_;
    AbcG::OLightSchema schema_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

// ============================================================================
// PolyMesh, SubD, FaceSet Wrappers
// ============================================================================

class IFaceSetWrap {
public:
    IFaceSetWrap(const std::shared_ptr<IObjectWrap>& obj);
    IFaceSetWrap(AbcG::IFaceSet fs, ReaderKeepAlivePtr keepAlive);

    bool valid() const { return !keepAlive_->closed && schema_.valid(); }
    std::string getName() const { keepAlive_->ensureOpen(); return faceSet_.getName(); }
    std::string getFullName() const { keepAlive_->ensureOpen(); return faceSet_.getFullName(); }
    std::size_t getNumSamples() const { keepAlive_->ensureOpen(); return schema_.getNumSamples(); }
    bool isConstant() const { keepAlive_->ensureOpen(); return schema_.isConstant(); }
    int getFaceExclusivity() const { keepAlive_->ensureOpen(); return static_cast<int>(schema_.getFaceExclusivity()); }
    std::uint32_t getTimeSamplingIndex() const {
        keepAlive_->ensureOpen();
        return findTimeSamplingIndex(faceSet_.getArchive(), schema_.getTimeSampling());
    }

    BufferViewDesc getFaces(int selectorMode, double selectorValue);
    Box3dDesc getSelfBounds(int selectorMode, double selectorValue) const;
    std::shared_ptr<ICompoundWrap> getArbGeomParams() const;
    std::shared_ptr<ICompoundWrap> getUserProperties() const;
    std::shared_ptr<IObjectWrap> getObject() const {
        return std::make_shared<IObjectWrap>(faceSet_, keepAlive_);
    }

private:
    AbcG::IFaceSet faceSet_;
    AbcG::IFaceSetSchema schema_;
    ReaderKeepAlivePtr keepAlive_;
    Abc::Int32ArraySamplePtr lastFaces_;
};

class OFaceSetWrap final : public ResettableWriterHandle {
public:
    OFaceSetWrap(
        AbcG::OFaceSet fs,
        std::shared_ptr<ArchiveWriterContext> writerCtx
    );
    OFaceSetWrap(
        const std::shared_ptr<OObjectWrap>& parent,
        const std::string& name,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );

    void resetNative() override {
        schema_.reset();
        faceSet_.reset();
    }

    std::shared_ptr<OObjectWrap> getObject() const {
        auto wrap = std::make_shared<OObjectWrap>(faceSet_, writerCtx_);
        writerCtx_->registerHandle(wrap);
        return wrap;
    }
    std::size_t getNumSamples() const { writerCtx_->ensureWritable(); return schema_.getNumSamples(); }
    void setFaces(std::uintptr_t facesInt32Ptr, std::size_t count);
    void setFaceExclusivity(int exclusivity) {
        writerCtx_->ensureWritable();
        schema_.setFaceExclusivity(static_cast<AbcG::FaceSetExclusivity>(exclusivity));
    }
    int getFaceExclusivity() { writerCtx_->ensureWritable(); return static_cast<int>(schema_.getFaceExclusivity()); }
    void setTimeSampling(std::uint32_t tsIndex) { writerCtx_->ensureWritable(); schema_.setTimeSampling(tsIndex); }
    std::shared_ptr<OCompoundWrap> getArbGeomParams();
    std::shared_ptr<OCompoundWrap> getUserProperties();

private:
    AbcG::OFaceSet faceSet_;
    AbcG::OFaceSetSchema schema_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

class IPolyMeshWrap {
public:
    IPolyMeshWrap(const std::shared_ptr<IObjectWrap>& obj);

    bool valid() const { return !keepAlive_->closed && schema_.valid(); }
    std::size_t getNumSamples() const { keepAlive_->ensureOpen(); return schema_.getNumSamples(); }
    bool isConstant() const { keepAlive_->ensureOpen(); return schema_.isConstant(); }
    int getTopologyVariance() const { keepAlive_->ensureOpen(); return static_cast<int>(schema_.getTopologyVariance()); }
    std::uint32_t getTimeSamplingIndex() const {
        keepAlive_->ensureOpen();
        return findTimeSamplingIndex(mesh_.getArchive(), schema_.getTimeSampling());
    }

    emscripten::val getRawSample(int selectorMode, double selectorValue);
    Box3dDesc getSelfBounds(int selectorMode, double selectorValue) const;
    std::shared_ptr<GenericIGeomParam> getUVsParam() const;
    std::shared_ptr<GenericIGeomParam> getNormalsParam() const;
    emscripten::val getFaceSetNames() const;
    bool hasFaceSet(const std::string& name) const;
    std::shared_ptr<IFaceSetWrap> getFaceSet(const std::string& name) const;
    std::shared_ptr<ICompoundWrap> getArbGeomParams() const;
    std::shared_ptr<ICompoundWrap> getUserProperties() const;

    // Render acceleration
    std::shared_ptr<RenderMeshBuffer> buildRenderBuffer(
        int selectorMode,
        double selectorValue,
        bool reverseWinding,
        bool flatNormals,
        double velocityDt
    ) const {
        keepAlive_->ensureOpen();
        return buildPolyMeshRenderBuffer(schema_, selectorMode, selectorValue, reverseWinding, flatNormals, velocityDt);
    }

    std::shared_ptr<HomogeneousMeshPlan> createHomogeneousPlan(
        bool reverseWinding,
        bool flatNormals
    ) const {
        keepAlive_->ensureOpen();
        return std::make_shared<HomogeneousMeshPlan>(schema_, keepAlive_, reverseWinding, flatNormals);
    }

private:
    AbcG::IPolyMesh mesh_;
    mutable AbcG::IPolyMeshSchema schema_;
    ReaderKeepAlivePtr keepAlive_;
    Abc::P3fArraySamplePtr lastPos_;
    Abc::V3fArraySamplePtr lastVel_;
    Abc::Int32ArraySamplePtr lastFaceIndices_;
    Abc::Int32ArraySamplePtr lastFaceCounts_;
};

class OPolyMeshWrap final : public ResettableWriterHandle {
public:
    OPolyMeshWrap(
        const std::shared_ptr<OObjectWrap>& parent,
        const std::string& name,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );

    void resetNative() override {
        schema_.reset();
        mesh_.reset();
    }

    std::shared_ptr<OObjectWrap> getObject() const {
        auto wrap = std::make_shared<OObjectWrap>(mesh_, writerCtx_);
        writerCtx_->registerHandle(wrap);
        return wrap;
    }
    std::size_t getNumSamples() const { writerCtx_->ensureWritable(); return schema_.getNumSamples(); }

    void setSample(
        std::uintptr_t posPtr, std::size_t posCount,
        std::uintptr_t faceIndicesPtr, std::size_t faceIndicesCount,
        std::uintptr_t faceCountsPtr, std::size_t faceCountsCount,
        std::uintptr_t velPtr, std::size_t velCount,
        std::uintptr_t uvsPtr, std::size_t uvsCount,
        std::uintptr_t uvIndicesPtr, std::size_t uvIndicesCount, int uvScope,
        std::uintptr_t normalsPtr, std::size_t normalsCount,
        std::uintptr_t normalIndicesPtr, std::size_t normalIndicesCount, int normalScope,
        const Box3dDesc& selfBounds
    );
    void setFromPrevious() { writerCtx_->ensureWritable(); schema_.setFromPrevious(); }
    void setTimeSampling(std::uint32_t tsIndex) { writerCtx_->ensureWritable(); schema_.setTimeSampling(tsIndex); }
    void setUVSourceName(const std::string& name) { writerCtx_->ensureWritable(); schema_.setUVSourceName(name); }
    std::shared_ptr<OFaceSetWrap> createFaceSet(const std::string& name);
    std::shared_ptr<OCompoundWrap> getArbGeomParams();
    std::shared_ptr<OCompoundWrap> getUserProperties();

private:
    AbcG::OPolyMesh mesh_;
    AbcG::OPolyMeshSchema schema_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

class ISubDWrap {
public:
    ISubDWrap(const std::shared_ptr<IObjectWrap>& obj);

    bool valid() const { return !keepAlive_->closed && schema_.valid(); }
    std::size_t getNumSamples() const { keepAlive_->ensureOpen(); return schema_.getNumSamples(); }
    bool isConstant() const { keepAlive_->ensureOpen(); return schema_.isConstant(); }
    int getTopologyVariance() const { keepAlive_->ensureOpen(); return static_cast<int>(schema_.getTopologyVariance()); }
    std::uint32_t getTimeSamplingIndex() const {
        keepAlive_->ensureOpen();
        return findTimeSamplingIndex(subd_.getArchive(), schema_.getTimeSampling());
    }

    emscripten::val getRawSample(int selectorMode, double selectorValue);
    std::shared_ptr<GenericIGeomParam> getUVsParam() const;
    emscripten::val getFaceSetNames() const;
    std::shared_ptr<IFaceSetWrap> getFaceSet(const std::string& name) const;
    std::shared_ptr<ICompoundWrap> getArbGeomParams() const;
    std::shared_ptr<ICompoundWrap> getUserProperties() const;

    std::shared_ptr<RenderMeshBuffer> buildRenderBuffer(
        int selectorMode,
        double selectorValue,
        int subdLevel,
        bool reverseWinding
    ) const {
        keepAlive_->ensureOpen();
        return buildSubDRenderBuffer(schema_, selectorMode, selectorValue, subdLevel, reverseWinding);
    }

private:
    AbcG::ISubD subd_;
    mutable AbcG::ISubDSchema schema_;
    ReaderKeepAlivePtr keepAlive_;
    AbcG::ISubDSchema::Sample lastSample_;
};

class OSubDWrap final : public ResettableWriterHandle {
public:
    OSubDWrap(
        const std::shared_ptr<OObjectWrap>& parent,
        const std::string& name,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );

    void resetNative() override {
        schema_.reset();
        subd_.reset();
    }

    std::shared_ptr<OObjectWrap> getObject() const {
        auto wrap = std::make_shared<OObjectWrap>(subd_, writerCtx_);
        writerCtx_->registerHandle(wrap);
        return wrap;
    }
    std::size_t getNumSamples() const { writerCtx_->ensureWritable(); return schema_.getNumSamples(); }

    void setSample(
        std::uintptr_t posPtr, std::size_t posCount,
        std::uintptr_t faceIndicesPtr, std::size_t faceIndicesCount,
        std::uintptr_t faceCountsPtr, std::size_t faceCountsCount,
        const std::string& scheme,
        std::uintptr_t creaseIndicesPtr, std::size_t creaseIndicesCount,
        std::uintptr_t creaseLengthsPtr, std::size_t creaseLengthsCount,
        std::uintptr_t creaseSharpnessesPtr, std::size_t creaseSharpnessesCount,
        std::uintptr_t cornerIndicesPtr, std::size_t cornerIndicesCount,
        std::uintptr_t cornerSharpnessesPtr, std::size_t cornerSharpnessesCount,
        std::uintptr_t holesPtr, std::size_t holesCount,
        int interpolateBoundary,
        int faceVaryingInterpolateBoundary,
        int faceVaryingPropagateCorners,
        std::uintptr_t velPtr, std::size_t velCount,
        std::uintptr_t uvsPtr, std::size_t uvsCount,
        std::uintptr_t uvIndicesPtr, std::size_t uvIndicesCount, int uvScope
    );
    void setFromPrevious() { writerCtx_->ensureWritable(); schema_.setFromPrevious(); }
    void setTimeSampling(std::uint32_t tsIndex) { writerCtx_->ensureWritable(); schema_.setTimeSampling(tsIndex); }
    std::shared_ptr<OFaceSetWrap> createFaceSet(const std::string& name);
    std::shared_ptr<OCompoundWrap> getArbGeomParams();
    std::shared_ptr<OCompoundWrap> getUserProperties();

private:
    AbcG::OSubD subd_;
    AbcG::OSubDSchema schema_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

// ============================================================================
// Curves, Points, NuPatch Wrappers
// ============================================================================

class ICurvesWrap {
public:
    ICurvesWrap(const std::shared_ptr<IObjectWrap>& obj);

    bool valid() const { return !keepAlive_->closed && schema_.valid(); }
    std::size_t getNumSamples() const { keepAlive_->ensureOpen(); return schema_.getNumSamples(); }
    bool isConstant() const { keepAlive_->ensureOpen(); return schema_.isConstant(); }
    int getTopologyVariance() const { keepAlive_->ensureOpen(); return static_cast<int>(schema_.getTopologyVariance()); }
    std::uint32_t getTimeSamplingIndex() const {
        keepAlive_->ensureOpen();
        return findTimeSamplingIndex(curves_.getArchive(), schema_.getTimeSampling());
    }

    emscripten::val getRawSample(int selectorMode, double selectorValue);
    std::shared_ptr<GenericIGeomParam> getWidthsParam() const;
    std::shared_ptr<GenericIGeomParam> getUVsParam() const;
    std::shared_ptr<GenericIGeomParam> getNormalsParam() const;
    std::shared_ptr<ICompoundWrap> getArbGeomParams() const;
    std::shared_ptr<ICompoundWrap> getUserProperties() const;

    std::shared_ptr<CurveTessellationBuffer> evaluateForRender(
        int selectorMode,
        double selectorValue,
        int segmentsPerSpan
    ) const {
        keepAlive_->ensureOpen();
        return evaluateCurvesForRender(schema_, selectorMode, selectorValue, segmentsPerSpan);
    }

private:
    AbcG::ICurves curves_;
    AbcG::ICurvesSchema schema_;
    ReaderKeepAlivePtr keepAlive_;
    AbcG::ICurvesSchema::Sample lastSample_;
};

class OCurvesWrap final : public ResettableWriterHandle {
public:
    OCurvesWrap(
        const std::shared_ptr<OObjectWrap>& parent,
        const std::string& name,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );

    void resetNative() override {
        schema_.reset();
        curves_.reset();
    }

    std::shared_ptr<OObjectWrap> getObject() const {
        auto wrap = std::make_shared<OObjectWrap>(curves_, writerCtx_);
        writerCtx_->registerHandle(wrap);
        return wrap;
    }
    std::size_t getNumSamples() const { writerCtx_->ensureWritable(); return schema_.getNumSamples(); }

    void setSample(
        std::uintptr_t posPtr, std::size_t posCount,
        std::uintptr_t numVertsPtr, std::size_t numCurves,
        int curveType,
        int wrapPeriodicity,
        int basisType,
        std::uintptr_t widthsPtr, std::size_t widthsCount, int widthScope,
        std::uintptr_t uvsPtr, std::size_t uvsCount, int uvScope,
        std::uintptr_t normalsPtr, std::size_t normalsCount, int normalScope,
        std::uintptr_t weightsPtr, std::size_t weightsCount,
        std::uintptr_t ordersPtr, std::size_t ordersCount,
        std::uintptr_t knotsPtr, std::size_t knotsCount,
        std::uintptr_t velPtr, std::size_t velCount
    );
    void setFromPrevious() { writerCtx_->ensureWritable(); schema_.setFromPrevious(); }
    void setTimeSampling(std::uint32_t tsIndex) { writerCtx_->ensureWritable(); schema_.setTimeSampling(tsIndex); }
    std::shared_ptr<OCompoundWrap> getArbGeomParams();
    std::shared_ptr<OCompoundWrap> getUserProperties();

private:
    AbcG::OCurves curves_;
    AbcG::OCurvesSchema schema_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

class IPointsWrap {
public:
    IPointsWrap(const std::shared_ptr<IObjectWrap>& obj);

    bool valid() const { return !keepAlive_->closed && schema_.valid(); }
    std::size_t getNumSamples() const { keepAlive_->ensureOpen(); return schema_.getNumSamples(); }
    bool isConstant() const { keepAlive_->ensureOpen(); return schema_.isConstant(); }
    std::uint32_t getTimeSamplingIndex() const {
        keepAlive_->ensureOpen();
        return findTimeSamplingIndex(points_.getArchive(), schema_.getTimeSampling());
    }

    emscripten::val getRawSample(int selectorMode, double selectorValue);
    std::shared_ptr<GenericIGeomParam> getWidthsParam() const;
    std::shared_ptr<ICompoundWrap> getArbGeomParams() const;
    std::shared_ptr<ICompoundWrap> getUserProperties() const;

private:
    AbcG::IPoints points_;
    AbcG::IPointsSchema schema_;
    ReaderKeepAlivePtr keepAlive_;
    AbcG::IPointsSchema::Sample lastSample_;
};

class OPointsWrap final : public ResettableWriterHandle {
public:
    OPointsWrap(
        const std::shared_ptr<OObjectWrap>& parent,
        const std::string& name,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );

    void resetNative() override {
        schema_.reset();
        points_.reset();
    }

    std::shared_ptr<OObjectWrap> getObject() const {
        auto wrap = std::make_shared<OObjectWrap>(points_, writerCtx_);
        writerCtx_->registerHandle(wrap);
        return wrap;
    }
    std::size_t getNumSamples() const { writerCtx_->ensureWritable(); return schema_.getNumSamples(); }

    void setSample(
        std::uintptr_t posPtr, std::size_t posCount,
        std::uintptr_t idsUint64Ptr, std::size_t idsCount,
        std::uintptr_t velPtr, std::size_t velCount,
        std::uintptr_t widthsPtr, std::size_t widthsCount, int widthScope
    );
    void setFromPrevious() { writerCtx_->ensureWritable(); schema_.setFromPrevious(); }
    void setTimeSampling(std::uint32_t tsIndex) { writerCtx_->ensureWritable(); schema_.setTimeSampling(tsIndex); }
    std::shared_ptr<OCompoundWrap> getArbGeomParams();
    std::shared_ptr<OCompoundWrap> getUserProperties();

private:
    AbcG::OPoints points_;
    AbcG::OPointsSchema schema_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

class INuPatchWrap {
public:
    INuPatchWrap(const std::shared_ptr<IObjectWrap>& obj);

    bool valid() const { return !keepAlive_->closed && schema_.valid(); }
    std::size_t getNumSamples() const { keepAlive_->ensureOpen(); return schema_.getNumSamples(); }
    bool isConstant() const { keepAlive_->ensureOpen(); return schema_.isConstant(); }
    int getTopologyVariance() const { keepAlive_->ensureOpen(); return static_cast<int>(schema_.getTopologyVariance()); }
    std::uint32_t getTimeSamplingIndex() const {
        keepAlive_->ensureOpen();
        return findTimeSamplingIndex(patch_.getArchive(), schema_.getTimeSampling());
    }

    emscripten::val getRawSample(int selectorMode, double selectorValue);
    std::shared_ptr<GenericIGeomParam> getUVsParam() const;
    std::shared_ptr<GenericIGeomParam> getNormalsParam() const;
    std::shared_ptr<ICompoundWrap> getArbGeomParams() const;
    std::shared_ptr<ICompoundWrap> getUserProperties() const;

    std::shared_ptr<RenderMeshBuffer> buildRenderBuffer(
        int selectorMode,
        double selectorValue,
        int uSegments,
        int vSegments,
        bool reverseWinding
    ) const {
        keepAlive_->ensureOpen();
        return buildNuPatchRenderBuffer(schema_, selectorMode, selectorValue, uSegments, vSegments, reverseWinding);
    }

private:
    AbcG::INuPatch patch_;
    AbcG::INuPatchSchema schema_;
    ReaderKeepAlivePtr keepAlive_;
    AbcG::INuPatchSchema::Sample lastSample_;
};

class ONuPatchWrap final : public ResettableWriterHandle {
public:
    ONuPatchWrap(
        const std::shared_ptr<OObjectWrap>& parent,
        const std::string& name,
        std::uint32_t tsIndex,
        const emscripten::val& metaObj
    );

    void resetNative() override {
        schema_.reset();
        patch_.reset();
    }

    std::shared_ptr<OObjectWrap> getObject() const {
        auto wrap = std::make_shared<OObjectWrap>(patch_, writerCtx_);
        writerCtx_->registerHandle(wrap);
        return wrap;
    }
    std::size_t getNumSamples() const { writerCtx_->ensureWritable(); return schema_.getNumSamples(); }

    void setSample(
        std::uintptr_t posPtr, std::size_t posCount,
        int numU, int numV,
        int uOrder, int vOrder,
        std::uintptr_t uKnotPtr, std::size_t uKnotCount,
        std::uintptr_t vKnotPtr, std::size_t vKnotCount,
        std::uintptr_t weightsPtr, std::size_t weightsCount,
        std::uintptr_t velPtr, std::size_t velCount
    );
    void setFromPrevious() { writerCtx_->ensureWritable(); schema_.setFromPrevious(); }
    void setTimeSampling(std::uint32_t tsIndex) { writerCtx_->ensureWritable(); schema_.setTimeSampling(tsIndex); }
    std::shared_ptr<OCompoundWrap> getArbGeomParams();
    std::shared_ptr<OCompoundWrap> getUserProperties();

private:
    AbcG::ONuPatch patch_;
    AbcG::ONuPatchSchema schema_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

// ============================================================================
// Material & Collections Wrappers
// ============================================================================

class IMaterialWrap {
public:
    IMaterialWrap(const std::shared_ptr<IObjectWrap>& obj);
    IMaterialWrap(AbcM::IMaterialSchema schema, ReaderKeepAlivePtr keepAlive);

    bool valid() const { return !keepAlive_->closed && schema_.valid(); }
    emscripten::val getTargetNames();
    emscripten::val getShaderTypesForTarget(const std::string& target);
    std::string getShader(const std::string& target, const std::string& shaderType);
    std::shared_ptr<ICompoundWrap> getShaderParameters(const std::string& target, const std::string& shaderType);

    std::size_t getNumNetworkNodes() { keepAlive_->ensureOpen(); return schema_.getNumNetworkNodes(); }
    emscripten::val getNetworkNodeNames();
    emscripten::val getNetworkNodeInfo(const std::string& nodeName);
    emscripten::val getNetworkTerminalTargetNames();
    emscripten::val getNetworkTerminalShaderTypesForTarget(const std::string& target);
    emscripten::val getNetworkTerminal(const std::string& target, const std::string& shaderType);
    std::shared_ptr<ICompoundWrap> getNetworkInterfaceParameters();
    emscripten::val getNetworkInterfaceParameterMappings();

    AbcM::IMaterialSchema& rawSchema() { return schema_; }
    const AbcM::IMaterial& rawObject() const { return mat_; }
    ReaderKeepAlivePtr keepAlive() const { return keepAlive_; }

private:
    AbcM::IMaterial mat_;
    AbcM::IMaterialSchema schema_;
    ReaderKeepAlivePtr keepAlive_;
};

class OMaterialWrap final : public ResettableWriterHandle {
public:
    OMaterialWrap(
        const std::shared_ptr<OObjectWrap>& parent,
        const std::string& name,
        const emscripten::val& metaObj
    );
    OMaterialWrap(
        AbcM::OMaterialSchema schema,
        std::shared_ptr<ArchiveWriterContext> writerCtx
    );

    void resetNative() override {
        schema_.reset();
        mat_.reset();
    }

    std::shared_ptr<OObjectWrap> getObject() const {
        if (!mat_.valid()) return nullptr;
        auto wrap = std::make_shared<OObjectWrap>(mat_, writerCtx_);
        writerCtx_->registerHandle(wrap);
        return wrap;
    }

    void setShader(const std::string& target, const std::string& shaderType, const std::string& shaderName);
    std::shared_ptr<OCompoundWrap> getShaderParameters(const std::string& target, const std::string& shaderType);

    void addNetworkNode(const std::string& nodeName, const std::string& target, const std::string& nodeType);
    void setNetworkNodeConnection(
        const std::string& nodeName,
        const std::string& inputName,
        const std::string& connectedNodeName,
        const std::string& connectedOutputName
    );
    std::shared_ptr<OCompoundWrap> getNetworkNodeParameters(const std::string& nodeName);
    void setNetworkTerminal(
        const std::string& target,
        const std::string& shaderType,
        const std::string& nodeName,
        const std::string& outputName
    );
    void setNetworkInterfaceParameterMapping(
        const std::string& interfaceParamName,
        const std::string& mapToNodeName,
        const std::string& mapToParamName
    );
    std::shared_ptr<OCompoundWrap> getNetworkInterfaceParameters();

private:
    AbcM::OMaterial mat_;
    AbcM::OMaterialSchema schema_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

class MaterialFlattenWrap {
public:
    explicit MaterialFlattenWrap(const std::shared_ptr<IObjectWrap>& obj);
    explicit MaterialFlattenWrap(const std::shared_ptr<IMaterialWrap>& mat);

    bool empty() { keepAlive_->ensureOpen(); return flatten_.empty(); }
    emscripten::val getTargetNames();
    emscripten::val getShaderTypesForTarget(const std::string& target);
    std::string getShader(const std::string& target, const std::string& shaderType);
    emscripten::val getShaderParametersList(const std::string& target, const std::string& shaderType);
    emscripten::val getNetworkTerminalTargetNames();
    emscripten::val getNetworkTerminalShaderTypesForTarget(const std::string& target);
    emscripten::val getNetworkTerminal(const std::string& target, const std::string& shaderType);
    std::size_t getNumNetworkNodes() { keepAlive_->ensureOpen(); return nodeNames_.size(); }
    emscripten::val getNetworkNodeByIndex(std::size_t index);

private:
    AbcM::MaterialFlatten flatten_;
    ReaderKeepAlivePtr keepAlive_;
    std::vector<std::string> nodeNames_;
};

class ICollectionsWrap {
public:
    explicit ICollectionsWrap(const std::shared_ptr<IObjectWrap>& obj);

    bool valid() const { return !keepAlive_->closed && schema_.valid(); }
    std::size_t getNumCollections() { keepAlive_->ensureOpen(); return schema_.getNumCollections(); }
    std::string getCollectionName(std::size_t index) { keepAlive_->ensureOpen(); return schema_.getCollectionName(index); }
    std::shared_ptr<IArrayWrap> getCollectionByIndex(std::size_t index);
    std::shared_ptr<IArrayWrap> getCollectionByName(const std::string& name);

private:
    AbcC::ICollections cols_;
    AbcC::ICollectionsSchema schema_;
    ReaderKeepAlivePtr keepAlive_;
};

class OCollectionsWrap final : public ResettableWriterHandle {
public:
    OCollectionsWrap(
        const std::shared_ptr<OObjectWrap>& parent,
        const std::string& name,
        const emscripten::val& metaObj
    );

    void resetNative() override {
        schema_.reset();
        cols_.reset();
    }

    std::shared_ptr<OObjectWrap> getObject() const {
        auto wrap = std::make_shared<OObjectWrap>(cols_, writerCtx_);
        writerCtx_->registerHandle(wrap);
        return wrap;
    }
    std::size_t getNumCollections() { writerCtx_->ensureWritable(); return schema_.getNumCollections(); }
    std::shared_ptr<OArrayWrap> createCollection(const std::string& name, std::uint32_t tsIndex);
    std::shared_ptr<OArrayWrap> getCollectionByName(const std::string& name);

private:
    AbcC::OCollections cols_;
    AbcC::OCollectionsSchema schema_;
    std::shared_ptr<ArchiveWriterContext> writerCtx_;
};

} // namespace abc_wasm
