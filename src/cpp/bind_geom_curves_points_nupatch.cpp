#include "abc_wasm/schemas.h"

namespace abc_wasm {

namespace {

// Cox-de Boor basis evaluation for arbitrary B-spline / NURBS span
void evalBSplineBasis(int span, float t, int degree, const float* knots, std::vector<float>& N) {
    N.assign(static_cast<std::size_t>(degree + 1), 0.0f);
    std::vector<float> left(static_cast<std::size_t>(degree + 1), 0.0f);
    std::vector<float> right(static_cast<std::size_t>(degree + 1), 0.0f);
    N[0] = 1.0f;
    for (int j = 1; j <= degree; ++j) {
        left[j] = t - knots[span + 1 - j];
        right[j] = knots[span + j] - t;
        float saved = 0.0f;
        for (int r = 0; r < j; ++r) {
            float denom = right[r + 1] + left[j - r];
            float temp = (std::abs(denom) > 1e-8f) ? (N[r] / denom) : 0.0f;
            N[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        N[j] = saved;
    }
}

int findKnotSpan(int nCtrl, int degree, float u, const float* knots) {
    if (u >= knots[nCtrl]) return nCtrl - 1;
    if (u <= knots[degree]) return degree;
    int low = degree;
    int high = nCtrl;
    int mid = (low + high) / 2;
    while (u < knots[mid] || u >= knots[mid + 1]) {
        if (u < knots[mid]) high = mid;
        else low = mid;
        mid = (low + high) / 2;
    }
    return mid;
}

Abc::V3f evalCubicSegment(
    const Abc::V3f& p0,
    const Abc::V3f& p1,
    const Abc::V3f& p2,
    const Abc::V3f& p3,
    float t,
    AbcG::BasisType basis
) {
    float t2 = t * t;
    float t3 = t2 * t;
    if (basis == AbcG::kBsplineBasis) {
        float b0 = (1.0f - t) * (1.0f - t) * (1.0f - t) / 6.0f;
        float b1 = (3.0f * t3 - 6.0f * t2 + 4.0f) / 6.0f;
        float b2 = (-3.0f * t3 + 3.0f * t2 + 3.0f * t + 1.0f) / 6.0f;
        float b3 = t3 / 6.0f;
        return p0 * b0 + p1 * b1 + p2 * b2 + p3 * b3;
    } else if (basis == AbcG::kCatmullromBasis) {
        float b0 = -0.5f * t3 + t2 - 0.5f * t;
        float b1 = 1.5f * t3 - 2.5f * t2 + 1.0f;
        float b2 = -1.5f * t3 + 2.0f * t2 + 0.5f * t;
        float b3 = 0.5f * t3 - 0.5f * t2;
        return p0 * b0 + p1 * b1 + p2 * b2 + p3 * b3;
    } else if (basis == AbcG::kHermiteBasis) {
        // Hermite: p0 = pos0, p1 = tan0, p2 = pos1, p3 = tan1
        float h00 = 2.0f * t3 - 3.0f * t2 + 1.0f;
        float h10 = t3 - 2.0f * t2 + t;
        float h01 = -2.0f * t3 + 3.0f * t2;
        float h11 = t3 - t2;
        return p0 * h00 + p1 * h10 + p2 * h01 + p3 * h11;
    } else {
        // Default Bezier
        float u = 1.0f - t;
        float b0 = u * u * u;
        float b1 = 3.0f * u * u * t;
        float b2 = 3.0f * u * t2;
        float b3 = t3;
        return p0 * b0 + p1 * b1 + p2 * b2 + p3 * b3;
    }
}

} // namespace

// ============================================================================
// Curve Tessellation Kernel
// ============================================================================

std::shared_ptr<CurveTessellationBuffer> evaluateCurvesForRender(
    const AbcG::ICurvesSchema& schema,
    int selectorMode,
    double selectorValue,
    int segmentsPerSpan
) {
    auto out = std::make_shared<CurveTessellationBuffer>();
    if (!schema.valid() || schema.getNumSamples() == 0) return out;

    int segs = std::clamp(segmentsPerSpan, 1, 64);
    Abc::ISampleSelector sel = makeSampleSelector(selectorMode, selectorValue);
    AbcG::ICurvesSchema::Sample samp;
    schema.get(samp, sel);

    Abc::P3fArraySamplePtr posPtr = samp.getPositions();
    Abc::Int32ArraySamplePtr nVertsPtr = samp.getCurvesNumVertices();
    if (!posPtr || !nVertsPtr || posPtr->size() == 0 || nVertsPtr->size() == 0) {
        return out;
    }

    const Abc::V3f* P = posPtr->get();
    std::size_t totalPos = posPtr->size();
    const std::int32_t* nVerts = nVertsPtr->get();
    std::size_t numCurves = nVertsPtr->size();

    AbcG::CurveType curveType = samp.getType();
    AbcG::CurvePeriodicity wrap = samp.getWrap();
    AbcG::BasisType basis = samp.getBasis();
    Abc::FloatArraySamplePtr weightsPtr = samp.getPositionWeights();
    Abc::FloatArraySamplePtr knotsPtr = samp.getKnots();
    Abc::UcharArraySamplePtr ordersPtr = samp.getOrders();

    // Optional widths
    Abc::FloatArraySamplePtr widthVals;
    AbcG::GeometryScope widthScope = AbcG::kUnknownScope;
    if (schema.getWidthsParam().valid() && schema.getWidthsParam().getNumSamples() > 0) {
        AbcG::IFloatGeomParam::Sample wSamp;
        schema.getWidthsParam().getExpanded(wSamp, sel);
        widthVals = wSamp.getVals();
        widthScope = wSamp.getScope();
    }

    std::size_t vOffset = 0;
    std::size_t knotOffset = 0;
    std::vector<Abc::V3f> polyline;
    std::vector<float> basisN;

    for (std::size_t c = 0; c < numCurves; ++c) {
        int nv = nVerts[c];
        if (nv < 2 || vOffset + static_cast<std::size_t>(nv) > totalPos) {
            vOffset += std::max(0, nv);
            continue;
        }
        const Abc::V3f* cp = P + vOffset;
        const float* cw = (weightsPtr && weightsPtr->size() >= vOffset + static_cast<std::size_t>(nv))
            ? (weightsPtr->get() + vOffset) : nullptr;

        polyline.clear();

        int order = (curveType == AbcG::kLinear) ? 2 : 4;
        if (curveType == AbcG::kVariableOrder && ordersPtr && c < ordersPtr->size()) {
            order = std::max<int>(2, (*ordersPtr)[c]);
        }
        int degree = order - 1;

        if (degree == 1 || nv < 4) {
            // Linear polyline
            for (int i = 0; i < nv; ++i) {
                polyline.push_back(cp[i]);
            }
            if (wrap == AbcG::kPeriodic && nv >= 3) {
                polyline.push_back(cp[0]);
            }
        } else if (knotsPtr && knotsPtr->size() >= knotOffset + static_cast<std::size_t>(nv + order)) {
            // NURBS / General B-Spline with explicit knot vector
            // Note: Alembic stores knots either in standard [nv + order] or RenderMan [nv + order - 2]
            const float* kVec = knotsPtr->get() + knotOffset;
            float uMin = kVec[degree];
            float uMax = kVec[nv];
            int totalSteps = std::max(2, (nv - degree) * segs);
            for (int s = 0; s <= totalSteps; ++s) {
                float u = uMin + (uMax - uMin) * (static_cast<float>(s) / static_cast<float>(totalSteps));
                int span = findKnotSpan(nv, degree, u, kVec);
                evalBSplineBasis(span, u, degree, kVec, basisN);
                Abc::V3f accum(0.0f, 0.0f, 0.0f);
                float wSum = 0.0f;
                for (int r = 0; r <= degree; ++r) {
                    int idx = std::clamp(span - degree + r, 0, nv - 1);
                    float w = cw ? cw[idx] : 1.0f;
                    float coeff = basisN[r] * w;
                    accum += cp[idx] * coeff;
                    wSum += coeff;
                }
                if (std::abs(wSum) > 1e-8f) accum *= (1.0f / wSum);
                polyline.push_back(accum);
            }
            knotOffset += static_cast<std::size_t>(nv + order);
        } else {
            // Cubic curve without explicit knots
            int step = (basis == AbcG::kBezierBasis) ? 3 : ((basis == AbcG::kHermiteBasis) ? 2 : 1);
            if (wrap == AbcG::kPeriodic) {
                int numSpans = (basis == AbcG::kBezierBasis) ? (nv / 3) : nv;
                for (int sp = 0; sp < numSpans; ++sp) {
                    int i0 = (sp * step) % nv;
                    int i1 = (i0 + 1) % nv;
                    int i2 = (i0 + 2) % nv;
                    int i3 = (i0 + 3) % nv;
                    int sEnd = (sp == numSpans - 1) ? segs : (segs - 1);
                    for (int s = 0; s <= sEnd; ++s) {
                        float t = static_cast<float>(s) / static_cast<float>(segs);
                        polyline.push_back(evalCubicSegment(cp[i0], cp[i1], cp[i2], cp[i3], t, basis));
                    }
                }
            } else {
                int numSpans = (nv - 4) / step + 1;
                if (numSpans < 1) {
                    for (int i = 0; i < nv; ++i) polyline.push_back(cp[i]);
                } else {
                    for (int sp = 0; sp < numSpans; ++sp) {
                        int i0 = sp * step;
                        int sEnd = (sp == numSpans - 1) ? segs : (segs - 1);
                        for (int s = 0; s <= sEnd; ++s) {
                            float t = static_cast<float>(s) / static_cast<float>(segs);
                            polyline.push_back(evalCubicSegment(
                                cp[i0], cp[i0 + 1], cp[i0 + 2], cp[i0 + 3], t, basis
                            ));
                        }
                    }
                }
            }
        }

        float curveWidth = 0.01f;
        if (widthVals && widthVals->size() > 0) {
            if (widthScope == AbcG::kConstantScope) curveWidth = (*widthVals)[0];
            else if (widthScope == AbcG::kUniformScope && c < widthVals->size()) curveWidth = (*widthVals)[c];
            else if (vOffset < widthVals->size()) curveWidth = (*widthVals)[vOffset];
        }

        for (std::size_t i = 0; i + 1 < polyline.size(); ++i) {
            const Abc::V3f& a = polyline[i];
            const Abc::V3f& b = polyline[i + 1];
            out->segmentPositions.push_back(a.x);
            out->segmentPositions.push_back(a.y);
            out->segmentPositions.push_back(a.z);
            out->segmentPositions.push_back(b.x);
            out->segmentPositions.push_back(b.y);
            out->segmentPositions.push_back(b.z);
            out->segmentWidths.push_back(curveWidth);
        }

        vOffset += static_cast<std::size_t>(nv);
    }

    return out;
}

// ============================================================================
// NuPatch Surface Tessellation Kernel
// ============================================================================

std::shared_ptr<RenderMeshBuffer> buildNuPatchRenderBuffer(
    const AbcG::INuPatchSchema& schema,
    int selectorMode,
    double selectorValue,
    int uSegments,
    int vSegments,
    bool reverseWinding
) {
    auto out = std::make_shared<RenderMeshBuffer>();
    if (!schema.valid() || schema.getNumSamples() == 0) return out;

    Abc::ISampleSelector sel = makeSampleSelector(selectorMode, selectorValue);
    AbcG::INuPatchSchema::Sample samp;
    schema.get(samp, sel);
    if (!samp.valid()) return out;

    int nu = samp.getNumU();
    int nv = samp.getNumV();
    int uOrder = samp.getUOrder();
    int vOrder = samp.getVOrder();
    int pDeg = std::max(1, uOrder - 1);
    int qDeg = std::max(1, vOrder - 1);

    Abc::P3fArraySamplePtr posPtr = samp.getPositions();
    Abc::FloatArraySamplePtr uKnotPtr = samp.getUKnot();
    Abc::FloatArraySamplePtr vKnotPtr = samp.getVKnot();
    Abc::FloatArraySamplePtr weightsPtr = samp.getPositionWeights();
    if (!posPtr || !uKnotPtr || !vKnotPtr ||
        posPtr->size() < static_cast<std::size_t>(nu * nv)) {
        return out;
    }

    const Abc::V3f* ctrlPts = posPtr->get();
    const float* weights = (weightsPtr && weightsPtr->size() >= static_cast<std::size_t>(nu * nv))
        ? weightsPtr->get() : nullptr;

    // Normalize/adapt knot vectors if Alembic/Maya style (nu + uOrder) or (nu + uOrder - 2)
    auto prepareKnots = [](const Abc::FloatArraySamplePtr& kPtr, int nCtrl, int order) {
        std::vector<float> k;
        std::size_t expected = static_cast<std::size_t>(nCtrl + order);
        if (kPtr->size() >= expected) {
            k.assign(kPtr->get(), kPtr->get() + expected);
        } else if (kPtr->size() + 2 == expected && kPtr->size() >= 2) {
            // Maya style omits duplicate outer knots
            k.reserve(expected);
            k.push_back((*kPtr)[0]);
            for (std::size_t i = 0; i < kPtr->size(); ++i) k.push_back((*kPtr)[i]);
            k.push_back((*kPtr)[kPtr->size() - 1]);
        } else {
            // Fallback clamped uniform knots
            k.resize(expected, 0.0f);
            int deg = order - 1;
            for (int i = 0; i <= deg; ++i) k[i] = 0.0f;
            int internal = nCtrl - order;
            for (int i = 1; i <= internal; ++i) {
                k[deg + i] = static_cast<float>(i) / static_cast<float>(internal + 1);
            }
            for (std::size_t i = static_cast<std::size_t>(nCtrl); i < expected; ++i) k[i] = 1.0f;
        }
        return k;
    };

    std::vector<float> uKnots = prepareKnots(uKnotPtr, nu, uOrder);
    std::vector<float> vKnots = prepareKnots(vKnotPtr, nv, vOrder);

    int segU = std::clamp(uSegments, 2, 256);
    int segV = std::clamp(vSegments, 2, 256);
    int gridW = segU + 1;
    int gridH = segV + 1;
    std::size_t vertCount = static_cast<std::size_t>(gridW * gridH);

    out->positions.resize(vertCount * 3, 0.0f);
    out->normals.resize(vertCount * 3, 0.0f);
    out->uvs.resize(vertCount * 2, 0.0f);
    out->hasNormals = true;
    out->hasUVs = true;

    float uMin = uKnots[pDeg];
    float uMax = uKnots[nu];
    float vMin = vKnots[qDeg];
    float vMax = vKnots[nv];

    std::vector<float> Nu, Nv;
    Abc::Box3d bbox;
    bbox.makeEmpty();

    for (int iv = 0; iv < gridH; ++iv) {
        float tv = static_cast<float>(iv) / static_cast<float>(segV);
        float vParam = vMin + (vMax - vMin) * tv;
        int spanV = findKnotSpan(nv, qDeg, vParam, vKnots.data());
        evalBSplineBasis(spanV, vParam, qDeg, vKnots.data(), Nv);

        for (int iu = 0; iu < gridW; ++iu) {
            float tu = static_cast<float>(iu) / static_cast<float>(segU);
            float uParam = uMin + (uMax - uMin) * tu;
            int spanU = findKnotSpan(nu, pDeg, uParam, uKnots.data());
            evalBSplineBasis(spanU, uParam, pDeg, uKnots.data(), Nu);

            Abc::V3f sumP(0.0f, 0.0f, 0.0f);
            float sumW = 0.0f;
            for (int b = 0; b <= qDeg; ++b) {
                int cv = std::clamp(spanV - qDeg + b, 0, nv - 1);
                for (int a = 0; a <= pDeg; ++a) {
                    int cu = std::clamp(spanU - pDeg + a, 0, nu - 1);
                    int ctrlIdx = cv * nu + cu; // Alembic NuPatch is u-varying fastest
                    float w = weights ? weights[ctrlIdx] : 1.0f;
                    float basis = Nu[a] * Nv[b] * w;
                    sumP += ctrlPts[ctrlIdx] * basis;
                    sumW += basis;
                }
            }
            if (std::abs(sumW) > 1e-8f) sumP *= (1.0f / sumW);

            std::size_t vIdx = static_cast<std::size_t>(iv * gridW + iu);
            out->positions[vIdx * 3 + 0] = sumP.x;
            out->positions[vIdx * 3 + 1] = sumP.y;
            out->positions[vIdx * 3 + 2] = sumP.z;
            out->uvs[vIdx * 2 + 0] = tu;
            out->uvs[vIdx * 2 + 1] = tv;
            bbox.extendBy(Abc::V3d(sumP.x, sumP.y, sumP.z));
        }
    }

    out->indices.reserve(static_cast<std::size_t>(segU * segV * 6));
    for (int iv = 0; iv < segV; ++iv) {
        for (int iu = 0; iu < segU; ++iu) {
            std::uint32_t i00 = static_cast<std::uint32_t>(iv * gridW + iu);
            std::uint32_t i10 = static_cast<std::uint32_t>(iv * gridW + iu + 1);
            std::uint32_t i11 = static_cast<std::uint32_t>((iv + 1) * gridW + iu + 1);
            std::uint32_t i01 = static_cast<std::uint32_t>((iv + 1) * gridW + iu);
            if (reverseWinding) {
                out->indices.push_back(i00);
                out->indices.push_back(i10);
                out->indices.push_back(i11);
                out->indices.push_back(i00);
                out->indices.push_back(i11);
                out->indices.push_back(i01);
            } else {
                out->indices.push_back(i00);
                out->indices.push_back(i11);
                out->indices.push_back(i10);
                out->indices.push_back(i00);
                out->indices.push_back(i01);
                out->indices.push_back(i11);
            }
        }
    }

    // Compute smooth area-weighted normals
    for (std::size_t t = 0; t + 2 < out->indices.size(); t += 3) {
        std::uint32_t ia = out->indices[t];
        std::uint32_t ib = out->indices[t + 1];
        std::uint32_t ic = out->indices[t + 2];
        Abc::V3f pa(out->positions[ia * 3], out->positions[ia * 3 + 1], out->positions[ia * 3 + 2]);
        Abc::V3f pb(out->positions[ib * 3], out->positions[ib * 3 + 1], out->positions[ib * 3 + 2]);
        Abc::V3f pc(out->positions[ic * 3], out->positions[ic * 3 + 1], out->positions[ic * 3 + 2]);
        Abc::V3f fn = (pb - pa).cross(pc - pa);
        for (std::uint32_t idx : {ia, ib, ic}) {
            out->normals[idx * 3 + 0] += fn.x;
            out->normals[idx * 3 + 1] += fn.y;
            out->normals[idx * 3 + 2] += fn.z;
        }
    }
    for (std::size_t v = 0; v < vertCount; ++v) {
        Abc::V3f n(out->normals[v * 3], out->normals[v * 3 + 1], out->normals[v * 3 + 2]);
        float len = n.length();
        if (len > 1e-12f) n *= (1.0f / len);
        else n = Abc::V3f(0.0f, 1.0f, 0.0f);
        out->normals[v * 3 + 0] = n.x;
        out->normals[v * 3 + 1] = n.y;
        out->normals[v * 3 + 2] = n.z;
    }

    out->bounds = toBox3dDesc(bbox);
    return out;
}

// ============================================================================
// ICurvesWrap / OCurvesWrap
// ============================================================================

ICurvesWrap::ICurvesWrap(const std::shared_ptr<IObjectWrap>& obj)
    : curves_(obj->raw(), Abc::kWrapExisting),
      schema_(curves_.getSchema()),
      keepAlive_(obj->keepAlive()) {}

emscripten::val ICurvesWrap::getRawSample(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    schema_.get(lastSample_, makeSampleSelector(selectorMode, selectorValue));
    emscripten::val res = emscripten::val::object();
    res.set("positions", makeBufferViewFromArraySample(lastSample_.getPositions()));
    res.set("numVertices", makeBufferViewFromArraySample(lastSample_.getCurvesNumVertices()));
    res.set("numCurves", static_cast<std::uint32_t>(lastSample_.getNumCurves()));
    res.set("type", static_cast<int>(lastSample_.getType()));
    res.set("wrap", static_cast<int>(lastSample_.getWrap()));
    res.set("basis", static_cast<int>(lastSample_.getBasis()));
    res.set("positionWeights", makeBufferViewFromArraySample(lastSample_.getPositionWeights()));
    res.set("orders", makeBufferViewFromArraySample(lastSample_.getOrders()));
    res.set("knots", makeBufferViewFromArraySample(lastSample_.getKnots()));
    res.set("velocities", makeBufferViewFromArraySample(lastSample_.getVelocities()));
    res.set("selfBounds", toBox3dDesc(lastSample_.getSelfBounds()));
    return res;
}

std::shared_ptr<GenericIGeomParam> ICurvesWrap::getWidthsParam() const {
    keepAlive_->ensureOpen();
    if (!schema_.getWidthsParam().valid()) return nullptr;
    return std::make_shared<GenericIGeomParam>(schema_, schema_.getWidthsParam().getName(), keepAlive_);
}

std::shared_ptr<GenericIGeomParam> ICurvesWrap::getUVsParam() const {
    keepAlive_->ensureOpen();
    if (!schema_.getUVsParam().valid()) return nullptr;
    return std::make_shared<GenericIGeomParam>(schema_, schema_.getUVsParam().getName(), keepAlive_);
}

std::shared_ptr<GenericIGeomParam> ICurvesWrap::getNormalsParam() const {
    keepAlive_->ensureOpen();
    if (!schema_.getNormalsParam().valid()) return nullptr;
    return std::make_shared<GenericIGeomParam>(schema_, schema_.getNormalsParam().getName(), keepAlive_);
}

std::shared_ptr<ICompoundWrap> ICurvesWrap::getArbGeomParams() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getArbGeomParams();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

std::shared_ptr<ICompoundWrap> ICurvesWrap::getUserProperties() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getUserProperties();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

OCurvesWrap::OCurvesWrap(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) : writerCtx_(parent->writerCtx()) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    curves_ = AbcG::OCurves(parent->raw(), name, md, tsIndex);
    schema_ = curves_.getSchema();
}

void OCurvesWrap::setSample(
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
) {
    writerCtx_->ensureWritable();
    AbcG::OCurvesSchema::Sample samp;
    if (posCount > 0 && posPtr != 0) {
        samp.setPositions(Abc::P3fArraySample(reinterpret_cast<const Abc::V3f*>(posPtr), posCount));
    }
    if (numCurves > 0 && numVertsPtr != 0) {
        samp.setCurvesNumVertices(Abc::Int32ArraySample(reinterpret_cast<const std::int32_t*>(numVertsPtr), numCurves));
    }
    samp.setType(static_cast<AbcG::CurveType>(curveType));
    samp.setWrap(static_cast<AbcG::CurvePeriodicity>(wrapPeriodicity));
    samp.setBasis(static_cast<AbcG::BasisType>(basisType));

    if (widthsCount > 0 && widthsPtr != 0) {
        AbcG::OFloatGeomParam::Sample wSamp(
            Abc::FloatArraySample(reinterpret_cast<const float*>(widthsPtr), widthsCount),
            static_cast<AbcG::GeometryScope>(widthScope)
        );
        samp.setWidths(wSamp);
    }
    if (uvsCount > 0 && uvsPtr != 0) {
        AbcG::OV2fGeomParam::Sample uvSamp(
            Abc::V2fArraySample(reinterpret_cast<const Abc::V2f*>(uvsPtr), uvsCount),
            static_cast<AbcG::GeometryScope>(uvScope)
        );
        samp.setUVs(uvSamp);
    }
    if (normalsCount > 0 && normalsPtr != 0) {
        AbcG::ON3fGeomParam::Sample nSamp(
            Abc::N3fArraySample(reinterpret_cast<const Abc::N3f*>(normalsPtr), normalsCount),
            static_cast<AbcG::GeometryScope>(normalScope)
        );
        samp.setNormals(nSamp);
    }
    if (weightsCount > 0 && weightsPtr != 0) {
        samp.setPositionWeights(Abc::FloatArraySample(reinterpret_cast<const float*>(weightsPtr), weightsCount));
    }
    if (ordersCount > 0 && ordersPtr != 0) {
        samp.setOrders(Abc::UcharArraySample(reinterpret_cast<const std::uint8_t*>(ordersPtr), ordersCount));
    }
    if (knotsCount > 0 && knotsPtr != 0) {
        samp.setKnots(Abc::FloatArraySample(reinterpret_cast<const float*>(knotsPtr), knotsCount));
    }
    if (velCount > 0 && velPtr != 0) {
        samp.setVelocities(Abc::V3fArraySample(reinterpret_cast<const Abc::V3f*>(velPtr), velCount));
    }
    schema_.set(samp);
}

std::shared_ptr<OCompoundWrap> OCurvesWrap::getArbGeomParams() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getArbGeomParams(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCompoundWrap> OCurvesWrap::getUserProperties() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getUserProperties(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

// ============================================================================
// IPointsWrap / OPointsWrap
// ============================================================================

IPointsWrap::IPointsWrap(const std::shared_ptr<IObjectWrap>& obj)
    : points_(obj->raw(), Abc::kWrapExisting),
      schema_(points_.getSchema()),
      keepAlive_(obj->keepAlive()) {}

emscripten::val IPointsWrap::getRawSample(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    schema_.get(lastSample_, makeSampleSelector(selectorMode, selectorValue));
    emscripten::val res = emscripten::val::object();
    res.set("positions", makeBufferViewFromArraySample(lastSample_.getPositions()));
    res.set("ids", makeBufferViewFromArraySample(lastSample_.getIds()));
    res.set("velocities", makeBufferViewFromArraySample(lastSample_.getVelocities()));
    res.set("selfBounds", toBox3dDesc(lastSample_.getSelfBounds()));
    return res;
}

std::shared_ptr<GenericIGeomParam> IPointsWrap::getWidthsParam() const {
    keepAlive_->ensureOpen();
    if (!schema_.getWidthsParam().valid()) return nullptr;
    return std::make_shared<GenericIGeomParam>(schema_, schema_.getWidthsParam().getName(), keepAlive_);
}

std::shared_ptr<ICompoundWrap> IPointsWrap::getArbGeomParams() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getArbGeomParams();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

std::shared_ptr<ICompoundWrap> IPointsWrap::getUserProperties() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getUserProperties();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

OPointsWrap::OPointsWrap(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) : writerCtx_(parent->writerCtx()) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    points_ = AbcG::OPoints(parent->raw(), name, md, tsIndex);
    schema_ = points_.getSchema();
}

void OPointsWrap::setSample(
    std::uintptr_t posPtr, std::size_t posCount,
    std::uintptr_t idsUint64Ptr, std::size_t idsCount,
    std::uintptr_t velPtr, std::size_t velCount,
    std::uintptr_t widthsPtr, std::size_t widthsCount, int widthScope
) {
    writerCtx_->ensureWritable();
    AbcG::OPointsSchema::Sample samp;
    if (posCount > 0 && posPtr != 0) {
        samp.setPositions(Abc::P3fArraySample(reinterpret_cast<const Abc::V3f*>(posPtr), posCount));
    }

    std::vector<AbcU::uint64_t> autoIds;
    if (idsCount > 0 && idsUint64Ptr != 0) {
        samp.setIds(Abc::UInt64ArraySample(reinterpret_cast<const AbcU::uint64_t*>(idsUint64Ptr), idsCount));
    } else if (schema_.getNumSamples() == 0) {
        // Alembic requires `ids` on the first sample of OPoints
        autoIds.resize(posCount);
        for (std::size_t i = 0; i < posCount; ++i) {
            autoIds[i] = static_cast<AbcU::uint64_t>(i);
        }
        samp.setIds(Abc::UInt64ArraySample(autoIds.data(), autoIds.size()));
    }

    if (velCount > 0 && velPtr != 0) {
        samp.setVelocities(Abc::V3fArraySample(reinterpret_cast<const Abc::V3f*>(velPtr), velCount));
    }
    if (widthsCount > 0 && widthsPtr != 0) {
        AbcG::OFloatGeomParam::Sample wSamp(
            Abc::FloatArraySample(reinterpret_cast<const float*>(widthsPtr), widthsCount),
            static_cast<AbcG::GeometryScope>(widthScope)
        );
        samp.setWidths(wSamp);
    }
    schema_.set(samp);
}

std::shared_ptr<OCompoundWrap> OPointsWrap::getArbGeomParams() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getArbGeomParams(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCompoundWrap> OPointsWrap::getUserProperties() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getUserProperties(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

// ============================================================================
// INuPatchWrap / ONuPatchWrap
// ============================================================================

INuPatchWrap::INuPatchWrap(const std::shared_ptr<IObjectWrap>& obj)
    : patch_(obj->raw(), Abc::kWrapExisting),
      schema_(patch_.getSchema()),
      keepAlive_(obj->keepAlive()) {}

emscripten::val INuPatchWrap::getRawSample(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    schema_.get(lastSample_, makeSampleSelector(selectorMode, selectorValue));
    emscripten::val res = emscripten::val::object();
    res.set("positions", makeBufferViewFromArraySample(lastSample_.getPositions()));
    res.set("velocities", makeBufferViewFromArraySample(lastSample_.getVelocities()));
    res.set("numU", lastSample_.getNumU());
    res.set("numV", lastSample_.getNumV());
    res.set("uOrder", lastSample_.getUOrder());
    res.set("vOrder", lastSample_.getVOrder());
    res.set("uKnot", makeBufferViewFromArraySample(lastSample_.getUKnot()));
    res.set("vKnot", makeBufferViewFromArraySample(lastSample_.getVKnot()));
    res.set("positionWeights", makeBufferViewFromArraySample(lastSample_.getPositionWeights()));
    res.set("hasTrimCurve", lastSample_.hasTrimCurve());
    res.set("selfBounds", toBox3dDesc(lastSample_.getSelfBounds()));
    return res;
}

std::shared_ptr<GenericIGeomParam> INuPatchWrap::getUVsParam() const {
    keepAlive_->ensureOpen();
    if (!schema_.getUVsParam().valid()) return nullptr;
    return std::make_shared<GenericIGeomParam>(schema_, schema_.getUVsParam().getName(), keepAlive_);
}

std::shared_ptr<GenericIGeomParam> INuPatchWrap::getNormalsParam() const {
    keepAlive_->ensureOpen();
    if (!schema_.getNormalsParam().valid()) return nullptr;
    return std::make_shared<GenericIGeomParam>(schema_, schema_.getNormalsParam().getName(), keepAlive_);
}

std::shared_ptr<ICompoundWrap> INuPatchWrap::getArbGeomParams() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getArbGeomParams();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

std::shared_ptr<ICompoundWrap> INuPatchWrap::getUserProperties() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getUserProperties();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

ONuPatchWrap::ONuPatchWrap(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) : writerCtx_(parent->writerCtx()) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    patch_ = AbcG::ONuPatch(parent->raw(), name, md, tsIndex);
    schema_ = patch_.getSchema();
}

void ONuPatchWrap::setSample(
    std::uintptr_t posPtr, std::size_t posCount,
    int numU, int numV,
    int uOrder, int vOrder,
    std::uintptr_t uKnotPtr, std::size_t uKnotCount,
    std::uintptr_t vKnotPtr, std::size_t vKnotCount,
    std::uintptr_t weightsPtr, std::size_t weightsCount,
    std::uintptr_t velPtr, std::size_t velCount
) {
    writerCtx_->ensureWritable();
    AbcG::ONuPatchSchema::Sample samp;
    if (posCount > 0 && posPtr != 0) {
        samp.setPositions(Abc::P3fArraySample(reinterpret_cast<const Abc::V3f*>(posPtr), posCount));
    }
    if (numU > 0) samp.setNu(numU);
    if (numV > 0) samp.setNv(numV);
    if (uOrder > 0) samp.setUOrder(uOrder);
    if (vOrder > 0) samp.setVOrder(vOrder);
    if (uKnotCount > 0 && uKnotPtr != 0) {
        samp.setUKnot(Abc::FloatArraySample(reinterpret_cast<const float*>(uKnotPtr), uKnotCount));
    }
    if (vKnotCount > 0 && vKnotPtr != 0) {
        samp.setVKnot(Abc::FloatArraySample(reinterpret_cast<const float*>(vKnotPtr), vKnotCount));
    }
    if (weightsCount > 0 && weightsPtr != 0) {
        samp.setPositionWeights(Abc::FloatArraySample(reinterpret_cast<const float*>(weightsPtr), weightsCount));
    }
    if (velCount > 0 && velPtr != 0) {
        samp.setVelocities(Abc::V3fArraySample(reinterpret_cast<const Abc::V3f*>(velPtr), velCount));
    }
    schema_.set(samp);
}

std::shared_ptr<OCompoundWrap> ONuPatchWrap::getArbGeomParams() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getArbGeomParams(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCompoundWrap> ONuPatchWrap::getUserProperties() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getUserProperties(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

namespace {

std::shared_ptr<OCurvesWrap> createOCurves(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    auto wrap = std::make_shared<OCurvesWrap>(parent, name, tsIndex, metaObj);
    parent->writerCtx()->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OPointsWrap> createOPoints(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    auto wrap = std::make_shared<OPointsWrap>(parent, name, tsIndex, metaObj);
    parent->writerCtx()->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<ONuPatchWrap> createONuPatch(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    auto wrap = std::make_shared<ONuPatchWrap>(parent, name, tsIndex, metaObj);
    parent->writerCtx()->registerHandle(wrap);
    return wrap;
}

} // namespace

EMSCRIPTEN_BINDINGS(abc_wasm_geom_curves_points_nupatch) {
    using namespace emscripten;

    class_<CurveTessellationBuffer>("CurveTessellationBuffer")
        .smart_ptr<std::shared_ptr<CurveTessellationBuffer>>("CurveTessellationBuffer")
        .function("getSegmentPositionsView", &CurveTessellationBuffer::getSegmentPositionsView)
        .function("getSegmentWidthsView", &CurveTessellationBuffer::getSegmentWidthsView);

    class_<ICurvesWrap>("ICurvesWrap")
        .smart_ptr_constructor("ICurvesWrap", &std::make_shared<ICurvesWrap, const std::shared_ptr<IObjectWrap>&>)
        .function("valid", &ICurvesWrap::valid)
        .function("getNumSamples", &ICurvesWrap::getNumSamples)
        .function("isConstant", &ICurvesWrap::isConstant)
        .function("getTopologyVariance", &ICurvesWrap::getTopologyVariance)
        .function("getTimeSamplingIndex", &ICurvesWrap::getTimeSamplingIndex)
        .function("getRawSample", &ICurvesWrap::getRawSample)
        .function("getWidthsParam", &ICurvesWrap::getWidthsParam)
        .function("getUVsParam", &ICurvesWrap::getUVsParam)
        .function("getNormalsParam", &ICurvesWrap::getNormalsParam)
        .function("getArbGeomParams", &ICurvesWrap::getArbGeomParams)
        .function("getUserProperties", &ICurvesWrap::getUserProperties)
        .function("evaluateForRender", &ICurvesWrap::evaluateForRender);

    class_<OCurvesWrap>("OCurvesWrap")
        .smart_ptr<std::shared_ptr<OCurvesWrap>>("OCurvesWrap")
        .function("getObject", &OCurvesWrap::getObject)
        .function("getNumSamples", &OCurvesWrap::getNumSamples)
        .function("setSample", &OCurvesWrap::setSample)
        .function("setFromPrevious", &OCurvesWrap::setFromPrevious)
        .function("setTimeSampling", &OCurvesWrap::setTimeSampling)
        .function("getArbGeomParams", &OCurvesWrap::getArbGeomParams)
        .function("getUserProperties", &OCurvesWrap::getUserProperties);

    class_<IPointsWrap>("IPointsWrap")
        .smart_ptr_constructor("IPointsWrap", &std::make_shared<IPointsWrap, const std::shared_ptr<IObjectWrap>&>)
        .function("valid", &IPointsWrap::valid)
        .function("getNumSamples", &IPointsWrap::getNumSamples)
        .function("isConstant", &IPointsWrap::isConstant)
        .function("getTimeSamplingIndex", &IPointsWrap::getTimeSamplingIndex)
        .function("getRawSample", &IPointsWrap::getRawSample)
        .function("getWidthsParam", &IPointsWrap::getWidthsParam)
        .function("getArbGeomParams", &IPointsWrap::getArbGeomParams)
        .function("getUserProperties", &IPointsWrap::getUserProperties);

    class_<OPointsWrap>("OPointsWrap")
        .smart_ptr<std::shared_ptr<OPointsWrap>>("OPointsWrap")
        .function("getObject", &OPointsWrap::getObject)
        .function("getNumSamples", &OPointsWrap::getNumSamples)
        .function("setSample", &OPointsWrap::setSample)
        .function("setFromPrevious", &OPointsWrap::setFromPrevious)
        .function("setTimeSampling", &OPointsWrap::setTimeSampling)
        .function("getArbGeomParams", &OPointsWrap::getArbGeomParams)
        .function("getUserProperties", &OPointsWrap::getUserProperties);

    class_<INuPatchWrap>("INuPatchWrap")
        .smart_ptr_constructor("INuPatchWrap", &std::make_shared<INuPatchWrap, const std::shared_ptr<IObjectWrap>&>)
        .function("valid", &INuPatchWrap::valid)
        .function("getNumSamples", &INuPatchWrap::getNumSamples)
        .function("isConstant", &INuPatchWrap::isConstant)
        .function("getTopologyVariance", &INuPatchWrap::getTopologyVariance)
        .function("getTimeSamplingIndex", &INuPatchWrap::getTimeSamplingIndex)
        .function("getRawSample", &INuPatchWrap::getRawSample)
        .function("getUVsParam", &INuPatchWrap::getUVsParam)
        .function("getNormalsParam", &INuPatchWrap::getNormalsParam)
        .function("getArbGeomParams", &INuPatchWrap::getArbGeomParams)
        .function("getUserProperties", &INuPatchWrap::getUserProperties)
        .function("buildRenderBuffer", &INuPatchWrap::buildRenderBuffer);

    class_<ONuPatchWrap>("ONuPatchWrap")
        .smart_ptr<std::shared_ptr<ONuPatchWrap>>("ONuPatchWrap")
        .function("getObject", &ONuPatchWrap::getObject)
        .function("getNumSamples", &ONuPatchWrap::getNumSamples)
        .function("setSample", &ONuPatchWrap::setSample)
        .function("setFromPrevious", &ONuPatchWrap::setFromPrevious)
        .function("setTimeSampling", &ONuPatchWrap::setTimeSampling)
        .function("getArbGeomParams", &ONuPatchWrap::getArbGeomParams)
        .function("getUserProperties", &ONuPatchWrap::getUserProperties);

    function("createOCurves", &createOCurves);
    function("createOPoints", &createOPoints);
    function("createONuPatch", &createONuPatch);
}

} // namespace abc_wasm
