#include "abc_wasm/schemas.h"

namespace abc_wasm {

namespace {

emscripten::val stringVecToVal(const std::vector<std::string>& vec) {
    emscripten::val arr = emscripten::val::array();
    for (std::size_t i = 0; i < vec.size(); ++i) {
        arr.set(i, vec[i]);
    }
    return arr;
}

emscripten::val parameterEntriesToVal(
    const AbcM::MaterialFlatten::ParameterEntryVector& entries,
    const ReaderKeepAlivePtr& keepAlive
) {
    emscripten::val arr = emscripten::val::array();
    for (std::size_t i = 0; i < entries.size(); ++i) {
        const auto& e = entries[i];
        emscripten::val item = emscripten::val::object();
        item.set("name", e.name);
        item.set("parent", std::make_shared<ICompoundWrap>(e.parent, keepAlive));
        if (e.header) {
            int propType = e.header->isCompound() ? 0 : (e.header->isScalar() ? 1 : 2);
            item.set("propertyType", propType);
            item.set("pod", static_cast<int>(e.header->getDataType().getPod()));
            item.set("extent", static_cast<int>(e.header->getDataType().getExtent()));
            item.set("interpretation", e.header->getMetaData().get("interpretation"));
        }
        arr.set(i, item);
    }
    return arr;
}

} // namespace

// ============================================================================
// IMaterialWrap
// ============================================================================

IMaterialWrap::IMaterialWrap(const std::shared_ptr<IObjectWrap>& obj)
    : mat_(obj->raw(), Abc::kWrapExisting),
      schema_(mat_.getSchema()),
      keepAlive_(obj->keepAlive()) {}

IMaterialWrap::IMaterialWrap(AbcM::IMaterialSchema schema, ReaderKeepAlivePtr keepAlive)
    : schema_(std::move(schema)), keepAlive_(std::move(keepAlive)) {}

emscripten::val IMaterialWrap::getTargetNames() {
    keepAlive_->ensureOpen();
    std::vector<std::string> names;
    schema_.getTargetNames(names);
    return stringVecToVal(names);
}

emscripten::val IMaterialWrap::getShaderTypesForTarget(const std::string& target) {
    keepAlive_->ensureOpen();
    std::vector<std::string> types;
    schema_.getShaderTypesForTarget(target, types);
    return stringVecToVal(types);
}

std::string IMaterialWrap::getShader(const std::string& target, const std::string& shaderType) {
    keepAlive_->ensureOpen();
    std::string shaderName;
    if (schema_.getShader(target, shaderType, shaderName)) {
        return shaderName;
    }
    return "";
}

std::shared_ptr<ICompoundWrap> IMaterialWrap::getShaderParameters(
    const std::string& target,
    const std::string& shaderType
) {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getShaderParameters(target, shaderType);
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

emscripten::val IMaterialWrap::getNetworkNodeNames() {
    keepAlive_->ensureOpen();
    std::vector<std::string> names;
    schema_.getNetworkNodeNames(names);
    return stringVecToVal(names);
}

emscripten::val IMaterialWrap::getNetworkNodeInfo(const std::string& nodeName) {
    keepAlive_->ensureOpen();
    AbcM::IMaterialSchema::NetworkNode node = schema_.getNetworkNode(nodeName);
    if (!node.valid()) return emscripten::val::null();

    emscripten::val obj = emscripten::val::object();
    obj.set("name", node.getName());
    std::string target, nodeType;
    node.getTarget(target);
    node.getNodeType(nodeType);
    obj.set("target", target);
    obj.set("nodeType", nodeType);

    Abc::ICompoundProperty params = node.getParameters();
    obj.set("parameters", params.valid() ? std::make_shared<ICompoundWrap>(params, keepAlive_) : nullptr);

    emscripten::val conns = emscripten::val::array();
    std::size_t nConns = node.getNumConnections();
    for (std::size_t i = 0; i < nConns; ++i) {
        std::string inName, connNode, connOut;
        if (node.getConnection(i, inName, connNode, connOut)) {
            emscripten::val c = emscripten::val::object();
            c.set("inputName", inName);
            c.set("connectedNodeName", connNode);
            c.set("connectedOutputName", connOut);
            conns.set(i, c);
        }
    }
    obj.set("connections", conns);
    return obj;
}

emscripten::val IMaterialWrap::getNetworkTerminalTargetNames() {
    keepAlive_->ensureOpen();
    std::vector<std::string> names;
    schema_.getNetworkTerminalTargetNames(names);
    return stringVecToVal(names);
}

emscripten::val IMaterialWrap::getNetworkTerminalShaderTypesForTarget(const std::string& target) {
    keepAlive_->ensureOpen();
    std::vector<std::string> types;
    schema_.getNetworkTerminalShaderTypesForTarget(target, types);
    return stringVecToVal(types);
}

emscripten::val IMaterialWrap::getNetworkTerminal(const std::string& target, const std::string& shaderType) {
    keepAlive_->ensureOpen();
    std::string nodeName, outputName;
    if (!schema_.getNetworkTerminal(target, shaderType, nodeName, outputName)) {
        return emscripten::val::null();
    }
    emscripten::val obj = emscripten::val::object();
    obj.set("nodeName", nodeName);
    obj.set("outputName", outputName);
    return obj;
}

std::shared_ptr<ICompoundWrap> IMaterialWrap::getNetworkInterfaceParameters() {
    keepAlive_->ensureOpen();
    Abc::ICompoundProperty p = schema_.getNetworkInterfaceParameters();
    if (!p.valid()) return nullptr;
    return std::make_shared<ICompoundWrap>(p, keepAlive_);
}

emscripten::val IMaterialWrap::getNetworkInterfaceParameterMappings() {
    keepAlive_->ensureOpen();
    emscripten::val arr = emscripten::val::array();
    std::size_t n = schema_.getNumNetworkInterfaceParameterMappings();
    for (std::size_t i = 0; i < n; ++i) {
        std::string ifaceName, nodeName, paramName;
        if (schema_.getNetworkInterfaceParameterMapping(i, ifaceName, nodeName, paramName)) {
            emscripten::val m = emscripten::val::object();
            m.set("interfaceParamName", ifaceName);
            m.set("mapToNodeName", nodeName);
            m.set("mapToParamName", paramName);
            arr.set(i, m);
        }
    }
    return arr;
}

// ============================================================================
// OMaterialWrap
// ============================================================================

OMaterialWrap::OMaterialWrap(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    const emscripten::val& metaObj
) : writerCtx_(parent->writerCtx()) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    mat_ = AbcM::OMaterial(parent->raw(), name, md);
    schema_ = mat_.getSchema();
}

OMaterialWrap::OMaterialWrap(
    AbcM::OMaterialSchema schema,
    std::shared_ptr<ArchiveWriterContext> writerCtx
) : schema_(std::move(schema)), writerCtx_(std::move(writerCtx)) {}

void OMaterialWrap::setShader(
    const std::string& target,
    const std::string& shaderType,
    const std::string& shaderName
) {
    writerCtx_->ensureWritable();
    schema_.setShader(target, shaderType, shaderName);
}

std::shared_ptr<OCompoundWrap> OMaterialWrap::getShaderParameters(
    const std::string& target,
    const std::string& shaderType
) {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getShaderParameters(target, shaderType), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

void OMaterialWrap::addNetworkNode(
    const std::string& nodeName,
    const std::string& target,
    const std::string& nodeType
) {
    writerCtx_->ensureWritable();
    schema_.addNetworkNode(nodeName, target, nodeType);
}

void OMaterialWrap::setNetworkNodeConnection(
    const std::string& nodeName,
    const std::string& inputName,
    const std::string& connectedNodeName,
    const std::string& connectedOutputName
) {
    writerCtx_->ensureWritable();
    schema_.setNetworkNodeConnection(nodeName, inputName, connectedNodeName, connectedOutputName);
}

std::shared_ptr<OCompoundWrap> OMaterialWrap::getNetworkNodeParameters(const std::string& nodeName) {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getNetworkNodeParameters(nodeName), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

void OMaterialWrap::setNetworkTerminal(
    const std::string& target,
    const std::string& shaderType,
    const std::string& nodeName,
    const std::string& outputName
) {
    writerCtx_->ensureWritable();
    schema_.setNetworkTerminal(target, shaderType, nodeName, outputName);
}

void OMaterialWrap::setNetworkInterfaceParameterMapping(
    const std::string& interfaceParamName,
    const std::string& mapToNodeName,
    const std::string& mapToParamName
) {
    writerCtx_->ensureWritable();
    schema_.setNetworkInterfaceParameterMapping(interfaceParamName, mapToNodeName, mapToParamName);
}

std::shared_ptr<OCompoundWrap> OMaterialWrap::getNetworkInterfaceParameters() {
    writerCtx_->ensureWritable();
    auto wrap = std::make_shared<OCompoundWrap>(schema_.getNetworkInterfaceParameters(), writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

// ============================================================================
// MaterialFlattenWrap
// ============================================================================

namespace {

void appendSchemaNodeNames(
    AbcM::IMaterialSchema& schema,
    std::vector<std::string>& out
) {
    if (!schema.valid()) return;
    std::vector<std::string> names;
    schema.getNetworkNodeNames(names);
    for (const auto& nm : names) {
        if (std::find(out.begin(), out.end(), nm) == out.end()) {
            out.push_back(nm);
        }
    }
}

Abc::IObject resolveArchivePath(Abc::IArchive archive, const std::string& fullPath) {
    if (!archive.valid() || fullPath.empty()) return Abc::IObject();
    Abc::IObject cur = archive.getTop();
    std::size_t start = 0;
    while (start < fullPath.size()) {
        while (start < fullPath.size() && fullPath[start] == '/') ++start;
        if (start >= fullPath.size()) break;
        std::size_t slash = fullPath.find('/', start);
        std::string seg = (slash == std::string::npos)
            ? fullPath.substr(start)
            : fullPath.substr(start, slash - start);
        if (!cur.valid() || cur.getChildHeader(seg) == nullptr) {
            return Abc::IObject();
        }
        cur = cur.getChild(seg);
        if (slash == std::string::npos) break;
        start = slash + 1;
    }
    return cur;
}

void appendIMaterialObjectChain(Abc::IObject obj, std::vector<std::string>& out) {
    for (Abc::IObject cur = obj; cur.valid(); cur = cur.getParent()) {
        if (AbcM::IMaterial::matches(cur.getHeader())) {
            AbcM::IMaterial imat(cur, Abc::kWrapExisting);
            AbcM::IMaterialSchema schema = imat.getSchema();
            appendSchemaNodeNames(schema, out);
        }
    }
}

void collectObjectFlattenedNodeNames(Abc::IObject obj, std::vector<std::string>& out) {
    for (Abc::IObject cur = obj; cur.valid(); cur = cur.getParent()) {
        if (AbcM::IMaterial::matches(cur.getHeader())) {
            AbcM::IMaterial imat(cur, Abc::kWrapExisting);
            AbcM::IMaterialSchema schema = imat.getSchema();
            appendSchemaNodeNames(schema, out);
        } else {
            AbcM::IMaterialSchema localSchema;
            if (AbcM::hasMaterial(cur, localSchema)) {
                appendSchemaNodeNames(localSchema, out);
            }
        }
        std::string assignPath;
        if (AbcM::getMaterialAssignmentPath(cur, assignPath) && !assignPath.empty()) {
            Abc::IObject target = resolveArchivePath(cur.getArchive(), assignPath);
            if (target.valid()) {
                appendIMaterialObjectChain(target, out);
            }
        }
    }
}

} // namespace

MaterialFlattenWrap::MaterialFlattenWrap(const std::shared_ptr<IObjectWrap>& obj)
    : flatten_(obj->raw()), keepAlive_(obj->keepAlive()) {
    collectObjectFlattenedNodeNames(obj->raw(), nodeNames_);
}

MaterialFlattenWrap::MaterialFlattenWrap(const std::shared_ptr<IMaterialWrap>& mat)
    : flatten_(mat->rawObject().valid() ? AbcM::MaterialFlatten(mat->rawObject())
                                        : AbcM::MaterialFlatten(mat->rawSchema())),
      keepAlive_(mat->keepAlive()) {
    if (mat->rawObject().valid()) {
        appendIMaterialObjectChain(mat->rawObject(), nodeNames_);
    } else {
        appendSchemaNodeNames(mat->rawSchema(), nodeNames_);
    }
}

emscripten::val MaterialFlattenWrap::getTargetNames() {
    keepAlive_->ensureOpen();
    std::vector<std::string> names;
    flatten_.getTargetNames(names);
    return stringVecToVal(names);
}

emscripten::val MaterialFlattenWrap::getShaderTypesForTarget(const std::string& target) {
    keepAlive_->ensureOpen();
    std::vector<std::string> types;
    flatten_.getShaderTypesForTarget(target, types);
    return stringVecToVal(types);
}

std::string MaterialFlattenWrap::getShader(const std::string& target, const std::string& shaderType) {
    keepAlive_->ensureOpen();
    std::string out;
    if (flatten_.getShader(target, shaderType, out)) return out;
    return "";
}

emscripten::val MaterialFlattenWrap::getShaderParametersList(
    const std::string& target,
    const std::string& shaderType
) {
    keepAlive_->ensureOpen();
    AbcM::MaterialFlatten::ParameterEntryVector entries;
    flatten_.getShaderParameters(target, shaderType, entries);
    return parameterEntriesToVal(entries, keepAlive_);
}

emscripten::val MaterialFlattenWrap::getNetworkTerminalTargetNames() {
    keepAlive_->ensureOpen();
    std::vector<std::string> names;
    flatten_.getNetworkTerminalTargetNames(names);
    return stringVecToVal(names);
}

emscripten::val MaterialFlattenWrap::getNetworkTerminalShaderTypesForTarget(const std::string& target) {
    keepAlive_->ensureOpen();
    std::vector<std::string> types;
    flatten_.getNetworkTerminalShaderTypesForTarget(target, types);
    return stringVecToVal(types);
}

emscripten::val MaterialFlattenWrap::getNetworkTerminal(
    const std::string& target,
    const std::string& shaderType
) {
    keepAlive_->ensureOpen();
    std::string nodeName, outputName;
    if (!flatten_.getNetworkTerminal(target, shaderType, nodeName, outputName)) {
        return emscripten::val::null();
    }
    emscripten::val obj = emscripten::val::object();
    obj.set("nodeName", nodeName);
    obj.set("outputName", outputName);
    return obj;
}

emscripten::val MaterialFlattenWrap::getNetworkNodeByIndex(std::size_t index) {
    keepAlive_->ensureOpen();
    if (index >= nodeNames_.size()) return emscripten::val::null();
    AbcM::MaterialFlatten::NetworkNode node = flatten_.getNetworkNode(nodeNames_[index]);
    if (!node.valid()) return emscripten::val::null();

    emscripten::val obj = emscripten::val::object();
    obj.set("name", node.getName());
    std::string target, nodeType;
    node.getTarget(target);
    node.getNodeType(nodeType);
    obj.set("target", target);
    obj.set("nodeType", nodeType);

    AbcM::MaterialFlatten::ParameterEntryVector params;
    node.getParameters(params);
    obj.set("parameters", parameterEntriesToVal(params, keepAlive_));

    AbcM::MaterialFlatten::NetworkNode::ConnectionVector conns;
    node.getConnections(conns);
    emscripten::val connArr = emscripten::val::array();
    for (std::size_t i = 0; i < conns.size(); ++i) {
        emscripten::val c = emscripten::val::object();
        c.set("inputName", conns[i].inputName);
        c.set("connectedNodeName", conns[i].connectedNodeName);
        c.set("connectedOutputName", conns[i].connectedOutputName);
        connArr.set(i, c);
    }
    obj.set("connections", connArr);
    return obj;
}

// ============================================================================
// ICollectionsWrap / OCollectionsWrap
// ============================================================================

ICollectionsWrap::ICollectionsWrap(const std::shared_ptr<IObjectWrap>& obj)
    : cols_(obj->raw(), Abc::kWrapExisting),
      schema_(cols_.getSchema()),
      keepAlive_(obj->keepAlive()) {}

std::shared_ptr<IArrayWrap> ICollectionsWrap::getCollectionByIndex(std::size_t index) {
    keepAlive_->ensureOpen();
    Abc::IStringArrayProperty p = schema_.getCollection(index);
    if (!p.valid()) return nullptr;
    return std::make_shared<IArrayWrap>(p, keepAlive_);
}

std::shared_ptr<IArrayWrap> ICollectionsWrap::getCollectionByName(const std::string& name) {
    keepAlive_->ensureOpen();
    Abc::IStringArrayProperty p = schema_.getCollection(name);
    if (!p.valid()) return nullptr;
    return std::make_shared<IArrayWrap>(p, keepAlive_);
}

OCollectionsWrap::OCollectionsWrap(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    const emscripten::val& metaObj
) : writerCtx_(parent->writerCtx()) {
    writerCtx_->ensureWritable();
    AbcA::MetaData md = valToMetaData(metaObj);
    cols_ = AbcC::OCollections(parent->raw(), name, md);
    schema_ = cols_.getSchema();
}

std::shared_ptr<OArrayWrap> OCollectionsWrap::createCollection(
    const std::string& name,
    std::uint32_t tsIndex
) {
    writerCtx_->ensureWritable();
    Abc::OStringArrayProperty p = schema_.createCollection(name, tsIndex);
    auto wrap = std::make_shared<OArrayWrap>(p, writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OArrayWrap> OCollectionsWrap::getCollectionByName(const std::string& name) {
    writerCtx_->ensureWritable();
    Abc::OStringArrayProperty p = schema_.getCollection(name);
    if (!p.valid()) return nullptr;
    auto wrap = std::make_shared<OArrayWrap>(p, writerCtx_);
    writerCtx_->registerHandle(wrap);
    return wrap;
}

// ============================================================================
// Material Assignment Helpers & Embind
// ============================================================================

namespace {

std::shared_ptr<OMaterialWrap> createOMaterial(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    const emscripten::val& metaObj
) {
    auto wrap = std::make_shared<OMaterialWrap>(parent, name, metaObj);
    parent->writerCtx()->registerHandle(wrap);
    return wrap;
}

std::shared_ptr<OCollectionsWrap> createOCollections(
    const std::shared_ptr<OObjectWrap>& parent,
    const std::string& name,
    const emscripten::val& metaObj
) {
    auto wrap = std::make_shared<OCollectionsWrap>(parent, name, metaObj);
    parent->writerCtx()->registerHandle(wrap);
    return wrap;
}

void assignMaterialToObject(const std::shared_ptr<OObjectWrap>& obj, const std::string& materialFullPath) {
    if (!obj) throw std::runtime_error("Null OObject passed to assignMaterialToObject.");
    obj->writerCtx()->ensureWritable();
    AbcM::addMaterialAssignment(obj->raw(), materialFullPath);
}

std::shared_ptr<OMaterialWrap> addLocalMaterialToObject(const std::shared_ptr<OObjectWrap>& obj) {
    if (!obj) throw std::runtime_error("Null OObject passed to addLocalMaterialToObject.");
    obj->writerCtx()->ensureWritable();
    AbcM::OMaterialSchema schema = AbcM::addMaterial(obj->raw());
    auto wrap = std::make_shared<OMaterialWrap>(std::move(schema), obj->writerCtx());
    obj->writerCtx()->registerHandle(wrap);
    return wrap;
}

std::string getObjectMaterialAssignmentPath(const std::shared_ptr<IObjectWrap>& obj) {
    if (!obj) return "";
    std::string path;
    if (AbcM::getMaterialAssignmentPath(obj->raw(), path)) {
        return path;
    }
    return "";
}

std::shared_ptr<IMaterialWrap> getObjectLocalMaterial(const std::shared_ptr<IObjectWrap>& obj) {
    if (!obj) return nullptr;
    AbcM::IMaterialSchema schema;
    if (AbcM::hasMaterial(obj->raw(), schema)) {
        return std::make_shared<IMaterialWrap>(std::move(schema), obj->keepAlive());
    }
    return nullptr;
}

std::shared_ptr<MaterialFlattenWrap> flattenObjectMaterial(const std::shared_ptr<IObjectWrap>& obj) {
    return std::make_shared<MaterialFlattenWrap>(obj);
}

std::shared_ptr<MaterialFlattenWrap> flattenMaterialSchema(const std::shared_ptr<IMaterialWrap>& mat) {
    return std::make_shared<MaterialFlattenWrap>(mat);
}

} // namespace

EMSCRIPTEN_BINDINGS(abc_wasm_material_collection) {
    using namespace emscripten;

    class_<IMaterialWrap>("IMaterialWrap")
        .smart_ptr_constructor("IMaterialWrap", &std::make_shared<IMaterialWrap, const std::shared_ptr<IObjectWrap>&>)
        .function("valid", &IMaterialWrap::valid)
        .function("getTargetNames", &IMaterialWrap::getTargetNames)
        .function("getShaderTypesForTarget", &IMaterialWrap::getShaderTypesForTarget)
        .function("getShader", &IMaterialWrap::getShader)
        .function("getShaderParameters", &IMaterialWrap::getShaderParameters)
        .function("getNumNetworkNodes", &IMaterialWrap::getNumNetworkNodes)
        .function("getNetworkNodeNames", &IMaterialWrap::getNetworkNodeNames)
        .function("getNetworkNodeInfo", &IMaterialWrap::getNetworkNodeInfo)
        .function("getNetworkTerminalTargetNames", &IMaterialWrap::getNetworkTerminalTargetNames)
        .function("getNetworkTerminalShaderTypesForTarget", &IMaterialWrap::getNetworkTerminalShaderTypesForTarget)
        .function("getNetworkTerminal", &IMaterialWrap::getNetworkTerminal)
        .function("getNetworkInterfaceParameters", &IMaterialWrap::getNetworkInterfaceParameters)
        .function("getNetworkInterfaceParameterMappings", &IMaterialWrap::getNetworkInterfaceParameterMappings);

    class_<OMaterialWrap>("OMaterialWrap")
        .smart_ptr<std::shared_ptr<OMaterialWrap>>("OMaterialWrap")
        .function("getObject", &OMaterialWrap::getObject)
        .function("setShader", &OMaterialWrap::setShader)
        .function("getShaderParameters", &OMaterialWrap::getShaderParameters)
        .function("addNetworkNode", &OMaterialWrap::addNetworkNode)
        .function("setNetworkNodeConnection", &OMaterialWrap::setNetworkNodeConnection)
        .function("getNetworkNodeParameters", &OMaterialWrap::getNetworkNodeParameters)
        .function("setNetworkTerminal", &OMaterialWrap::setNetworkTerminal)
        .function("setNetworkInterfaceParameterMapping", &OMaterialWrap::setNetworkInterfaceParameterMapping)
        .function("getNetworkInterfaceParameters", &OMaterialWrap::getNetworkInterfaceParameters);

    class_<MaterialFlattenWrap>("MaterialFlattenWrap")
        .smart_ptr<std::shared_ptr<MaterialFlattenWrap>>("MaterialFlattenWrap")
        .function("empty", &MaterialFlattenWrap::empty)
        .function("getTargetNames", &MaterialFlattenWrap::getTargetNames)
        .function("getShaderTypesForTarget", &MaterialFlattenWrap::getShaderTypesForTarget)
        .function("getShader", &MaterialFlattenWrap::getShader)
        .function("getShaderParametersList", &MaterialFlattenWrap::getShaderParametersList)
        .function("getNetworkTerminalTargetNames", &MaterialFlattenWrap::getNetworkTerminalTargetNames)
        .function("getNetworkTerminalShaderTypesForTarget", &MaterialFlattenWrap::getNetworkTerminalShaderTypesForTarget)
        .function("getNetworkTerminal", &MaterialFlattenWrap::getNetworkTerminal)
        .function("getNumNetworkNodes", &MaterialFlattenWrap::getNumNetworkNodes)
        .function("getNetworkNodeByIndex", &MaterialFlattenWrap::getNetworkNodeByIndex);

    class_<ICollectionsWrap>("ICollectionsWrap")
        .smart_ptr_constructor("ICollectionsWrap", &std::make_shared<ICollectionsWrap, const std::shared_ptr<IObjectWrap>&>)
        .function("valid", &ICollectionsWrap::valid)
        .function("getNumCollections", &ICollectionsWrap::getNumCollections)
        .function("getCollectionName", &ICollectionsWrap::getCollectionName)
        .function("getCollectionByIndex", &ICollectionsWrap::getCollectionByIndex)
        .function("getCollectionByName", &ICollectionsWrap::getCollectionByName);

    class_<OCollectionsWrap>("OCollectionsWrap")
        .smart_ptr<std::shared_ptr<OCollectionsWrap>>("OCollectionsWrap")
        .function("getObject", &OCollectionsWrap::getObject)
        .function("getNumCollections", &OCollectionsWrap::getNumCollections)
        .function("createCollection", &OCollectionsWrap::createCollection)
        .function("getCollectionByName", &OCollectionsWrap::getCollectionByName);

    function("createOMaterial", &createOMaterial);
    function("createOCollections", &createOCollections);
    function("assignMaterialToObject", &assignMaterialToObject);
    function("addLocalMaterialToObject", &addLocalMaterialToObject);
    function("getObjectMaterialAssignmentPath", &getObjectMaterialAssignmentPath);
    function("getObjectLocalMaterial", &getObjectLocalMaterial);
    function("flattenObjectMaterial", &flattenObjectMaterial);
    function("flattenMaterialSchema", &flattenMaterialSchema);
}

} // namespace abc_wasm
