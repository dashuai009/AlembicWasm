#include "abc_wasm/schemas.h"

namespace abc_wasm {

namespace {

inline std::uint32_t floatToBits(float v) {
    // Normalize -0.0f to +0.0f for deterministic welding keys
    if (v == 0.0f) return 0u;
    std::uint32_t bits = 0;
    std::memcpy(&bits, &v, sizeof(float));
    return bits;
}

struct WeldKey {
    std::uint32_t posIdx = 0;
    std::uint32_t uBits = 0;
    std::uint32_t vBits = 0;
    std::uint32_t nxBits = 0;
    std::uint32_t nyBits = 0;
    std::uint32_t nzBits = 0;
    std::uint32_t crBits = 0;
    std::uint32_t cgBits = 0;
    std::uint32_t cbBits = 0;
    std::uint32_t caBits = 0;

    bool operator==(const WeldKey& o) const {
        return posIdx == o.posIdx &&
               uBits == o.uBits && vBits == o.vBits &&
               nxBits == o.nxBits && nyBits == o.nyBits && nzBits == o.nzBits &&
               crBits == o.crBits && cgBits == o.cgBits && cbBits == o.cbBits && caBits == o.caBits;
    }
};

struct WeldKeyHasher {
    std::size_t operator()(const WeldKey& k) const noexcept {
        std::size_t h = k.posIdx;
        auto mix = [&h](std::uint32_t v) {
            h ^= static_cast<std::size_t>(v) + 0x9e3779b9u + (h << 6) + (h >> 2);
        };
        mix(k.uBits);
        mix(k.vBits);
        mix(k.nxBits);
        mix(k.nyBits);
        mix(k.nzBits);
        mix(k.crBits);
        mix(k.cgBits);
        mix(k.cbBits);
        mix(k.caBits);
        return h;
    }
};

struct ScopedColorData {
    bool valid = false;
    AbcG::GeometryScope scope = AbcG::kUnknownScope;
    int channels = 0; // 3 or 4
    std::vector<float> expanded;
};

ScopedColorData extractColorParam(const Abc::ICompoundProperty& arbParams, const Abc::ISampleSelector& sel) {
    ScopedColorData out;
    if (!arbParams.valid()) return out;

    static const char* kCandidateNames[] = {"Cd", "Cs", "color", "rgba", "displayColor"};
    const AbcA::PropertyHeader* foundHdr = nullptr;
    std::string foundName;

    for (const char* cand : kCandidateNames) {
        const AbcA::PropertyHeader* ph = arbParams.getPropertyHeader(cand);
        if (ph) {
            foundHdr = ph;
            foundName = cand;
            break;
        }
    }
    if (!foundHdr) {
        // Scan any property with "rgb" or "rgba" interpretation
        for (std::size_t i = 0; i < arbParams.getNumProperties(); ++i) {
            const AbcA::PropertyHeader& ph = arbParams.getPropertyHeader(i);
            std::string interp = ph.getMetaData().get("interpretation");
            if (interp == "rgb" || interp == "rgba") {
                foundHdr = &ph;
                foundName = ph.getName();
                break;
            }
        }
    }
    if (!foundHdr) return out;

    Abc::ICompoundProperty cprop;
    Abc::IArrayProperty valProp;
    Abc::IArrayProperty idxProp;
    bool isIndexed = false;

    if (foundHdr->isCompound()) {
        cprop = Abc::ICompoundProperty(arbParams, foundName);
        if (cprop.getPropertyHeader(".vals") == nullptr) return out;
        valProp = Abc::IArrayProperty(cprop, ".vals");
        if (cprop.getPropertyHeader(".indices") != nullptr) {
            idxProp = Abc::IArrayProperty(cprop, ".indices");
            isIndexed = true;
        }
    } else if (foundHdr->isArray()) {
        valProp = Abc::IArrayProperty(arbParams, foundName);
    } else {
        return out;
    }

    if (!valProp.valid() || valProp.getNumSamples() == 0) return out;
    const AbcA::DataType& dt = valProp.getDataType();
    if (dt.getPod() != AbcU::kFloat32POD && dt.getPod() != AbcU::kFloat16POD) return out;
    int ext = static_cast<int>(dt.getExtent());
    if (ext != 3 && ext != 4) return out;

    out.scope = AbcG::GetGeometryScope(foundHdr->getMetaData());
    if (out.scope == AbcG::kUnknownScope) {
        out.scope = AbcG::GetGeometryScope(valProp.getMetaData());
    }
    out.channels = ext;

    AbcA::ArraySamplePtr valSamp;
    valProp.get(valSamp, sel);
    if (!valSamp || valSamp->size() == 0) return out;

    std::vector<float> rawFloats(valSamp->size() * static_cast<std::size_t>(ext));
    if (dt.getPod() == AbcU::kFloat32POD) {
        std::memcpy(rawFloats.data(), valSamp->getData(), rawFloats.size() * sizeof(float));
    } else {
        const Imath::half* h = static_cast<const Imath::half*>(valSamp->getData());
        for (std::size_t i = 0; i < rawFloats.size(); ++i) rawFloats[i] = static_cast<float>(h[i]);
    }

    if (isIndexed && idxProp.valid() && idxProp.getNumSamples() > 0) {
        AbcA::ArraySamplePtr idxSamp;
        idxProp.get(idxSamp, sel);
        if (idxSamp && idxSamp->size() > 0) {
            const std::uint32_t* idx = static_cast<const std::uint32_t*>(idxSamp->getData());
            std::size_t nIdx = idxSamp->size();
            out.expanded.resize(nIdx * static_cast<std::size_t>(ext), 1.0f);
            for (std::size_t i = 0; i < nIdx; ++i) {
                std::size_t srcTuple = idx[i] < valSamp->size() ? idx[i] : 0;
                for (int c = 0; c < ext; ++c) {
                    out.expanded[i * ext + c] = rawFloats[srcTuple * ext + c];
                }
            }
            out.valid = true;
            return out;
        }
    }

    out.expanded = std::move(rawFloats);
    out.valid = true;
    return out;
}

inline std::size_t resolveScopeIndex(
    AbcG::GeometryScope scope,
    std::size_t posIdx,
    std::size_t cornerIdx,
    std::size_t faceIdx,
    std::size_t maxCount
) {
    std::size_t idx = 0;
    switch (scope) {
        case AbcG::kConstantScope:
            idx = 0;
            break;
        case AbcG::kUniformScope:
            idx = faceIdx;
            break;
        case AbcG::kVaryingScope:
        case AbcG::kVertexScope:
            idx = posIdx;
            break;
        case AbcG::kFacevaryingScope:
        default:
            idx = cornerIdx;
            break;
    }
    return (maxCount > 0 && idx < maxCount) ? idx : 0;
}

struct FaceGroupMapping {
    std::vector<int> faceToGroup;
    std::vector<std::string> groupNames; // index -> faceSetName ("" for unassigned default)
};

template <typename SchemaT>
FaceGroupMapping buildFaceGroupMapping(
    SchemaT schema,
    std::size_t numFaces,
    const Abc::ISampleSelector& sel
) {
    FaceGroupMapping mapping;
    std::vector<std::string> fsNames;
    schema.getFaceSetNames(fsNames);
    if (fsNames.empty() || numFaces == 0) {
        return mapping;
    }

    mapping.faceToGroup.assign(numFaces, -1);
    for (std::size_t g = 0; g < fsNames.size(); ++g) {
        AbcG::IFaceSet fs = schema.getFaceSet(fsNames[g]);
        if (!fs.valid()) continue;
        AbcG::IFaceSetSchema fss = fs.getSchema();
        if (!fss.valid() || fss.getNumSamples() == 0) continue;
        AbcG::IFaceSetSchema::Sample fsSamp;
        fss.get(fsSamp, sel);
        Abc::Int32ArraySamplePtr faces = fsSamp.getFaces();
        if (!faces || faces->size() == 0) continue;

        int groupId = static_cast<int>(mapping.groupNames.size());
        mapping.groupNames.push_back(fsNames[g]);
        const std::int32_t* fPtr = faces->get();
        for (std::size_t i = 0; i < faces->size(); ++i) {
            std::int32_t fIdx = fPtr[i];
            if (fIdx >= 0 && static_cast<std::size_t>(fIdx) < numFaces && mapping.faceToGroup[fIdx] < 0) {
                mapping.faceToGroup[fIdx] = groupId;
            }
        }
    }

    if (mapping.groupNames.empty()) {
        mapping.faceToGroup.clear();
        return mapping;
    }

    // Check if any face remained unassigned (-1); if so, assign them to a trailing default group
    bool hasUnassigned = false;
    for (int g : mapping.faceToGroup) {
        if (g < 0) {
            hasUnassigned = true;
            break;
        }
    }
    if (hasUnassigned) {
        int defaultGroup = static_cast<int>(mapping.groupNames.size());
        mapping.groupNames.push_back("");
        for (int& g : mapping.faceToGroup) {
            if (g < 0) g = defaultGroup;
        }
    }
    return mapping;
}

std::shared_ptr<RenderMeshBuffer> weldMeshCore(
    const Abc::V3f* positions,
    std::size_t numPositions,
    const Abc::V3f* velocities,
    std::size_t numVelocities,
    double velocityDt,
    const std::int32_t* faceCounts,
    std::size_t numFaces,
    const std::int32_t* faceIndices,
    std::size_t numCorners,
    const Abc::V2f* uvs,
    std::size_t numUVs,
    AbcG::GeometryScope uvScope,
    const Abc::N3f* normals,
    std::size_t numNormals,
    AbcG::GeometryScope normalScope,
    const ScopedColorData& colors,
    const FaceGroupMapping& faceGroups,
    bool reverseWinding,
    bool flatNormals,
    std::vector<std::uint32_t>* outWeldedToPosIdx,
    std::vector<std::uint32_t>* outWeldedToCornerIdx
) {
    auto buf = std::make_shared<RenderMeshBuffer>();
    if (!positions || numPositions == 0 || !faceCounts || numFaces == 0 || !faceIndices || numCorners == 0) {
        return buf;
    }

    const bool useAuthoredNormals = (!flatNormals && normals != nullptr && numNormals > 0);
    const bool useUVs = (uvs != nullptr && numUVs > 0);
    const bool useColors = (colors.valid && !colors.expanded.empty());
    const bool advect = (velocities != nullptr && numVelocities >= numPositions && std::abs(velocityDt) > 1e-9);

    buf->hasNormals = true;
    buf->hasUVs = useUVs;
    buf->hasColors = useColors;

    std::unordered_map<WeldKey, std::uint32_t, WeldKeyHasher> weldMap;
    weldMap.reserve(numCorners);

    std::size_t numBuckets = faceGroups.groupNames.empty() ? 1 : faceGroups.groupNames.size();
    std::vector<std::vector<std::uint32_t>> bucketIndices(numBuckets);
    for (auto& b : bucketIndices) {
        b.reserve((numCorners * 3) / numBuckets + 16);
    }

    Abc::Box3d bbox;
    bbox.makeEmpty();

    auto emitCorner = [&](std::size_t f, std::size_t cornerIdx) -> std::uint32_t {
        std::int32_t rawP = faceIndices[cornerIdx];
        std::uint32_t pIdx = (rawP >= 0 && static_cast<std::size_t>(rawP) < numPositions)
            ? static_cast<std::uint32_t>(rawP) : 0u;

        Abc::V2f uv(0.0f, 0.0f);
        if (useUVs) {
            std::size_t uIdx = resolveScopeIndex(uvScope, pIdx, cornerIdx, f, numUVs);
            uv = uvs[uIdx];
        }

        Abc::N3f nrm(0.0f, 1.0f, 0.0f);
        if (useAuthoredNormals) {
            std::size_t nIdx = resolveScopeIndex(normalScope, pIdx, cornerIdx, f, numNormals);
            nrm = normals[nIdx];
        }

        float cr = 1.0f, cg = 1.0f, cb = 1.0f, ca = 1.0f;
        if (useColors) {
            std::size_t tupleCount = colors.expanded.size() / static_cast<std::size_t>(colors.channels);
            std::size_t cIdx = resolveScopeIndex(colors.scope, pIdx, cornerIdx, f, tupleCount);
            cr = colors.expanded[cIdx * colors.channels + 0];
            cg = colors.expanded[cIdx * colors.channels + 1];
            cb = colors.expanded[cIdx * colors.channels + 2];
            if (colors.channels == 4) ca = colors.expanded[cIdx * 4 + 3];
        }

        if (!flatNormals) {
            WeldKey key;
            key.posIdx = pIdx;
            if (useUVs) {
                key.uBits = floatToBits(uv.x);
                key.vBits = floatToBits(uv.y);
            }
            if (useAuthoredNormals) {
                key.nxBits = floatToBits(nrm.x);
                key.nyBits = floatToBits(nrm.y);
                key.nzBits = floatToBits(nrm.z);
            }
            if (useColors) {
                key.crBits = floatToBits(cr);
                key.cgBits = floatToBits(cg);
                key.cbBits = floatToBits(cb);
                key.caBits = floatToBits(ca);
            }
            auto it = weldMap.find(key);
            if (it != weldMap.end()) {
                return it->second;
            }

            std::uint32_t newIdx = static_cast<std::uint32_t>(buf->positions.size() / 3);
            weldMap.emplace(key, newIdx);

            Abc::V3f pos = positions[pIdx];
            if (advect) {
                pos += velocities[pIdx] * static_cast<float>(velocityDt);
            }
            buf->positions.push_back(pos.x);
            buf->positions.push_back(pos.y);
            buf->positions.push_back(pos.z);
            bbox.extendBy(Abc::V3d(pos.x, pos.y, pos.z));

            if (useAuthoredNormals) {
                buf->normals.push_back(nrm.x);
                buf->normals.push_back(nrm.y);
                buf->normals.push_back(nrm.z);
            }
            if (useUVs) {
                buf->uvs.push_back(uv.x);
                buf->uvs.push_back(uv.y);
            }
            if (useColors) {
                buf->colors.push_back(cr);
                buf->colors.push_back(cg);
                buf->colors.push_back(cb);
                buf->colors.push_back(ca);
            }
            if (outWeldedToPosIdx) outWeldedToPosIdx->push_back(pIdx);
            if (outWeldedToCornerIdx) outWeldedToCornerIdx->push_back(static_cast<std::uint32_t>(cornerIdx));
            return newIdx;
        } else {
            // Unwelded corners for flat shading
            std::uint32_t newIdx = static_cast<std::uint32_t>(buf->positions.size() / 3);
            Abc::V3f pos = positions[pIdx];
            if (advect) {
                pos += velocities[pIdx] * static_cast<float>(velocityDt);
            }
            buf->positions.push_back(pos.x);
            buf->positions.push_back(pos.y);
            buf->positions.push_back(pos.z);
            bbox.extendBy(Abc::V3d(pos.x, pos.y, pos.z));
            if (useUVs) {
                buf->uvs.push_back(uv.x);
                buf->uvs.push_back(uv.y);
            }
            if (useColors) {
                buf->colors.push_back(cr);
                buf->colors.push_back(cg);
                buf->colors.push_back(cb);
                buf->colors.push_back(ca);
            }
            if (outWeldedToPosIdx) outWeldedToPosIdx->push_back(pIdx);
            if (outWeldedToCornerIdx) outWeldedToCornerIdx->push_back(static_cast<std::uint32_t>(cornerIdx));
            return newIdx;
        }
    };

    std::size_t cornerBase = 0;
    for (std::size_t f = 0; f < numFaces; ++f) {
        int fc = faceCounts[f];
        if (fc < 3 || cornerBase + static_cast<std::size_t>(fc) > numCorners) {
            cornerBase += std::max(0, fc);
            continue;
        }

        std::size_t bucket = (!faceGroups.faceToGroup.empty() && f < faceGroups.faceToGroup.size())
            ? static_cast<std::size_t>(faceGroups.faceToGroup[f]) : 0;
        auto& dstIdx = bucketIndices[bucket];

        if (!flatNormals) {
            std::uint32_t c0 = emitCorner(f, cornerBase);
            std::uint32_t prev = emitCorner(f, cornerBase + 1);
            for (int k = 2; k < fc; ++k) {
                std::uint32_t cur = emitCorner(f, cornerBase + static_cast<std::size_t>(k));
                if (reverseWinding) {
                    // CW -> CCW: (c0, cur, prev)
                    dstIdx.push_back(c0);
                    dstIdx.push_back(cur);
                    dstIdx.push_back(prev);
                } else {
                    dstIdx.push_back(c0);
                    dstIdx.push_back(prev);
                    dstIdx.push_back(cur);
                }
                prev = cur;
            }
        } else {
            // Flat shading: each triangle gets distinct corners so face normals stay crisp
            for (int k = 1; k + 1 < fc; ++k) {
                std::size_t idxA = cornerBase;
                std::size_t idxB = reverseWinding ? (cornerBase + static_cast<std::size_t>(k + 1))
                                                  : (cornerBase + static_cast<std::size_t>(k));
                std::size_t idxC = reverseWinding ? (cornerBase + static_cast<std::size_t>(k))
                                                  : (cornerBase + static_cast<std::size_t>(k + 1));
                dstIdx.push_back(emitCorner(f, idxA));
                dstIdx.push_back(emitCorner(f, idxB));
                dstIdx.push_back(emitCorner(f, idxC));
            }
        }

        cornerBase += static_cast<std::size_t>(fc);
    }

    // Flatten bucketed indices & record DrawGroupDescs
    std::size_t totalIndices = 0;
    for (const auto& b : bucketIndices) totalIndices += b.size();
    buf->indices.reserve(totalIndices);

    if (!faceGroups.groupNames.empty()) {
        for (std::size_t b = 0; b < bucketIndices.size(); ++b) {
            if (bucketIndices[b].empty()) continue;
            DrawGroupDesc grp;
            grp.start = static_cast<std::uint32_t>(buf->indices.size());
            grp.count = static_cast<std::uint32_t>(bucketIndices[b].size());
            grp.materialIndex = static_cast<int>(b);
            grp.faceSetName = faceGroups.groupNames[b];
            buf->groups.push_back(grp);
            buf->indices.insert(buf->indices.end(), bucketIndices[b].begin(), bucketIndices[b].end());
        }
    } else if (!bucketIndices.empty()) {
        buf->indices = std::move(bucketIndices[0]);
    }

    // Compute normals if not authored or if flatNormals requested
    std::size_t numWelded = buf->positions.size() / 3;
    if (!useAuthoredNormals) {
        buf->normals.assign(numWelded * 3, 0.0f);
        if (flatNormals) {
            for (std::size_t t = 0; t + 2 < buf->indices.size(); t += 3) {
                std::uint32_t ia = buf->indices[t];
                std::uint32_t ib = buf->indices[t + 1];
                std::uint32_t ic = buf->indices[t + 2];
                Abc::V3f pa(buf->positions[ia * 3], buf->positions[ia * 3 + 1], buf->positions[ia * 3 + 2]);
                Abc::V3f pb(buf->positions[ib * 3], buf->positions[ib * 3 + 1], buf->positions[ib * 3 + 2]);
                Abc::V3f pc(buf->positions[ic * 3], buf->positions[ic * 3 + 1], buf->positions[ic * 3 + 2]);
                Abc::V3f fn = (pb - pa).cross(pc - pa);
                float len = fn.length();
                if (len > 1e-12f) fn *= (1.0f / len);
                else fn = Abc::V3f(0.0f, 1.0f, 0.0f);
                for (std::uint32_t idx : {ia, ib, ic}) {
                    buf->normals[idx * 3 + 0] = fn.x;
                    buf->normals[idx * 3 + 1] = fn.y;
                    buf->normals[idx * 3 + 2] = fn.z;
                }
            }
        } else {
            // Smooth area-weighted normals accumulated by original posIdx so UV seams remain smooth!
            std::vector<Abc::V3f> posNormals(numPositions, Abc::V3f(0.0f, 0.0f, 0.0f));
            for (std::size_t t = 0; t + 2 < buf->indices.size(); t += 3) {
                std::uint32_t ia = buf->indices[t];
                std::uint32_t ib = buf->indices[t + 1];
                std::uint32_t ic = buf->indices[t + 2];
                Abc::V3f pa(buf->positions[ia * 3], buf->positions[ia * 3 + 1], buf->positions[ia * 3 + 2]);
                Abc::V3f pb(buf->positions[ib * 3], buf->positions[ib * 3 + 1], buf->positions[ib * 3 + 2]);
                Abc::V3f pc(buf->positions[ic * 3], buf->positions[ic * 3 + 1], buf->positions[ic * 3 + 2]);
                Abc::V3f fn = (pb - pa).cross(pc - pa);
                if (outWeldedToPosIdx && outWeldedToPosIdx->size() == numWelded) {
                    posNormals[(*outWeldedToPosIdx)[ia]] += fn;
                    posNormals[(*outWeldedToPosIdx)[ib]] += fn;
                    posNormals[(*outWeldedToPosIdx)[ic]] += fn;
                } else {
                    buf->normals[ia * 3] += fn.x; buf->normals[ia * 3 + 1] += fn.y; buf->normals[ia * 3 + 2] += fn.z;
                    buf->normals[ib * 3] += fn.x; buf->normals[ib * 3 + 1] += fn.y; buf->normals[ib * 3 + 2] += fn.z;
                    buf->normals[ic * 3] += fn.x; buf->normals[ic * 3 + 1] += fn.y; buf->normals[ic * 3 + 2] += fn.z;
                }
            }
            if (outWeldedToPosIdx && outWeldedToPosIdx->size() == numWelded) {
                for (auto& pn : posNormals) {
                    float len = pn.length();
                    if (len > 1e-12f) pn *= (1.0f / len);
                    else pn = Abc::V3f(0.0f, 1.0f, 0.0f);
                }
                for (std::size_t w = 0; w < numWelded; ++w) {
                    const Abc::V3f& pn = posNormals[(*outWeldedToPosIdx)[w]];
                    buf->normals[w * 3 + 0] = pn.x;
                    buf->normals[w * 3 + 1] = pn.y;
                    buf->normals[w * 3 + 2] = pn.z;
                }
            } else {
                for (std::size_t w = 0; w < numWelded; ++w) {
                    Abc::V3f n(buf->normals[w * 3], buf->normals[w * 3 + 1], buf->normals[w * 3 + 2]);
                    float len = n.length();
                    if (len > 1e-12f) n *= (1.0f / len);
                    else n = Abc::V3f(0.0f, 1.0f, 0.0f);
                    buf->normals[w * 3 + 0] = n.x;
                    buf->normals[w * 3 + 1] = n.y;
                    buf->normals[w * 3 + 2] = n.z;
                }
            }
        }
    }

    buf->bounds = toBox3dDesc(bbox);
    return buf;
}

} // namespace

// ============================================================================
// PolyMesh & SubD Render Kernels + HomogeneousMeshPlan
// ============================================================================

std::shared_ptr<RenderMeshBuffer> buildPolyMeshRenderBuffer(
    const AbcG::IPolyMeshSchema& schema,
    int selectorMode,
    double selectorValue,
    bool reverseWinding,
    bool flatNormals,
    double velocityDt
) {
    if (!schema.valid() || schema.getNumSamples() == 0) {
        return std::make_shared<RenderMeshBuffer>();
    }
    Abc::ISampleSelector sel = makeSampleSelector(selectorMode, selectorValue);
    AbcG::IPolyMeshSchema::Sample samp;
    schema.get(samp, sel);

    Abc::P3fArraySamplePtr posPtr = samp.getPositions();
    Abc::Int32ArraySamplePtr faceCountsPtr = samp.getFaceCounts();
    Abc::Int32ArraySamplePtr faceIndicesPtr = samp.getFaceIndices();
    Abc::V3fArraySamplePtr velPtr = samp.getVelocities();
    if (!posPtr || !faceCountsPtr || !faceIndicesPtr) {
        return std::make_shared<RenderMeshBuffer>();
    }

    Abc::V2fArraySamplePtr uvVals;
    AbcG::GeometryScope uvScope = AbcG::kUnknownScope;
    if (schema.getUVsParam().valid() && schema.getUVsParam().getNumSamples() > 0) {
        AbcG::IV2fGeomParam::Sample uvSamp;
        schema.getUVsParam().getExpanded(uvSamp, sel);
        uvVals = uvSamp.getVals();
        uvScope = uvSamp.getScope();
    }

    Abc::N3fArraySamplePtr normVals;
    AbcG::GeometryScope normScope = AbcG::kUnknownScope;
    if (!flatNormals && schema.getNormalsParam().valid() && schema.getNormalsParam().getNumSamples() > 0) {
        AbcG::IN3fGeomParam::Sample nSamp;
        schema.getNormalsParam().getExpanded(nSamp, sel);
        normVals = nSamp.getVals();
        normScope = nSamp.getScope();
    }

    ScopedColorData colors = extractColorParam(schema.getArbGeomParams(), sel);
    FaceGroupMapping faceGroups = buildFaceGroupMapping(schema, faceCountsPtr->size(), sel);

    std::vector<std::uint32_t> posRemap;
    return weldMeshCore(
        posPtr->get(), posPtr->size(),
        velPtr ? velPtr->get() : nullptr, velPtr ? velPtr->size() : 0, velocityDt,
        faceCountsPtr->get(), faceCountsPtr->size(),
        faceIndicesPtr->get(), faceIndicesPtr->size(),
        uvVals ? uvVals->get() : nullptr, uvVals ? uvVals->size() : 0, uvScope,
        normVals ? normVals->get() : nullptr, normVals ? normVals->size() : 0, normScope,
        colors,
        faceGroups,
        reverseWinding,
        flatNormals,
        &posRemap,
        nullptr
    );
}

HomogeneousMeshPlan::HomogeneousMeshPlan(
    const AbcG::IPolyMeshSchema& schema,
    ReaderKeepAlivePtr keepAlive,
    bool reverseWinding,
    bool flatNormals
) : schema_(schema),
    keepAlive_(std::move(keepAlive)),
    reverseWinding_(reverseWinding),
    flatNormals_(flatNormals) {
    keepAlive_->ensureOpen();
    if (!schema_.valid() || schema_.getNumSamples() == 0) {
        initialBuffer_ = std::make_shared<RenderMeshBuffer>();
        return;
    }
    Abc::ISampleSelector sel0(static_cast<Abc::index_t>(0));
    AbcG::IPolyMeshSchema::Sample samp0;
    schema_.get(samp0, sel0);

    Abc::P3fArraySamplePtr posPtr = samp0.getPositions();
    Abc::Int32ArraySamplePtr faceCountsPtr = samp0.getFaceCounts();
    Abc::Int32ArraySamplePtr faceIndicesPtr = samp0.getFaceIndices();
    if (!posPtr || !faceCountsPtr || !faceIndicesPtr) {
        initialBuffer_ = std::make_shared<RenderMeshBuffer>();
        return;
    }

    Abc::V2fArraySamplePtr uvVals;
    AbcG::GeometryScope uvScope = AbcG::kUnknownScope;
    if (schema_.getUVsParam().valid() && schema_.getUVsParam().getNumSamples() > 0) {
        AbcG::IV2fGeomParam::Sample uvSamp;
        schema_.getUVsParam().getExpanded(uvSamp, sel0);
        uvVals = uvSamp.getVals();
        uvScope = uvSamp.getScope();
    }

    Abc::N3fArraySamplePtr normVals;
    AbcG::GeometryScope normScope = AbcG::kUnknownScope;
    if (!flatNormals_ && schema_.getNormalsParam().valid() && schema_.getNormalsParam().getNumSamples() > 0) {
        AbcG::IN3fGeomParam::Sample nSamp;
        schema_.getNormalsParam().getExpanded(nSamp, sel0);
        normVals = nSamp.getVals();
        normScope = nSamp.getScope();
    }

    ScopedColorData colors = extractColorParam(schema_.getArbGeomParams(), sel0);
    FaceGroupMapping faceGroups = buildFaceGroupMapping(schema_, faceCountsPtr->size(), sel0);

    initialBuffer_ = weldMeshCore(
        posPtr->get(), posPtr->size(),
        nullptr, 0, 0.0,
        faceCountsPtr->get(), faceCountsPtr->size(),
        faceIndicesPtr->get(), faceIndicesPtr->size(),
        uvVals ? uvVals->get() : nullptr, uvVals ? uvVals->size() : 0, uvScope,
        normVals ? normVals->get() : nullptr, normVals ? normVals->size() : 0, normScope,
        colors,
        faceGroups,
        reverseWinding_,
        flatNormals_,
        &weldedToPosIdx_,
        &weldedToCornerIdx_
    );

    evalPositions_ = initialBuffer_->positions;
    evalNormals_ = initialBuffer_->normals;
    posAccumNormals_.resize(posPtr->size() * 3, 0.0f);
}

void HomogeneousMeshPlan::evaluateAtTime(double timeSeconds, bool interpolate) {
    keepAlive_->ensureOpen();
    if (!initialBuffer_ || weldedToPosIdx_.empty() || schema_.getNumSamples() == 0) return;

    std::size_t nSamps = schema_.getNumSamples();
    AbcA::TimeSamplingPtr ts = schema_.getTimeSampling();
    auto floorPair = ts->getFloorIndex(timeSeconds, static_cast<Abc::index_t>(nSamps));
    auto ceilPair = ts->getCeilIndex(timeSeconds, static_cast<Abc::index_t>(nSamps));

    Abc::P3fArraySamplePtr p0;
    schema_.getPositionsProperty().get(p0, Abc::ISampleSelector(floorPair.first));
    if (!p0 || p0->size() == 0) return;

    const Abc::V3f* src0 = p0->get();
    std::size_t posCount0 = p0->size();
    std::size_t numWelded = weldedToPosIdx_.size();

    bool doLerp = interpolate && (floorPair.first != ceilPair.first) &&
                  (std::abs(ceilPair.second - floorPair.second) > 1e-12);
    float alpha = 0.0f;
    Abc::P3fArraySamplePtr p1;
    const Abc::V3f* src1 = nullptr;

    if (doLerp) {
        schema_.getPositionsProperty().get(p1, Abc::ISampleSelector(ceilPair.first));
        if (p1 && p1->size() == posCount0) {
            src1 = p1->get();
            alpha = static_cast<float>(
                std::clamp((timeSeconds - floorPair.second) / (ceilPair.second - floorPair.second), 0.0, 1.0)
            );
        } else {
            doLerp = false;
        }
    }

    if (doLerp && src1) {
        float invAlpha = 1.0f - alpha;
        for (std::size_t w = 0; w < numWelded; ++w) {
            std::uint32_t pi = weldedToPosIdx_[w];
            if (pi >= posCount0) pi = 0;
            const Abc::V3f& a = src0[pi];
            const Abc::V3f& b = src1[pi];
            evalPositions_[w * 3 + 0] = a.x * invAlpha + b.x * alpha;
            evalPositions_[w * 3 + 1] = a.y * invAlpha + b.y * alpha;
            evalPositions_[w * 3 + 2] = a.z * invAlpha + b.z * alpha;
        }
    } else {
        for (std::size_t w = 0; w < numWelded; ++w) {
            std::uint32_t pi = weldedToPosIdx_[w];
            if (pi >= posCount0) pi = 0;
            const Abc::V3f& a = src0[pi];
            evalPositions_[w * 3 + 0] = a.x;
            evalPositions_[w * 3 + 1] = a.y;
            evalPositions_[w * 3 + 2] = a.z;
        }
    }

    // Check if animated authored normals exist
    bool usedAuthoredNormals = false;
    if (!flatNormals_ && schema_.getNormalsParam().valid() && schema_.getNormalsParam().getNumSamples() > 1) {
        AbcG::IN3fGeomParam nParam = schema_.getNormalsParam();
        Abc::TimeSamplingPtr nTs = nParam.getTimeSampling();
        std::size_t nNormSamps = nParam.getNumSamples();
        auto nf = nTs->getFloorIndex(timeSeconds, static_cast<Abc::index_t>(nNormSamps));
        auto nc = nTs->getCeilIndex(timeSeconds, static_cast<Abc::index_t>(nNormSamps));

        AbcG::IN3fGeomParam::Sample ns0;
        nParam.getExpanded(ns0, Abc::ISampleSelector(nf.first));
        Abc::N3fArraySamplePtr nv0 = ns0.getVals();
        AbcG::GeometryScope nScope = ns0.getScope();

        if (nv0 && nv0->size() > 0) {
            const Abc::N3f* nPtr0 = nv0->get();
            std::size_t nSize0 = nv0->size();
            const Abc::N3f* nPtr1 = nullptr;
            float nAlpha = 0.0f;

            AbcG::IN3fGeomParam::Sample ns1;
            Abc::N3fArraySamplePtr nv1;
            if (interpolate && nf.first != nc.first && std::abs(nc.second - nf.second) > 1e-12) {
                nParam.getExpanded(ns1, Abc::ISampleSelector(nc.first));
                nv1 = ns1.getVals();
                if (nv1 && nv1->size() == nSize0) {
                    nPtr1 = nv1->get();
                    nAlpha = static_cast<float>(
                        std::clamp((timeSeconds - nf.second) / (nc.second - nf.second), 0.0, 1.0)
                    );
                }
            }

            for (std::size_t w = 0; w < numWelded; ++w) {
                std::size_t lookupIdx = (nScope == AbcG::kVertexScope || nScope == AbcG::kVaryingScope)
                    ? weldedToPosIdx_[w]
                    : (w < weldedToCornerIdx_.size() ? weldedToCornerIdx_[w] : 0);
                if (lookupIdx >= nSize0) lookupIdx = 0;
                Abc::N3f n = nPtr0[lookupIdx];
                if (nPtr1) {
                    n = n * (1.0f - nAlpha) + nPtr1[lookupIdx] * nAlpha;
                    float len = n.length();
                    if (len > 1e-12f) n *= (1.0f / len);
                }
                evalNormals_[w * 3 + 0] = n.x;
                evalNormals_[w * 3 + 1] = n.y;
                evalNormals_[w * 3 + 2] = n.z;
            }
            usedAuthoredNormals = true;
        }
    }

    if (!usedAuthoredNormals) {
        const auto& idx = initialBuffer_->indices;
        if (flatNormals_) {
            for (std::size_t t = 0; t + 2 < idx.size(); t += 3) {
                std::uint32_t ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
                Abc::V3f pa(evalPositions_[ia * 3], evalPositions_[ia * 3 + 1], evalPositions_[ia * 3 + 2]);
                Abc::V3f pb(evalPositions_[ib * 3], evalPositions_[ib * 3 + 1], evalPositions_[ib * 3 + 2]);
                Abc::V3f pc(evalPositions_[ic * 3], evalPositions_[ic * 3 + 1], evalPositions_[ic * 3 + 2]);
                Abc::V3f fn = (pb - pa).cross(pc - pa);
                float len = fn.length();
                if (len > 1e-12f) fn *= (1.0f / len);
                else fn = Abc::V3f(0.0f, 1.0f, 0.0f);
                for (std::uint32_t v : {ia, ib, ic}) {
                    evalNormals_[v * 3 + 0] = fn.x;
                    evalNormals_[v * 3 + 1] = fn.y;
                    evalNormals_[v * 3 + 2] = fn.z;
                }
            }
        } else {
            if (posAccumNormals_.size() < posCount0 * 3) {
                posAccumNormals_.resize(posCount0 * 3);
            }
            std::fill(posAccumNormals_.begin(), posAccumNormals_.begin() + posCount0 * 3, 0.0f);
            for (std::size_t t = 0; t + 2 < idx.size(); t += 3) {
                std::uint32_t ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
                Abc::V3f pa(evalPositions_[ia * 3], evalPositions_[ia * 3 + 1], evalPositions_[ia * 3 + 2]);
                Abc::V3f pb(evalPositions_[ib * 3], evalPositions_[ib * 3 + 1], evalPositions_[ib * 3 + 2]);
                Abc::V3f pc(evalPositions_[ic * 3], evalPositions_[ic * 3 + 1], evalPositions_[ic * 3 + 2]);
                Abc::V3f fn = (pb - pa).cross(pc - pa);
                for (std::uint32_t v : {ia, ib, ic}) {
                    std::uint32_t pi = weldedToPosIdx_[v];
                    posAccumNormals_[pi * 3 + 0] += fn.x;
                    posAccumNormals_[pi * 3 + 1] += fn.y;
                    posAccumNormals_[pi * 3 + 2] += fn.z;
                }
            }
            for (std::size_t p = 0; p < posCount0; ++p) {
                float nx = posAccumNormals_[p * 3 + 0];
                float ny = posAccumNormals_[p * 3 + 1];
                float nz = posAccumNormals_[p * 3 + 2];
                float len = std::sqrt(nx * nx + ny * ny + nz * nz);
                if (len > 1e-12f) {
                    float inv = 1.0f / len;
                    posAccumNormals_[p * 3 + 0] = nx * inv;
                    posAccumNormals_[p * 3 + 1] = ny * inv;
                    posAccumNormals_[p * 3 + 2] = nz * inv;
                } else {
                    posAccumNormals_[p * 3 + 0] = 0.0f;
                    posAccumNormals_[p * 3 + 1] = 1.0f;
                    posAccumNormals_[p * 3 + 2] = 0.0f;
                }
            }
            for (std::size_t w = 0; w < numWelded; ++w) {
                std::uint32_t pi = weldedToPosIdx_[w];
                evalNormals_[w * 3 + 0] = posAccumNormals_[pi * 3 + 0];
                evalNormals_[w * 3 + 1] = posAccumNormals_[pi * 3 + 1];
                evalNormals_[w * 3 + 2] = posAccumNormals_[pi * 3 + 2];
            }
        }
    }
}

// ============================================================================
// Catmull-Clark / Bilinear SubD Evaluation Kernel
// ============================================================================

namespace {

struct SubDMeshState {
    std::vector<Abc::V3f> positions;
    std::vector<std::int32_t> faceCounts;
    std::vector<std::int32_t> faceIndices;
    std::vector<Abc::V2f> faceVaryingUVs;
    std::vector<int> faceGroups;
};

SubDMeshState subdivideOnce(const SubDMeshState& in, bool bilinear) {
    SubDMeshState out;
    std::size_t numVerts = in.positions.size();
    std::size_t numFaces = in.faceCounts.size();
    if (numVerts == 0 || numFaces == 0) return in;

    // 1. Face points (centroids)
    std::vector<Abc::V3f> facePoints(numFaces, Abc::V3f(0.0f, 0.0f, 0.0f));
    std::vector<std::size_t> faceStart(numFaces, 0);
    std::size_t cOffset = 0;
    for (std::size_t f = 0; f < numFaces; ++f) {
        faceStart[f] = cOffset;
        int fc = in.faceCounts[f];
        if (fc > 0) {
            Abc::V3f sum(0.0f, 0.0f, 0.0f);
            for (int k = 0; k < fc; ++k) {
                int vi = in.faceIndices[cOffset + k];
                if (vi >= 0 && static_cast<std::size_t>(vi) < numVerts) {
                    sum += in.positions[vi];
                }
            }
            facePoints[f] = sum * (1.0f / static_cast<float>(fc));
        }
        cOffset += std::max(0, fc);
    }

    // 2. Build undirected edge table
    struct EdgeRecord {
        std::uint32_t v0 = 0;
        std::uint32_t v1 = 0;
        int f0 = -1;
        int f1 = -1;
        int adjCount = 0;
    };
    auto makeEdgeKey = [](std::uint32_t a, std::uint32_t b) -> std::uint64_t {
        if (a > b) std::swap(a, b);
        return (static_cast<std::uint64_t>(a) << 32) | static_cast<std::uint64_t>(b);
    };

    std::unordered_map<std::uint64_t, std::uint32_t> edgeMap;
    edgeMap.reserve(cOffset);
    std::vector<EdgeRecord> edges;
    edges.reserve(cOffset / 2 + 8);
    std::vector<std::uint32_t> cornerEdgeIdx(cOffset, 0);

    std::vector<Abc::V3f> vertFaceSum(numVerts, Abc::V3f(0.0f, 0.0f, 0.0f));
    std::vector<int> vertFaceValence(numVerts, 0);

    for (std::size_t f = 0; f < numFaces; ++f) {
        int fc = in.faceCounts[f];
        std::size_t base = faceStart[f];
        for (int k = 0; k < fc; ++k) {
            std::uint32_t va = static_cast<std::uint32_t>(in.faceIndices[base + k]);
            std::uint32_t vb = static_cast<std::uint32_t>(in.faceIndices[base + ((k + 1) % fc)]);
            vertFaceSum[va] += facePoints[f];
            vertFaceValence[va] += 1;

            std::uint64_t key = makeEdgeKey(va, vb);
            auto it = edgeMap.find(key);
            std::uint32_t eIdx = 0;
            if (it == edgeMap.end()) {
                eIdx = static_cast<std::uint32_t>(edges.size());
                edgeMap.emplace(key, eIdx);
                EdgeRecord rec;
                rec.v0 = std::min(va, vb);
                rec.v1 = std::max(va, vb);
                rec.f0 = static_cast<int>(f);
                rec.adjCount = 1;
                edges.push_back(rec);
            } else {
                eIdx = it->second;
                EdgeRecord& rec = edges[eIdx];
                if (rec.adjCount == 1) rec.f1 = static_cast<int>(f);
                rec.adjCount += 1;
            }
            cornerEdgeIdx[base + k] = eIdx;
        }
    }

    // 3. Edge points and vertex boundary / midpoint accumulators
    std::size_t numEdges = edges.size();
    std::vector<Abc::V3f> edgePoints(numEdges);
    std::vector<Abc::V3f> vertEdgeMidSum(numVerts, Abc::V3f(0.0f, 0.0f, 0.0f));
    std::vector<int> vertEdgeValence(numVerts, 0);
    std::vector<Abc::V3f> vertBoundaryMidSum(numVerts, Abc::V3f(0.0f, 0.0f, 0.0f));
    std::vector<int> vertBoundaryEdgeCount(numVerts, 0);

    for (std::size_t e = 0; e < numEdges; ++e) {
        const EdgeRecord& rec = edges[e];
        Abc::V3f mid = (in.positions[rec.v0] + in.positions[rec.v1]) * 0.5f;
        if (bilinear || rec.adjCount != 2 || rec.f0 < 0 || rec.f1 < 0) {
            edgePoints[e] = mid;
        } else {
            edgePoints[e] = (in.positions[rec.v0] + in.positions[rec.v1] +
                             facePoints[rec.f0] + facePoints[rec.f1]) * 0.25f;
        }
        vertEdgeMidSum[rec.v0] += mid;
        vertEdgeMidSum[rec.v1] += mid;
        vertEdgeValence[rec.v0] += 1;
        vertEdgeValence[rec.v1] += 1;
        if (rec.adjCount == 1) {
            vertBoundaryMidSum[rec.v0] += mid;
            vertBoundaryMidSum[rec.v1] += mid;
            vertBoundaryEdgeCount[rec.v0] += 1;
            vertBoundaryEdgeCount[rec.v1] += 1;
        }
    }

    // 4. Assemble new vertex array: [updated original verts | face points | edge points]
    out.positions.resize(numVerts + numFaces + numEdges);
    for (std::size_t v = 0; v < numVerts; ++v) {
        if (bilinear || vertEdgeValence[v] == 0) {
            out.positions[v] = in.positions[v];
        } else if (vertBoundaryEdgeCount[v] > 0) {
            if (vertBoundaryEdgeCount[v] == 2) {
                // Standard Catmull-Clark crease/boundary rule: 3/4 * P + 1/8 * (M0 + M1) = 1/2 * P + 1/4 * (mid0 + mid1)
                out.positions[v] = in.positions[v] * 0.5f + vertBoundaryMidSum[v] * 0.25f;
            } else {
                out.positions[v] = in.positions[v];
            }
        } else {
            float n = static_cast<float>(vertEdgeValence[v]);
            Abc::V3f F = vertFaceSum[v] * (1.0f / std::max(1.0f, static_cast<float>(vertFaceValence[v])));
            Abc::V3f R = vertEdgeMidSum[v] * (1.0f / n);
            out.positions[v] = (F + R * 2.0f + in.positions[v] * (n - 3.0f)) * (1.0f / n);
        }
    }
    for (std::size_t f = 0; f < numFaces; ++f) {
        out.positions[numVerts + f] = facePoints[f];
    }
    for (std::size_t e = 0; e < numEdges; ++e) {
        out.positions[numVerts + numFaces + e] = edgePoints[e];
    }

    // 5. Split each N-gon into N quads (preserving CW winding order of input face!)
    const bool hasUV = (in.faceVaryingUVs.size() == cOffset);
    out.faceCounts.reserve(cOffset);
    out.faceIndices.reserve(cOffset * 4);
    if (hasUV) out.faceVaryingUVs.reserve(cOffset * 4);
    if (!in.faceGroups.empty()) out.faceGroups.reserve(cOffset);

    for (std::size_t f = 0; f < numFaces; ++f) {
        int fc = in.faceCounts[f];
        if (fc < 3) continue;
        std::size_t base = faceStart[f];
        std::int32_t fPtIdx = static_cast<std::int32_t>(numVerts + f);

        Abc::V2f uvCenter(0.0f, 0.0f);
        if (hasUV) {
            for (int k = 0; k < fc; ++k) uvCenter += in.faceVaryingUVs[base + k];
            uvCenter *= (1.0f / static_cast<float>(fc));
        }

        for (int k = 0; k < fc; ++k) {
            int prevK = (k + fc - 1) % fc;
            std::int32_t vCorner = in.faceIndices[base + k];
            std::int32_t eNextIdx = static_cast<std::int32_t>(numVerts + numFaces + cornerEdgeIdx[base + k]);
            std::int32_t ePrevIdx = static_cast<std::int32_t>(numVerts + numFaces + cornerEdgeIdx[base + prevK]);

            out.faceCounts.push_back(4);
            out.faceIndices.push_back(vCorner);
            out.faceIndices.push_back(eNextIdx);
            out.faceIndices.push_back(fPtIdx);
            out.faceIndices.push_back(ePrevIdx);

            if (hasUV) {
                const Abc::V2f& uvCur = in.faceVaryingUVs[base + k];
                const Abc::V2f& uvNext = in.faceVaryingUVs[base + ((k + 1) % fc)];
                const Abc::V2f& uvPrev = in.faceVaryingUVs[base + prevK];
                out.faceVaryingUVs.push_back(uvCur);
                out.faceVaryingUVs.push_back((uvCur + uvNext) * 0.5f);
                out.faceVaryingUVs.push_back(uvCenter);
                out.faceVaryingUVs.push_back((uvPrev + uvCur) * 0.5f);
            }
            if (!in.faceGroups.empty() && f < in.faceGroups.size()) {
                out.faceGroups.push_back(in.faceGroups[f]);
            }
        }
    }

    return out;
}

} // namespace

std::shared_ptr<RenderMeshBuffer> buildSubDRenderBuffer(
    const AbcG::ISubDSchema& schema,
    int selectorMode,
    double selectorValue,
    int subdLevel,
    bool reverseWinding
) {
    if (!schema.valid() || schema.getNumSamples() == 0) {
        return std::make_shared<RenderMeshBuffer>();
    }
    Abc::ISampleSelector sel = makeSampleSelector(selectorMode, selectorValue);
    AbcG::ISubDSchema::Sample samp;
    schema.get(samp, sel);

    Abc::P3fArraySamplePtr posPtr = samp.getPositions();
    Abc::Int32ArraySamplePtr faceCountsPtr = samp.getFaceCounts();
    Abc::Int32ArraySamplePtr faceIndicesPtr = samp.getFaceIndices();
    if (!posPtr || !faceCountsPtr || !faceIndicesPtr) {
        return std::make_shared<RenderMeshBuffer>();
    }

    Abc::V2fArraySamplePtr uvVals;
    AbcG::GeometryScope uvScope = AbcG::kUnknownScope;
    if (schema.getUVsParam().valid() && schema.getUVsParam().getNumSamples() > 0) {
        AbcG::IV2fGeomParam::Sample uvSamp;
        schema.getUVsParam().getExpanded(uvSamp, sel);
        uvVals = uvSamp.getVals();
        uvScope = uvSamp.getScope();
    }

    ScopedColorData colors = extractColorParam(schema.getArbGeomParams(), sel);
    FaceGroupMapping faceGroups = buildFaceGroupMapping(schema, faceCountsPtr->size(), sel);

    int level = std::clamp(subdLevel, 0, 3);
    if (level == 0) {
        std::vector<std::uint32_t> posRemap;
        return weldMeshCore(
            posPtr->get(), posPtr->size(),
            nullptr, 0, 0.0,
            faceCountsPtr->get(), faceCountsPtr->size(),
            faceIndicesPtr->get(), faceIndicesPtr->size(),
            uvVals ? uvVals->get() : nullptr, uvVals ? uvVals->size() : 0, uvScope,
            nullptr, 0, AbcG::kUnknownScope,
            colors,
            faceGroups,
            reverseWinding,
            false,
            &posRemap,
            nullptr
        );
    }

    // Prepare SubDMeshState (filtering out hole faces if authored!)
    std::vector<bool> isHole(faceCountsPtr->size(), false);
    if (Abc::Int32ArraySamplePtr holes = samp.getHoles()) {
        for (std::size_t i = 0; i < holes->size(); ++i) {
            std::int32_t h = (*holes)[i];
            if (h >= 0 && static_cast<std::size_t>(h) < isHole.size()) {
                isHole[h] = true;
            }
        }
    }

    SubDMeshState state;
    state.positions.assign(posPtr->get(), posPtr->get() + posPtr->size());

    std::size_t cornerCursor = 0;
    for (std::size_t f = 0; f < faceCountsPtr->size(); ++f) {
        int fc = (*faceCountsPtr)[f];
        if (!isHole[f] && fc >= 3 && cornerCursor + static_cast<std::size_t>(fc) <= faceIndicesPtr->size()) {
            state.faceCounts.push_back(fc);
            for (int k = 0; k < fc; ++k) {
                std::int32_t vi = (*faceIndicesPtr)[cornerCursor + k];
                state.faceIndices.push_back(vi);
                if (uvVals && uvVals->size() > 0) {
                    std::size_t uIdx = resolveScopeIndex(
                        uvScope,
                        vi >= 0 ? static_cast<std::size_t>(vi) : 0,
                        cornerCursor + k,
                        f,
                        uvVals->size()
                    );
                    state.faceVaryingUVs.push_back((*uvVals)[uIdx]);
                }
            }
            if (!faceGroups.faceToGroup.empty() && f < faceGroups.faceToGroup.size()) {
                state.faceGroups.push_back(faceGroups.faceToGroup[f]);
            }
        }
        cornerCursor += std::max(0, fc);
    }

    bool bilinear = (samp.getSubdivisionScheme() == "bilinear");
    for (int lv = 0; lv < level; ++lv) {
        state = subdivideOnce(state, bilinear);
    }

    FaceGroupMapping subdGroups;
    subdGroups.groupNames = faceGroups.groupNames;
    subdGroups.faceToGroup = std::move(state.faceGroups);

    ScopedColorData noSubdColors; // Color interpolation skipped on subdivided topology unless constant
    if (colors.valid && colors.scope == AbcG::kConstantScope) {
        noSubdColors = colors;
    }

    std::vector<std::uint32_t> posRemap;
    return weldMeshCore(
        state.positions.data(), state.positions.size(),
        nullptr, 0, 0.0,
        state.faceCounts.data(), state.faceCounts.size(),
        state.faceIndices.data(), state.faceIndices.size(),
        state.faceVaryingUVs.empty() ? nullptr : state.faceVaryingUVs.data(),
        state.faceVaryingUVs.size(),
        AbcG::kFacevaryingScope,
        nullptr, 0, AbcG::kUnknownScope,
        noSubdColors,
        subdGroups,
        reverseWinding,
        false,
        &posRemap,
        nullptr
    );
}

// ============================================================================
// IFaceSetWrap / OFaceSetWrap
// ============================================================================

IFaceSetWrap::IFaceSetWrap(const std::shared_ptr<IObjectWrap>& obj)
    : faceSet_(obj->raw(), Abc::kWrapExisting),
      schema_(faceSet_.getSchema()),
      keepAlive_(obj->keepAlive()) {}

IFaceSetWrap::IFaceSetWrap(AbcG::IFaceSet fs, ReaderKeepAlivePtr keepAlive)
    : faceSet_(std::move(fs)),
      schema_(faceSet_.getSchema()),
      keepAlive_(std::move(keepAlive)) {}

BufferViewDesc IFaceSetWrap::getFaces(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    AbcG::IFaceSetSchema::Sample samp;
    schema_.get(samp, makeSampleSelector(selectorMode, selectorValue));
    lastFaces_ = samp.getFaces();
    return makeBufferViewFromArraySample(lastFaces_);
}

Box3dDesc IFaceSetWrap::getSelfBounds(int selectorMode, double selectorValue) const {
    keepAlive_->ensureOpen();
    Abc::IBox3dProperty bp = schema_.getSelfBoundsProperty();
    if (!bp.valid() || bp.getNumSamples() == 0) return Box3dDesc{};
    return toBox3dDesc(bp.getValue(makeSampleSelector(selectorMode, selectorValue)));
}

std::shared_ptr<ICompoundWrap> IFaceSetWrap::getArbGeomParams() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getArbGeomParams();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

std::shared_ptr<ICompoundWrap> IFaceSetWrap::getUserProperties() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getUserProperties();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

OFaceSetWrap::OFaceSetWrap(
    AbcG::OFaceSet fs,
    std::shared_ptr<ArchiveWriterContext> writerCtx
) : faceSet_(std::move(fs)),
    schema_(faceSet_.getSchema()),
    writerCtx_(std::move(writerCtx)) {}

OFaceSetWrap::OFaceSetWrap(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) : writerCtx_(parent->writerCtx()) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    faceSet_ = AbcG::OFaceSet(parent->raw(), name, md, tsIndex);
    schema_ = faceSet_.getSchema();
}

void OFaceSetWrap::setFaces(std::uintptr_t facesInt32Ptr, std::size_t count) {
    writerCtx_->ensureWritable();
    std::vector<std::int32_t> sorted;
    if (count > 0 && facesInt32Ptr != 0) {
        const std::int32_t* src = reinterpret_cast<const std::int32_t*>(facesInt32Ptr);
        sorted.assign(src, src + count);
        std::sort(sorted.begin(), sorted.end());
        sorted.erase(std::unique(sorted.begin(), sorted.end()), sorted.end());
    }
    AbcG::OFaceSetSchema::Sample samp(
        Abc::Int32ArraySample(sorted.empty() ? nullptr : sorted.data(), sorted.size())
    );
    schema_.set(samp);
}

std::shared_ptr<OCompoundWrap> OFaceSetWrap::getArbGeomParams() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getArbGeomParams(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCompoundWrap> OFaceSetWrap::getUserProperties() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getUserProperties(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

// ============================================================================
// IPolyMeshWrap / OPolyMeshWrap
// ============================================================================

IPolyMeshWrap::IPolyMeshWrap(const std::shared_ptr<IObjectWrap>& obj)
    : mesh_(obj->raw(), Abc::kWrapExisting),
      schema_(mesh_.getSchema()),
      keepAlive_(obj->keepAlive()) {}

emscripten::val IPolyMeshWrap::getRawSample(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    AbcG::IPolyMeshSchema::Sample samp;
    schema_.get(samp, makeSampleSelector(selectorMode, selectorValue));
    lastPos_ = samp.getPositions();
    lastVel_ = samp.getVelocities();
    lastFaceIndices_ = samp.getFaceIndices();
    lastFaceCounts_ = samp.getFaceCounts();

    emscripten::val res = emscripten::val::object();
    res.set("positions", makeBufferViewFromArraySample(lastPos_));
    res.set("velocities", makeBufferViewFromArraySample(lastVel_));
    res.set("faceIndices", makeBufferViewFromArraySample(lastFaceIndices_));
    res.set("faceCounts", makeBufferViewFromArraySample(lastFaceCounts_));
    res.set("selfBounds", toBox3dDesc(samp.getSelfBounds()));
    return res;
}

Box3dDesc IPolyMeshWrap::getSelfBounds(int selectorMode, double selectorValue) const {
    keepAlive_->ensureOpen();
    Abc::IBox3dProperty bp = schema_.getSelfBoundsProperty();
    if (!bp.valid() || bp.getNumSamples() == 0) return Box3dDesc{};
    return toBox3dDesc(bp.getValue(makeSampleSelector(selectorMode, selectorValue)));
}

std::shared_ptr<GenericIGeomParam> IPolyMeshWrap::getUVsParam() const {
    keepAlive_->ensureOpen();
    if (!schema_.getUVsParam().valid()) return nullptr;
    return std::make_shared<GenericIGeomParam>(schema_, schema_.getUVsParam().getName(), keepAlive_);
}

std::shared_ptr<GenericIGeomParam> IPolyMeshWrap::getNormalsParam() const {
    keepAlive_->ensureOpen();
    if (!schema_.getNormalsParam().valid()) return nullptr;
    return std::make_shared<GenericIGeomParam>(schema_, schema_.getNormalsParam().getName(), keepAlive_);
}

emscripten::val IPolyMeshWrap::getFaceSetNames() const {
    keepAlive_->ensureOpen();
    std::vector<std::string> names;
    schema_.getFaceSetNames(names);
    emscripten::val arr = emscripten::val::array();
    for (std::size_t i = 0; i < names.size(); ++i) arr.set(i, names[i]);
    return arr;
}

bool IPolyMeshWrap::hasFaceSet(const std::string& name) const {
    keepAlive_->ensureOpen();
    return schema_.hasFaceSet(name);
}

std::shared_ptr<IFaceSetWrap> IPolyMeshWrap::getFaceSet(const std::string& name) const {
    keepAlive_->ensureOpen();
    if (!schema_.hasFaceSet(name)) return nullptr;
    return std::make_shared<IFaceSetWrap>(schema_.getFaceSet(name), keepAlive_);
}

std::shared_ptr<ICompoundWrap> IPolyMeshWrap::getArbGeomParams() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getArbGeomParams();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

std::shared_ptr<ICompoundWrap> IPolyMeshWrap::getUserProperties() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getUserProperties();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

OPolyMeshWrap::OPolyMeshWrap(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) : writerCtx_(parent->writerCtx()) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    mesh_ = AbcG::OPolyMesh(parent->raw(), name, md, tsIndex);
    schema_ = mesh_.getSchema();
}

void OPolyMeshWrap::setSample(
    std::uintptr_t posPtr, std::size_t posCount,
    std::uintptr_t faceIndicesPtr, std::size_t faceIndicesCount,
    std::uintptr_t faceCountsPtr, std::size_t faceCountsCount,
    std::uintptr_t velPtr, std::size_t velCount,
    std::uintptr_t uvsPtr, std::size_t uvsCount,
    std::uintptr_t uvIndicesPtr, std::size_t uvIndicesCount, int uvScope,
    std::uintptr_t normalsPtr, std::size_t normalsCount,
    std::uintptr_t normalIndicesPtr, std::size_t normalIndicesCount, int normalScope,
    const Box3dDesc& selfBounds
) {
    writerCtx_->ensureWritable();
    AbcG::OPolyMeshSchema::Sample samp;

    if (posCount > 0 && posPtr != 0) {
        samp.setPositions(Abc::P3fArraySample(reinterpret_cast<const Abc::V3f*>(posPtr), posCount));
    }
    if (faceIndicesCount > 0 && faceIndicesPtr != 0) {
        samp.setFaceIndices(Abc::Int32ArraySample(reinterpret_cast<const std::int32_t*>(faceIndicesPtr), faceIndicesCount));
    }
    if (faceCountsCount > 0 && faceCountsPtr != 0) {
        samp.setFaceCounts(Abc::Int32ArraySample(reinterpret_cast<const std::int32_t*>(faceCountsPtr), faceCountsCount));
    }
    if (velCount > 0 && velPtr != 0) {
        samp.setVelocities(Abc::V3fArraySample(reinterpret_cast<const Abc::V3f*>(velPtr), velCount));
    }
    if (uvsCount > 0 && uvsPtr != 0) {
        Abc::V2fArraySample uvValSamp(reinterpret_cast<const Abc::V2f*>(uvsPtr), uvsCount);
        if (uvIndicesCount > 0 && uvIndicesPtr != 0) {
            Abc::UInt32ArraySample uvIdxSamp(reinterpret_cast<const std::uint32_t*>(uvIndicesPtr), uvIndicesCount);
            samp.setUVs(AbcG::OV2fGeomParam::Sample(uvValSamp, uvIdxSamp, static_cast<AbcG::GeometryScope>(uvScope)));
        } else {
            samp.setUVs(AbcG::OV2fGeomParam::Sample(uvValSamp, static_cast<AbcG::GeometryScope>(uvScope)));
        }
    }
    if (normalsCount > 0 && normalsPtr != 0) {
        Abc::N3fArraySample nValSamp(reinterpret_cast<const Abc::N3f*>(normalsPtr), normalsCount);
        if (normalIndicesCount > 0 && normalIndicesPtr != 0) {
            Abc::UInt32ArraySample nIdxSamp(reinterpret_cast<const std::uint32_t*>(normalIndicesPtr), normalIndicesCount);
            samp.setNormals(AbcG::ON3fGeomParam::Sample(nValSamp, nIdxSamp, static_cast<AbcG::GeometryScope>(normalScope)));
        } else {
            samp.setNormals(AbcG::ON3fGeomParam::Sample(nValSamp, static_cast<AbcG::GeometryScope>(normalScope)));
        }
    }
    if (selfBounds.hasValue) {
        samp.setSelfBounds(fromBox3dDesc(selfBounds));
    }
    schema_.set(samp);
}

std::shared_ptr<OFaceSetWrap> OPolyMeshWrap::createFaceSet(const std::string& name) {
    writerCtx_->ensureWritable();
    AbcG::OFaceSet fs = schema_.createFaceSet(name);
    auto wrap = std::make_shared<OFaceSetWrap>(std::move(fs), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCompoundWrap> OPolyMeshWrap::getArbGeomParams() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getArbGeomParams(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCompoundWrap> OPolyMeshWrap::getUserProperties() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getUserProperties(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

// ============================================================================
// ISubDWrap / OSubDWrap
// ============================================================================

ISubDWrap::ISubDWrap(const std::shared_ptr<IObjectWrap>& obj)
    : subd_(obj->raw(), Abc::kWrapExisting),
      schema_(subd_.getSchema()),
      keepAlive_(obj->keepAlive()) {}

emscripten::val ISubDWrap::getRawSample(int selectorMode, double selectorValue) {
    keepAlive_->ensureOpen();
    schema_.get(lastSample_, makeSampleSelector(selectorMode, selectorValue));
    emscripten::val res = emscripten::val::object();
    res.set("positions", makeBufferViewFromArraySample(lastSample_.getPositions()));
    res.set("velocities", makeBufferViewFromArraySample(lastSample_.getVelocities()));
    res.set("faceIndices", makeBufferViewFromArraySample(lastSample_.getFaceIndices()));
    res.set("faceCounts", makeBufferViewFromArraySample(lastSample_.getFaceCounts()));
    res.set("subdivisionScheme", lastSample_.getSubdivisionScheme());
    res.set("creaseIndices", makeBufferViewFromArraySample(lastSample_.getCreaseIndices()));
    res.set("creaseLengths", makeBufferViewFromArraySample(lastSample_.getCreaseLengths()));
    res.set("creaseSharpnesses", makeBufferViewFromArraySample(lastSample_.getCreaseSharpnesses()));
    res.set("cornerIndices", makeBufferViewFromArraySample(lastSample_.getCornerIndices()));
    res.set("cornerSharpnesses", makeBufferViewFromArraySample(lastSample_.getCornerSharpnesses()));
    res.set("holes", makeBufferViewFromArraySample(lastSample_.getHoles()));
    res.set("interpolateBoundary", lastSample_.getInterpolateBoundary());
    res.set("faceVaryingInterpolateBoundary", lastSample_.getFaceVaryingInterpolateBoundary());
    res.set("faceVaryingPropagateCorners", lastSample_.getFaceVaryingPropagateCorners());
    res.set("selfBounds", toBox3dDesc(lastSample_.getSelfBounds()));
    return res;
}

std::shared_ptr<GenericIGeomParam> ISubDWrap::getUVsParam() const {
    keepAlive_->ensureOpen();
    if (!schema_.getUVsParam().valid()) return nullptr;
    return std::make_shared<GenericIGeomParam>(schema_, schema_.getUVsParam().getName(), keepAlive_);
}

emscripten::val ISubDWrap::getFaceSetNames() const {
    keepAlive_->ensureOpen();
    std::vector<std::string> names;
    schema_.getFaceSetNames(names);
    emscripten::val arr = emscripten::val::array();
    for (std::size_t i = 0; i < names.size(); ++i) arr.set(i, names[i]);
    return arr;
}

std::shared_ptr<IFaceSetWrap> ISubDWrap::getFaceSet(const std::string& name) const {
    keepAlive_->ensureOpen();
    if (!schema_.hasFaceSet(name)) return nullptr;
    return std::make_shared<IFaceSetWrap>(schema_.getFaceSet(name), keepAlive_);
}

std::shared_ptr<ICompoundWrap> ISubDWrap::getArbGeomParams() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getArbGeomParams();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

std::shared_ptr<ICompoundWrap> ISubDWrap::getUserProperties() const {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getUserProperties();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

OSubDWrap::OSubDWrap(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) : writerCtx_(parent->writerCtx()) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    subd_ = AbcG::OSubD(parent->raw(), name, md, tsIndex);
    schema_ = subd_.getSchema();
}

void OSubDWrap::setSample(
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
) {
    writerCtx_->ensureWritable();
    AbcG::OSubDSchema::Sample samp;

    if (posCount > 0 && posPtr != 0) {
        samp.setPositions(Abc::P3fArraySample(reinterpret_cast<const Abc::V3f*>(posPtr), posCount));
    }
    if (faceIndicesCount > 0 && faceIndicesPtr != 0) {
        samp.setFaceIndices(Abc::Int32ArraySample(reinterpret_cast<const std::int32_t*>(faceIndicesPtr), faceIndicesCount));
    }
    if (faceCountsCount > 0 && faceCountsPtr != 0) {
        samp.setFaceCounts(Abc::Int32ArraySample(reinterpret_cast<const std::int32_t*>(faceCountsPtr), faceCountsCount));
    }
    if (!scheme.empty()) {
        samp.setSubdivisionScheme(scheme);
    }
    if (creaseIndicesCount > 0 && creaseIndicesPtr != 0) {
        samp.setCreaseIndices(Abc::Int32ArraySample(reinterpret_cast<const std::int32_t*>(creaseIndicesPtr), creaseIndicesCount));
    }
    if (creaseLengthsCount > 0 && creaseLengthsPtr != 0) {
        samp.setCreaseLengths(Abc::Int32ArraySample(reinterpret_cast<const std::int32_t*>(creaseLengthsPtr), creaseLengthsCount));
    }
    if (creaseSharpnessesCount > 0 && creaseSharpnessesPtr != 0) {
        samp.setCreaseSharpnesses(Abc::FloatArraySample(reinterpret_cast<const float*>(creaseSharpnessesPtr), creaseSharpnessesCount));
    }
    if (cornerIndicesCount > 0 && cornerIndicesPtr != 0) {
        samp.setCornerIndices(Abc::Int32ArraySample(reinterpret_cast<const std::int32_t*>(cornerIndicesPtr), cornerIndicesCount));
    }
    if (cornerSharpnessesCount > 0 && cornerSharpnessesPtr != 0) {
        samp.setCornerSharpnesses(Abc::FloatArraySample(reinterpret_cast<const float*>(cornerSharpnessesPtr), cornerSharpnessesCount));
    }
    if (holesCount > 0 && holesPtr != 0) {
        samp.setHoles(Abc::Int32ArraySample(reinterpret_cast<const std::int32_t*>(holesPtr), holesCount));
    }
    if (interpolateBoundary >= 0) {
        samp.setInterpolateBoundary(interpolateBoundary);
    }
    if (faceVaryingInterpolateBoundary >= 0) {
        samp.setFaceVaryingInterpolateBoundary(faceVaryingInterpolateBoundary);
    }
    if (faceVaryingPropagateCorners >= 0) {
        samp.setFaceVaryingPropagateCorners(faceVaryingPropagateCorners);
    }
    if (velCount > 0 && velPtr != 0) {
        samp.setVelocities(Abc::V3fArraySample(reinterpret_cast<const Abc::V3f*>(velPtr), velCount));
    }
    if (uvsCount > 0 && uvsPtr != 0) {
        Abc::V2fArraySample uvValSamp(reinterpret_cast<const Abc::V2f*>(uvsPtr), uvsCount);
        if (uvIndicesCount > 0 && uvIndicesPtr != 0) {
            Abc::UInt32ArraySample uvIdxSamp(reinterpret_cast<const std::uint32_t*>(uvIndicesPtr), uvIndicesCount);
            samp.setUVs(AbcG::OV2fGeomParam::Sample(uvValSamp, uvIdxSamp, static_cast<AbcG::GeometryScope>(uvScope)));
        } else {
            samp.setUVs(AbcG::OV2fGeomParam::Sample(uvValSamp, static_cast<AbcG::GeometryScope>(uvScope)));
        }
    }
    schema_.set(samp);
}

std::shared_ptr<OFaceSetWrap> OSubDWrap::createFaceSet(const std::string& name) {
    writerCtx_->ensureWritable();
    AbcG::OFaceSet fs = schema_.createFaceSet(name);
    auto wrap = std::make_shared<OFaceSetWrap>(std::move(fs), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCompoundWrap> OSubDWrap::getArbGeomParams() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getArbGeomParams(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCompoundWrap> OSubDWrap::getUserProperties() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getUserProperties(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

namespace {

std::shared_ptr<OFaceSetWrap> createOFaceSet(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    auto wrap = std::make_shared<OFaceSetWrap>(parent, name, tsIndex, metaObj);
    parent->writerCtx()->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OPolyMeshWrap> createOPolyMesh(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    auto wrap = std::make_shared<OPolyMeshWrap>(parent, name, tsIndex, metaObj);
    parent->writerCtx()->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OSubDWrap> createOSubD(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    std::uint32_t tsIndex,
    const emscripten::val& metaObj
) {
    auto wrap = std::make_shared<OSubDWrap>(parent, name, tsIndex, metaObj);
    parent->writerCtx()->registerHandle(wrap);
    return wrap;
}

} // namespace

EMSCRIPTEN_BINDINGS(abc_wasm_geom_meshes) {
    using namespace emscripten;

    class_<RenderMeshBuffer>("RenderMeshBuffer")
        .smart_ptr<std::shared_ptr<RenderMeshBuffer>>("RenderMeshBuffer")
        .function("getPositionsView", &RenderMeshBuffer::getPositionsView)
        .function("getNormalsView", &RenderMeshBuffer::getNormalsView)
        .function("getUVsView", &RenderMeshBuffer::getUVsView)
        .function("getColorsView", &RenderMeshBuffer::getColorsView)
        .function("getIndicesView", &RenderMeshBuffer::getIndicesView)
        .function("getVertexCount", &RenderMeshBuffer::getVertexCount)
        .function("getIndexCount", &RenderMeshBuffer::getIndexCount)
        .function("getGroups", &RenderMeshBuffer::getGroups)
        .function("getBounds", &RenderMeshBuffer::getBounds)
        .property("hasNormals", &RenderMeshBuffer::hasNormals)
        .property("hasUVs", &RenderMeshBuffer::hasUVs)
        .property("hasColors", &RenderMeshBuffer::hasColors);

    class_<HomogeneousMeshPlan>("HomogeneousMeshPlan")
        .smart_ptr<std::shared_ptr<HomogeneousMeshPlan>>("HomogeneousMeshPlan")
        .function("getInitialBuffer", &HomogeneousMeshPlan::getInitialBuffer)
        .function("evaluateAtTime", &HomogeneousMeshPlan::evaluateAtTime)
        .function("getPositionsView", &HomogeneousMeshPlan::getPositionsView)
        .function("getNormalsView", &HomogeneousMeshPlan::getNormalsView);

    class_<IFaceSetWrap>("IFaceSetWrap")
        .smart_ptr_constructor("IFaceSetWrap", &std::make_shared<IFaceSetWrap, const std::shared_ptr<IObjectWrap>&>)
        .function("valid", &IFaceSetWrap::valid)
        .function("getName", &IFaceSetWrap::getName)
        .function("getFullName", &IFaceSetWrap::getFullName)
        .function("getNumSamples", &IFaceSetWrap::getNumSamples)
        .function("isConstant", &IFaceSetWrap::isConstant)
        .function("getFaceExclusivity", &IFaceSetWrap::getFaceExclusivity)
        .function("getTimeSamplingIndex", &IFaceSetWrap::getTimeSamplingIndex)
        .function("getFaces", &IFaceSetWrap::getFaces)
        .function("getSelfBounds", &IFaceSetWrap::getSelfBounds)
        .function("getArbGeomParams", &IFaceSetWrap::getArbGeomParams)
        .function("getUserProperties", &IFaceSetWrap::getUserProperties)
        .function("getObject", &IFaceSetWrap::getObject);

    class_<OFaceSetWrap>("OFaceSetWrap")
        .smart_ptr<std::shared_ptr<OFaceSetWrap>>("OFaceSetWrap")
        .function("getObject", &OFaceSetWrap::getObject)
        .function("getNumSamples", &OFaceSetWrap::getNumSamples)
        .function("setFaces", &OFaceSetWrap::setFaces)
        .function("setFaceExclusivity", &OFaceSetWrap::setFaceExclusivity)
        .function("getFaceExclusivity", &OFaceSetWrap::getFaceExclusivity)
        .function("setTimeSampling", &OFaceSetWrap::setTimeSampling)
        .function("getArbGeomParams", &OFaceSetWrap::getArbGeomParams)
        .function("getUserProperties", &OFaceSetWrap::getUserProperties);

    class_<IPolyMeshWrap>("IPolyMeshWrap")
        .smart_ptr_constructor("IPolyMeshWrap", &std::make_shared<IPolyMeshWrap, const std::shared_ptr<IObjectWrap>&>)
        .function("valid", &IPolyMeshWrap::valid)
        .function("getNumSamples", &IPolyMeshWrap::getNumSamples)
        .function("isConstant", &IPolyMeshWrap::isConstant)
        .function("getTopologyVariance", &IPolyMeshWrap::getTopologyVariance)
        .function("getTimeSamplingIndex", &IPolyMeshWrap::getTimeSamplingIndex)
        .function("getRawSample", &IPolyMeshWrap::getRawSample)
        .function("getSelfBounds", &IPolyMeshWrap::getSelfBounds)
        .function("getUVsParam", &IPolyMeshWrap::getUVsParam)
        .function("getNormalsParam", &IPolyMeshWrap::getNormalsParam)
        .function("getFaceSetNames", &IPolyMeshWrap::getFaceSetNames)
        .function("hasFaceSet", &IPolyMeshWrap::hasFaceSet)
        .function("getFaceSet", &IPolyMeshWrap::getFaceSet)
        .function("getArbGeomParams", &IPolyMeshWrap::getArbGeomParams)
        .function("getUserProperties", &IPolyMeshWrap::getUserProperties)
        .function("buildRenderBuffer", &IPolyMeshWrap::buildRenderBuffer)
        .function("createHomogeneousPlan", &IPolyMeshWrap::createHomogeneousPlan);

    class_<OPolyMeshWrap>("OPolyMeshWrap")
        .smart_ptr<std::shared_ptr<OPolyMeshWrap>>("OPolyMeshWrap")
        .function("getObject", &OPolyMeshWrap::getObject)
        .function("getNumSamples", &OPolyMeshWrap::getNumSamples)
        .function("setSample", &OPolyMeshWrap::setSample)
        .function("setFromPrevious", &OPolyMeshWrap::setFromPrevious)
        .function("setTimeSampling", &OPolyMeshWrap::setTimeSampling)
        .function("setUVSourceName", &OPolyMeshWrap::setUVSourceName)
        .function("createFaceSet", &OPolyMeshWrap::createFaceSet)
        .function("getArbGeomParams", &OPolyMeshWrap::getArbGeomParams)
        .function("getUserProperties", &OPolyMeshWrap::getUserProperties);

    class_<ISubDWrap>("ISubDWrap")
        .smart_ptr_constructor("ISubDWrap", &std::make_shared<ISubDWrap, const std::shared_ptr<IObjectWrap>&>)
        .function("valid", &ISubDWrap::valid)
        .function("getNumSamples", &ISubDWrap::getNumSamples)
        .function("isConstant", &ISubDWrap::isConstant)
        .function("getTopologyVariance", &ISubDWrap::getTopologyVariance)
        .function("getTimeSamplingIndex", &ISubDWrap::getTimeSamplingIndex)
        .function("getRawSample", &ISubDWrap::getRawSample)
        .function("getUVsParam", &ISubDWrap::getUVsParam)
        .function("getFaceSetNames", &ISubDWrap::getFaceSetNames)
        .function("getFaceSet", &ISubDWrap::getFaceSet)
        .function("getArbGeomParams", &ISubDWrap::getArbGeomParams)
        .function("getUserProperties", &ISubDWrap::getUserProperties)
        .function("buildRenderBuffer", &ISubDWrap::buildRenderBuffer);

    class_<OSubDWrap>("OSubDWrap")
        .smart_ptr<std::shared_ptr<OSubDWrap>>("OSubDWrap")
        .function("getObject", &OSubDWrap::getObject)
        .function("getNumSamples", &OSubDWrap::getNumSamples)
        .function("setSample", &OSubDWrap::setSample)
        .function("setFromPrevious", &OSubDWrap::setFromPrevious)
        .function("setTimeSampling", &OSubDWrap::setTimeSampling)
        .function("createFaceSet", &OSubDWrap::createFaceSet)
        .function("getArbGeomParams", &OSubDWrap::getArbGeomParams)
        .function("getUserProperties", &OSubDWrap::getUserProperties);

    function("createOFaceSet", &createOFaceSet);
    function("createOPolyMesh", &createOPolyMesh);
    function("createOSubD", &createOSubD);
}

} // namespace abc_wasm
