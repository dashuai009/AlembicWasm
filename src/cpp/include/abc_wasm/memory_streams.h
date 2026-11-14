#pragma once

#include "abc_wasm/common.h"

namespace abc_wasm {

/**
 * Zero-double-copy random-access std::streambuf backed by a contiguous byte vector.
 */
class MemoryReadStreamBuf final : public std::streambuf {
public:
    MemoryReadStreamBuf() {
        setg(nullptr, nullptr, nullptr);
    }

    void resetBuffer(const std::uint8_t* data, std::size_t size) {
        if (data && size > 0) {
            char* begin = reinterpret_cast<char*>(const_cast<std::uint8_t*>(data));
            setg(begin, begin, begin + size);
        } else {
            setg(nullptr, nullptr, nullptr);
        }
    }

protected:
    pos_type seekoff(off_type off, std::ios_base::seekdir dir,
                     std::ios_base::openmode which) override {
        if (!(which & std::ios_base::in)) {
            return pos_type(off_type(-1));
        }
        char* begin = eback();
        char* end = egptr();
        char* cur = gptr();
        if (!begin) {
            return off == 0 ? pos_type(0) : pos_type(off_type(-1));
        }

        off_type base = 0;
        if (dir == std::ios_base::beg) {
            base = 0;
        } else if (dir == std::ios_base::cur) {
            base = static_cast<off_type>(cur - begin);
        } else if (dir == std::ios_base::end) {
            base = static_cast<off_type>(end - begin);
        } else {
            return pos_type(off_type(-1));
        }

        off_type target = base + off;
        off_type total = static_cast<off_type>(end - begin);
        if (target < 0 || target > total) {
            return pos_type(off_type(-1));
        }
        setg(begin, begin + target, end);
        return pos_type(target);
    }

    pos_type seekpos(pos_type sp, std::ios_base::openmode which) override {
        return seekoff(off_type(sp), std::ios_base::beg, which);
    }

    std::streamsize showmanyc() override {
        return egptr() - gptr();
    }

    std::streamsize xsgetn(char* s, std::streamsize n) override {
        std::streamsize avail = egptr() - gptr();
        std::streamsize toRead = std::min(n, avail);
        if (toRead > 0) {
            std::memcpy(s, gptr(), static_cast<std::size_t>(toRead));
            gbump(static_cast<int>(toRead));
        }
        return toRead;
    }
};

/**
 * Seekable dynamically growing std::streambuf for writing Ogawa archives in memory.
 */
class VectorWriteStreamBuf final : public std::streambuf {
public:
    explicit VectorWriteStreamBuf(std::size_t initialReserve = 65536) {
        buffer_.reserve(initialReserve);
    }

    const std::vector<std::uint8_t>& buffer() const { return buffer_; }

    void clearMemory() {
        std::vector<std::uint8_t>().swap(buffer_);
        pos_ = 0;
    }

protected:
    int_type overflow(int_type ch) override {
        if (traits_type::eq_int_type(ch, traits_type::eof())) {
            return traits_type::not_eof(ch);
        }
        char c = traits_type::to_char_type(ch);
        xsputn(&c, 1);
        return ch;
    }

    std::streamsize xsputn(const char* s, std::streamsize n) override {
        if (n <= 0) {
            return 0;
        }
        std::size_t count = static_cast<std::size_t>(n);
        std::size_t endPos = pos_ + count;
        if (endPos > buffer_.size()) {
            if (endPos > buffer_.capacity()) {
                buffer_.reserve(std::max(endPos, buffer_.capacity() * 2 + 4096));
            }
            buffer_.resize(endPos, 0);
        }
        std::memcpy(buffer_.data() + pos_, s, count);
        pos_ = endPos;
        return n;
    }

    pos_type seekoff(off_type off, std::ios_base::seekdir dir,
                     std::ios_base::openmode which) override {
        if (!(which & std::ios_base::out)) {
            return pos_type(off_type(-1));
        }
        off_type base = 0;
        if (dir == std::ios_base::beg) {
            base = 0;
        } else if (dir == std::ios_base::cur) {
            base = static_cast<off_type>(pos_);
        } else if (dir == std::ios_base::end) {
            base = static_cast<off_type>(buffer_.size());
        } else {
            return pos_type(off_type(-1));
        }

        off_type target = base + off;
        if (target < 0) {
            return pos_type(off_type(-1));
        }
        std::size_t newPos = static_cast<std::size_t>(target);
        if (newPos > buffer_.size()) {
            buffer_.resize(newPos, 0);
        }
        pos_ = newPos;
        return pos_type(target);
    }

    pos_type seekpos(pos_type sp, std::ios_base::openmode which) override {
        return seekoff(off_type(sp), std::ios_base::beg, which);
    }

private:
    std::vector<std::uint8_t> buffer_;
    std::size_t pos_ = 0;
};

/**
 * Owns the byte buffer, istream, and IArchive together.
 */
class ArchiveReaderContext final
    : public ReaderKeepAlive,
      public std::enable_shared_from_this<ArchiveReaderContext> {
public:
    explicit ArchiveReaderContext(std::size_t byteLength)
        : buffer_(byteLength), stream_(&streamBuf_) {
        streamBuf_.resetBuffer(buffer_.data(), buffer_.size());
    }

    ~ArchiveReaderContext() override {
        close();
    }

    std::uintptr_t dataPtr() {
        return buffer_.empty() ? 0 : reinterpret_cast<std::uintptr_t>(buffer_.data());
    }

    std::size_t byteLength() const {
        return buffer_.size();
    }

    void open() {
        if (closed) {
            throw std::runtime_error("Cannot re-open a closed ArchiveReaderContext.");
        }
        if (buffer_.empty()) {
            throw std::runtime_error("Cannot open Alembic archive from empty buffer.");
        }
        streamBuf_.resetBuffer(buffer_.data(), buffer_.size());
        stream_.clear();
        stream_.seekg(0, std::ios::beg);

        // Check HDF5 magic signature (\x89HDF\r\n\x1a\n) to give a crystal-clear message
        if (buffer_.size() >= 8 &&
            buffer_[0] == 0x89 && buffer_[1] == 'H' &&
            buffer_[2] == 'D' && buffer_[3] == 'F') {
            coreType_ = "HDF5";
            throw std::runtime_error(
                "UnsupportedCoreType: Legacy HDF5 Alembic archive detected. "
                "alembic-wasm supports Ogawa archives (standard since Alembic 1.5)."
            );
        }

        std::vector<std::istream*> streams{&stream_};
        AbcF::IFactory factory;
        factory.setPolicy(Abc::ErrorHandler::kThrowPolicy);

        AbcF::IFactory::CoreType ct = AbcF::IFactory::kUnknown;
        archive_ = factory.getArchive(streams, ct);

        if (!archive_.valid() || ct == AbcF::IFactory::kUnknown) {
            throw std::runtime_error("Invalid or unrecognized Alembic archive data.");
        }
        coreType_ = (ct == AbcF::IFactory::kOgawa) ? "Ogawa"
                  : (ct == AbcF::IFactory::kLayer) ? "Layer"
                  : "HDF5";
    }

    void close() {
        if (!closed) {
            closed = true;
            archive_.reset();
            streamBuf_.resetBuffer(nullptr, 0);
            std::vector<std::uint8_t>().swap(buffer_);
        }
    }

    bool isClosed() const { return closed; }
    std::string getCoreType() const { return coreType_; }

    Abc::IArchive& archive() {
        ensureOpen();
        return archive_;
    }

private:
    std::vector<std::uint8_t> buffer_;
    MemoryReadStreamBuf streamBuf_;
    std::istream stream_;
    Abc::IArchive archive_;
    std::string coreType_ = "Unknown";
};

/**
 * Merges multiple ArchiveReaderContexts using AbcCoreLayer::ReadArchive.
 */
class LayeredArchiveContext final
    : public ReaderKeepAlive,
      public std::enable_shared_from_this<LayeredArchiveContext> {
public:
    explicit LayeredArchiveContext(const std::vector<std::shared_ptr<ArchiveReaderContext>>& layers)
        : layers_(layers) {
        if (layers_.empty()) {
            throw std::runtime_error("openLayeredArchive requires at least one archive layer.");
        }
        AbcL::ArchiveReaderPtrs ptrs;
        ptrs.reserve(layers_.size());
        // `layers` is ordered base -> override (layers[0] = base, layers.back() = strongest),
        // whereas AbcCoreLayer::ReadArchive iterates strongest -> weakest (matching IFactory).
        for (auto it = layers_.rbegin(); it != layers_.rend(); ++it) {
            auto& layer = *it;
            if (!layer || layer->isClosed()) {
                throw std::runtime_error("Layer archive is null or closed.");
            }
            ptrs.push_back(layer->archive().getPtr());
        }
        AbcL::ReadArchive layerReader;
        AbcA::ArchiveReaderPtr mergedPtr = layerReader(ptrs);
        if (!mergedPtr) {
            throw std::runtime_error("Failed to create layered Alembic archive.");
        }
        archive_ = Abc::IArchive(mergedPtr, Abc::kWrapExisting, Abc::ErrorHandler::kThrowPolicy);
    }

    ~LayeredArchiveContext() override {
        close();
    }

    void close() {
        if (!closed) {
            closed = true;
            archive_.reset();
            for (auto& l : layers_) {
                if (l) l->close();
            }
            layers_.clear();
        }
    }

    bool isClosed() const { return closed; }
    std::string getCoreType() const { return "Layer"; }

    Abc::IArchive& archive() {
        ensureOpen();
        return archive_;
    }

private:
    std::vector<std::shared_ptr<ArchiveReaderContext>> layers_;
    Abc::IArchive archive_;
};

/**
 * Unified read archive handle wrapping either a single ArchiveReaderContext or LayeredArchiveContext.
 */
class IArchiveWrap {
public:
    explicit IArchiveWrap(std::shared_ptr<ArchiveReaderContext> single)
        : keepAlive_(single), single_(std::move(single)) {}

    explicit IArchiveWrap(std::shared_ptr<LayeredArchiveContext> layered)
        : keepAlive_(layered), layered_(std::move(layered)) {}

    Abc::IArchive& archive() const {
        keepAlive_->ensureOpen();
        return single_ ? single_->archive() : layered_->archive();
    }

    ReaderKeepAlivePtr keepAlive() const { return keepAlive_; }

    std::string getCoreType() const {
        return single_ ? single_->getCoreType() : layered_->getCoreType();
    }

    void close() {
        if (single_) single_->close();
        if (layered_) layered_->close();
    }

    bool isClosed() const {
        return keepAlive_ ? keepAlive_->closed : true;
    }

    emscripten::val getInfo() const {
        Abc::IArchive& ar = archive();
        std::string appName;
        std::string libVersionStr;
        AbcU::uint32_t apiVersion = 0;
        std::string dateWritten;
        std::string description;
        double dccFps = 0.0;
        Abc::GetArchiveInfo(ar, appName, libVersionStr, apiVersion, dateWritten, description, dccFps);

        double startTime = 0.0;
        double endTime = 0.0;
        Abc::GetArchiveStartAndEndTime(ar, startTime, endTime);
        bool hasTimeRange = (startTime <= endTime) && (startTime < 1e300) && (endTime > -1e300);

        emscripten::val res = emscripten::val::object();
        res.set("appName", appName);
        res.set("libraryVersionString", libVersionStr);
        res.set("apiVersion", apiVersion);
        res.set("archiveVersion", ar.getArchiveVersion());
        res.set("dateWritten", dateWritten);
        res.set("userDescription", description);
        res.set("dccFps", dccFps);
        res.set("coreType", getCoreType());
        res.set("hasTimeRange", hasTimeRange);
        res.set("startTime", hasTimeRange ? startTime : 0.0);
        res.set("endTime", hasTimeRange ? endTime : 0.0);
        res.set("numTimeSamplings", static_cast<std::uint32_t>(ar.getNumTimeSamplings()));
        res.set("metaData", metaDataToVal(ar.getPtr()->getMetaData()));
        return res;
    }

    std::uint32_t getNumTimeSamplings() const {
        return static_cast<std::uint32_t>(archive().getNumTimeSamplings());
    }

    emscripten::val getTimeSamplingInfo(std::uint32_t index) const {
        Abc::IArchive& ar = archive();
        AbcA::TimeSamplingPtr ts = ar.getTimeSampling(index);
        if (!ts) {
            throw std::out_of_range("Invalid TimeSampling index.");
        }
        const AbcA::TimeSamplingType& tst = ts->getTimeSamplingType();
        emscripten::val obj = emscripten::val::object();
        obj.set("isUniform", tst.isUniform());
        obj.set("isCyclic", tst.isCyclic());
        obj.set("isAcyclic", tst.isAcyclic());
        obj.set("numSamplesPerCycle", static_cast<std::uint32_t>(tst.getNumSamplesPerCycle()));
        obj.set("timePerCycle", tst.getTimePerCycle());

        const std::vector<AbcA::chrono_t>& stored = ts->getStoredTimes();
        emscripten::val timesArr = emscripten::val::array();
        for (std::size_t i = 0; i < stored.size(); ++i) {
            timesArr.set(i, stored[i]);
        }
        obj.set("storedTimes", timesArr);
        Abc::index_t maxSamps = ar.getMaxNumSamplesForTimeSamplingIndex(index);
        obj.set("maxNumSamples", static_cast<int>(maxSamps < 0 ? 0 : maxSamps));
        return obj;
    }

    Box3dDesc getArchiveBounds(int selectorMode, double selectorValue) const {
        Abc::IArchive& ar = archive();
        Abc::IBox3dProperty boundsProp = AbcG::GetIArchiveBounds(ar, Abc::ErrorHandler::kQuietNoopPolicy);
        if (!boundsProp.valid() || boundsProp.getNumSamples() == 0) {
            return Box3dDesc{};
        }
        Abc::Box3d b = boundsProp.getValue(makeSampleSelector(selectorMode, selectorValue));
        return toBox3dDesc(b);
    }

    std::string echo() const;

private:
    ReaderKeepAlivePtr keepAlive_;
    std::shared_ptr<ArchiveReaderContext> single_;
    std::shared_ptr<LayeredArchiveContext> layered_;
};

/**
 * In-memory Ogawa writer context with deterministic handle teardown before footer read.
 */
class ArchiveWriterContext final : public std::enable_shared_from_this<ArchiveWriterContext> {
public:
    ArchiveWriterContext(
        const std::string& appName,
        const std::string& userDescription,
        double dccFps,
        const emscripten::val& extraMeta
    ) : ostream_(&streamBuf_) {
        AbcA::MetaData md = valToMetaData(extraMeta);
        if (!appName.empty()) {
            md.set(Abc::kApplicationNameKey, appName);
        }
        if (!userDescription.empty()) {
            md.set(Abc::kUserDescriptionKey, userDescription);
        }
        if (dccFps > 0.0) {
            md.set(Abc::kDCCFPSKey, std::to_string(dccFps));
        }

        std::time_t rawNow = std::time(nullptr);
        char dateBuf[128] = {0};
        if (struct std::tm* tmNow = std::gmtime(&rawNow)) {
            std::strftime(dateBuf, sizeof(dateBuf), "%Y-%m-%d %H:%M:%S UTC", tmNow);
            md.set(Abc::kDateWrittenKey, dateBuf);
        }

        AbcO::WriteArchive writeArchive;
        AbcA::ArchiveWriterPtr writerPtr = writeArchive(&ostream_, md);
        if (!writerPtr) {
            throw std::runtime_error("Failed to create in-memory Ogawa ArchiveWriter.");
        }
        archive_ = Abc::OArchive(writerPtr, Abc::kWrapExisting, Abc::ErrorHandler::kThrowPolicy);
    }

    ~ArchiveWriterContext() {
        dispose();
    }

    void ensureWritable() const {
        if (finalized_) {
            throw std::runtime_error("OArchive has already been finalized/closed.");
        }
    }

    Abc::OArchive& archive() {
        ensureWritable();
        return archive_;
    }

    void registerHandle(const std::shared_ptr<ResettableWriterHandle>& handle) {
        liveHandles_.push_back(handle);
    }

    std::uint32_t addTimeSampling(
        int kind, // 0 = uniform, 1 = cyclic, 2 = acyclic
        double timePerCycle,
        std::uintptr_t timesPtr,
        std::size_t timesCount
    ) {
        ensureWritable();
        std::vector<AbcA::chrono_t> times;
        if (timesPtr != 0 && timesCount > 0) {
            const double* src = reinterpret_cast<const double*>(timesPtr);
            times.assign(src, src + timesCount);
        }
        AbcA::TimeSampling ts;
        if (kind == 0) {
            double startTime = times.empty() ? 0.0 : times[0];
            ts = AbcA::TimeSampling(timePerCycle, startTime);
        } else if (kind == 1) {
            AbcA::TimeSamplingType tst(static_cast<AbcU::uint32_t>(times.size()), timePerCycle);
            ts = AbcA::TimeSampling(tst, times);
        } else {
            AbcA::TimeSamplingType tst(AbcA::TimeSamplingType::kAcyclic);
            ts = AbcA::TimeSampling(tst, times);
        }
        return archive_.addTimeSampling(ts);
    }

    void setArchiveBounds(const Box3dDesc& box, std::uint32_t tsIndex) {
        ensureWritable();
        if (!archiveBoundsProp_.valid()) {
            archiveBoundsProp_ = AbcG::CreateOArchiveBounds(archive_, tsIndex);
        }
        archiveBoundsProp_.set(fromBox3dDesc(box));
    }

    BufferViewDesc finalize() {
        if (!finalized_) {
            finalized_ = true;
            archiveBoundsProp_.reset();
            // Reset all registered child handles in reverse order so ~ArchiveWriter flushes Ogawa root!
            for (auto it = liveHandles_.rbegin(); it != liveHandles_.rend(); ++it) {
                if (auto h = it->lock()) {
                    h->resetNative();
                }
            }
            liveHandles_.clear();
            archive_.reset();
            ostream_.flush();
        }

        const auto& buf = streamBuf_.buffer();
        BufferViewDesc desc;
        desc.ptr = buf.empty() ? 0 : reinterpret_cast<std::uintptr_t>(buf.data());
        desc.length = buf.size();
        desc.pod = static_cast<int>(AbcU::kUint8POD);
        desc.extent = 1;
        desc.byteLength = buf.size();
        return desc;
    }

    void dispose() {
        if (!finalized_) {
            finalize();
        }
        streamBuf_.clearMemory();
    }

    bool isFinalized() const { return finalized_; }

private:
    VectorWriteStreamBuf streamBuf_;
    std::ostream ostream_;
    Abc::OArchive archive_;
    Abc::OBox3dProperty archiveBoundsProp_;
    std::vector<std::weak_ptr<ResettableWriterHandle>> liveHandles_;
    bool finalized_ = false;
};

} // namespace abc_wasm
