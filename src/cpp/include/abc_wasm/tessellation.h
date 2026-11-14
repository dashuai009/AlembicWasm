#pragma once

#include "abc_wasm/properties.h"

namespace abc_wasm {

struct DrawGroupDesc {
    std::uint32_t start = 0;
    std::uint32_t count = 0;
    int materialIndex = 0;
    std::string faceSetName;
};

/**
 * Holds welded renderable mesh buffers inside WASM memory and exposes BufferViewDescs.
 */
class RenderMeshBuffer {
public:
    std::vector<float> positions;
    std::vector<float> normals;
    std::vector<float> uvs;
    std::vector<float> colors; // RGBA (4 floats per vertex) when hasColors == true
    std::vector<std::uint32_t> indices;
    std::vector<DrawGroupDesc> groups;
    bool hasNormals = false;
    bool hasUVs = false;
    bool hasColors = false;
    Box3dDesc bounds;

    BufferViewDesc getPositionsView() const {
        BufferViewDesc d;
        d.ptr = positions.empty() ? 0 : reinterpret_cast<std::uintptr_t>(positions.data());
        d.length = positions.size() / 3;
        d.pod = static_cast<int>(AbcU::kFloat32POD);
        d.extent = 3;
        d.byteLength = positions.size() * sizeof(float);
        return d;
    }

    BufferViewDesc getNormalsView() const {
        BufferViewDesc d;
        d.ptr = normals.empty() ? 0 : reinterpret_cast<std::uintptr_t>(normals.data());
        d.length = normals.size() / 3;
        d.pod = static_cast<int>(AbcU::kFloat32POD);
        d.extent = 3;
        d.byteLength = normals.size() * sizeof(float);
        return d;
    }

    BufferViewDesc getUVsView() const {
        BufferViewDesc d;
        d.ptr = uvs.empty() ? 0 : reinterpret_cast<std::uintptr_t>(uvs.data());
        d.length = uvs.size() / 2;
        d.pod = static_cast<int>(AbcU::kFloat32POD);
        d.extent = 2;
        d.byteLength = uvs.size() * sizeof(float);
        return d;
    }

    BufferViewDesc getColorsView() const {
        BufferViewDesc d;
        d.ptr = colors.empty() ? 0 : reinterpret_cast<std::uintptr_t>(colors.data());
        d.length = colors.size() / 4;
        d.pod = static_cast<int>(AbcU::kFloat32POD);
        d.extent = 4;
        d.byteLength = colors.size() * sizeof(float);
        return d;
    }

    BufferViewDesc getIndicesView() const {
        BufferViewDesc d;
        d.ptr = indices.empty() ? 0 : reinterpret_cast<std::uintptr_t>(indices.data());
        d.length = indices.size();
        d.pod = static_cast<int>(AbcU::kUint32POD);
        d.extent = 1;
        d.byteLength = indices.size() * sizeof(std::uint32_t);
        return d;
    }

    std::size_t getVertexCount() const { return positions.size() / 3; }
    std::size_t getIndexCount() const { return indices.size(); }

    emscripten::val getGroups() const {
        emscripten::val arr = emscripten::val::array();
        for (std::size_t i = 0; i < groups.size(); ++i) {
            emscripten::val g = emscripten::val::object();
            g.set("start", groups[i].start);
            g.set("count", groups[i].count);
            g.set("materialIndex", groups[i].materialIndex);
            g.set("faceSetName", groups[i].faceSetName);
            arr.set(i, g);
        }
        return arr;
    }

    Box3dDesc getBounds() const { return bounds; }
};

/**
 * Cached plan for zero-allocation streaming interpolation of homogeneous topology PolyMeshes.
 */
class HomogeneousMeshPlan {
public:
    HomogeneousMeshPlan(
        const AbcG::IPolyMeshSchema& schema,
        ReaderKeepAlivePtr keepAlive,
        bool reverseWinding,
        bool flatNormals
    );

    std::shared_ptr<RenderMeshBuffer> getInitialBuffer() const { return initialBuffer_; }

    /**
     * Evaluates interpolated positions and normals at arbitrary time `timeSeconds`
     * (or step sample if interpolate == false) into internal reusable buffers.
     */
    void evaluateAtTime(double timeSeconds, bool interpolate);

    BufferViewDesc getPositionsView() const {
        BufferViewDesc d;
        d.ptr = evalPositions_.empty() ? 0 : reinterpret_cast<std::uintptr_t>(evalPositions_.data());
        d.length = evalPositions_.size() / 3;
        d.pod = static_cast<int>(AbcU::kFloat32POD);
        d.extent = 3;
        d.byteLength = evalPositions_.size() * sizeof(float);
        return d;
    }

    BufferViewDesc getNormalsView() const {
        BufferViewDesc d;
        d.ptr = evalNormals_.empty() ? 0 : reinterpret_cast<std::uintptr_t>(evalNormals_.data());
        d.length = evalNormals_.size() / 3;
        d.pod = static_cast<int>(AbcU::kFloat32POD);
        d.extent = 3;
        d.byteLength = evalNormals_.size() * sizeof(float);
        return d;
    }

private:
    AbcG::IPolyMeshSchema schema_;
    ReaderKeepAlivePtr keepAlive_;
    bool reverseWinding_ = true;
    bool flatNormals_ = false;
    std::shared_ptr<RenderMeshBuffer> initialBuffer_;
    std::vector<std::uint32_t> weldedToPosIdx_;
    std::vector<std::uint32_t> weldedToCornerIdx_;
    std::vector<float> evalPositions_;
    std::vector<float> evalNormals_;
    std::vector<float> posAccumNormals_;
};

std::shared_ptr<RenderMeshBuffer> buildPolyMeshRenderBuffer(
    const AbcG::IPolyMeshSchema& schema,
    int selectorMode,
    double selectorValue,
    bool reverseWinding,
    bool flatNormals,
    double velocityDt
);

std::shared_ptr<RenderMeshBuffer> buildSubDRenderBuffer(
    const AbcG::ISubDSchema& schema,
    int selectorMode,
    double selectorValue,
    int subdLevel,
    bool reverseWinding
);

std::shared_ptr<RenderMeshBuffer> buildNuPatchRenderBuffer(
    const AbcG::INuPatchSchema& schema,
    int selectorMode,
    double selectorValue,
    int uSegments,
    int vSegments,
    bool reverseWinding
);

/**
 * Evaluates all strands in an ICurves sample into packed 3D line-segment pairs (Float32 [x0,y0,z0, x1,y1,z1, ...]).
 */
class CurveTessellationBuffer {
public:
    std::vector<float> segmentPositions; // Pairs of endpoints for THREE.LineSegments
    std::vector<float> segmentWidths;

    BufferViewDesc getSegmentPositionsView() const {
        BufferViewDesc d;
        d.ptr = segmentPositions.empty() ? 0 : reinterpret_cast<std::uintptr_t>(segmentPositions.data());
        d.length = segmentPositions.size() / 3;
        d.pod = static_cast<int>(AbcU::kFloat32POD);
        d.extent = 3;
        d.byteLength = segmentPositions.size() * sizeof(float);
        return d;
    }

    BufferViewDesc getSegmentWidthsView() const {
        BufferViewDesc d;
        d.ptr = segmentWidths.empty() ? 0 : reinterpret_cast<std::uintptr_t>(segmentWidths.data());
        d.length = segmentWidths.size();
        d.pod = static_cast<int>(AbcU::kFloat32POD);
        d.extent = 1;
        d.byteLength = segmentWidths.size() * sizeof(float);
        return d;
    }
};

std::shared_ptr<CurveTessellationBuffer> evaluateCurvesForRender(
    const AbcG::ICurvesSchema& schema,
    int selectorMode,
    double selectorValue,
    int segmentsPerSpan
);

} // namespace abc_wasm
