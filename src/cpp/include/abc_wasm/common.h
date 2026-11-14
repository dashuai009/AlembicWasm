#pragma once

#ifndef _MSC_VER
#include <pthread.h>
#endif

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <Alembic/Abc/All.h>
#include <Alembic/Abc/TypedPropertyTraits.h>
#include <Alembic/AbcCollection/All.h>
#include <Alembic/AbcCoreAbstract/All.h>
#include <Alembic/AbcCoreFactory/All.h>
#include <Alembic/AbcCoreLayer/Read.h>
#include <Alembic/AbcCoreLayer/Util.h>
#include <Alembic/AbcCoreOgawa/All.h>
#include <Alembic/AbcGeom/All.h>
#include <Alembic/AbcGeom/ArchiveBounds.h>
#include <Alembic/AbcGeom/Visibility.h>
#include <Alembic/AbcMaterial/All.h>
#include <Alembic/AbcMaterial/MaterialAssignment.h>
#include <Alembic/AbcMaterial/MaterialFlatten.h>
#include <Alembic/Util/All.h>

#include <Imath/half.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <ctime>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

namespace abc_wasm {

namespace Abc = ::Alembic::Abc;
namespace AbcA = ::Alembic::AbcCoreAbstract;
namespace AbcF = ::Alembic::AbcCoreFactory;
namespace AbcG = ::Alembic::AbcGeom;
namespace AbcL = ::Alembic::AbcCoreLayer;
namespace AbcM = ::Alembic::AbcMaterial;
namespace AbcC = ::Alembic::AbcCollection;
namespace AbcO = ::Alembic::AbcCoreOgawa;
namespace AbcU = ::Alembic::Util;

struct BufferViewDesc {
    std::uintptr_t ptr = 0;
    std::size_t length = 0;   // Number of tuples (or scalar elements when extent == 1)
    int pod = static_cast<int>(AbcU::kUnknownPOD);
    int extent = 1;
    std::size_t byteLength = 0;
};

struct Box3dDesc {
    bool hasValue = false;
    double minX = 0.0;
    double minY = 0.0;
    double minZ = 0.0;
    double maxX = 0.0;
    double maxY = 0.0;
    double maxZ = 0.0;
};

inline Box3dDesc toBox3dDesc(const Abc::Box3d& box) {
    Box3dDesc d;
    if (!box.isEmpty()) {
        d.hasValue = true;
        d.minX = box.min.x;
        d.minY = box.min.y;
        d.minZ = box.min.z;
        d.maxX = box.max.x;
        d.maxY = box.max.y;
        d.maxZ = box.max.z;
    }
    return d;
}

inline Abc::Box3d fromBox3dDesc(const Box3dDesc& d) {
    Abc::Box3d b;
    if (d.hasValue) {
        b.min = Abc::V3d(d.minX, d.minY, d.minZ);
        b.max = Abc::V3d(d.maxX, d.maxY, d.maxZ);
    } else {
        b.makeEmpty();
    }
    return b;
}

/**
 * Selector mode:
 *   0 -> index (static_cast<Abc::index_t>(value))
 *   1 -> floor time
 *   2 -> ceil time
 *   3 -> near time
 */
inline Abc::ISampleSelector makeSampleSelector(int mode, double value) {
    switch (mode) {
        case 1:
            return Abc::ISampleSelector(value, Abc::ISampleSelector::kFloorIndex);
        case 2:
            return Abc::ISampleSelector(value, Abc::ISampleSelector::kCeilIndex);
        case 3:
            return Abc::ISampleSelector(value, Abc::ISampleSelector::kNearIndex);
        case 0:
        default:
            return Abc::ISampleSelector(static_cast<Abc::index_t>(std::llround(value)));
    }
}

inline emscripten::val metaDataToVal(const AbcA::MetaData& md) {
    emscripten::val obj = emscripten::val::object();
    for (auto it = md.begin(); it != md.end(); ++it) {
        obj.set(it->first, it->second);
    }
    return obj;
}

inline AbcA::MetaData valToMetaData(const emscripten::val& obj) {
    AbcA::MetaData md;
    if (obj.isUndefined() || obj.isNull()) {
        return md;
    }
    emscripten::val keys = emscripten::val::global("Object").call<emscripten::val>("keys", obj);
    int len = keys["length"].as<int>();
    for (int i = 0; i < len; ++i) {
        std::string k = keys[i].as<std::string>();
        emscripten::val v = obj[k];
        if (!v.isUndefined() && !v.isNull()) {
            md.set(k, v.as<std::string>());
        }
    }
    return md;
}

inline std::size_t podByteSize(AbcU::PlainOldDataType pod) {
    return AbcU::PODNumBytes(pod);
}

inline BufferViewDesc makeBufferViewFromArraySample(const AbcA::ArraySamplePtr& samp) {
    BufferViewDesc desc;
    if (!samp || samp->size() == 0 || samp->getData() == nullptr) {
        if (samp) {
            desc.pod = static_cast<int>(samp->getDataType().getPod());
            desc.extent = static_cast<int>(samp->getDataType().getExtent());
        }
        return desc;
    }
    const AbcA::DataType& dt = samp->getDataType();
    desc.ptr = reinterpret_cast<std::uintptr_t>(samp->getData());
    desc.length = samp->size();
    desc.pod = static_cast<int>(dt.getPod());
    desc.extent = static_cast<int>(dt.getExtent());
    desc.byteLength = samp->size() * dt.getNumBytes();
    return desc;
}

class ResettableWriterHandle {
public:
    virtual ~ResettableWriterHandle() = default;
    virtual void resetNative() = 0;
};

struct ReaderKeepAlive {
    bool closed = false;
    void ensureOpen() const {
        if (closed) {
            throw std::runtime_error("Archive has been closed.");
        }
    }
    virtual ~ReaderKeepAlive() = default;
};

using ReaderKeepAlivePtr = std::shared_ptr<ReaderKeepAlive>;

} // namespace abc_wasm
