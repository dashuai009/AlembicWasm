set_project("alembic-wasm")
set_version("0.1.0")
set_xmakever("2.5.1")

set_warnings("all")

if is_plat("wasm") then
    add_requires("imath", {configs = {shared = false, cxxflags = {"-fexceptions"}, ldflags = {"-fexceptions"}}})
    add_requires("alembic", {configs = {shared = false, hdf5 = false, cxxflags = {"-fexceptions", "--include=pthread.h"}, ldflags = {"-fexceptions"}}})
else
    add_requires("alembic", {configs = {shared = false, hdf5 = false}})
end

if not is_plat("wasm") then
    target("test_alembic")
        set_kind("binary")
        add_files("src/cpp/test_alembic.cpp")
        add_packages("alembic")
        set_languages("cxx17")
        set_rundir("$(projectdir)")
end

local function setup_wasm_common()
    set_kind("binary")
    add_rules("platform.wasm")
    add_files("src/cpp/bind_*.cpp")
    add_includedirs("src/cpp/include")
    add_packages("alembic")
    set_languages("cxx17")
    set_extension(".js")

    add_cxflags("-fexceptions", {force = true})
    add_ldflags("-fexceptions", {force = true})
    add_ldflags("-lembind", {force = true})
    add_ldflags("-sWASM=1", {force = true})
    add_ldflags("-sALLOW_MEMORY_GROWTH=1", {force = true})
    add_ldflags("-sMAXIMUM_MEMORY=4294967296", {force = true})
    add_ldflags("-sSTACK_SIZE=8388608", {force = true})
    add_ldflags("-sEXPORTED_FUNCTIONS=['_malloc','_free']", {force = true})
    add_ldflags("-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAP32','HEAPU32','HEAPF32','HEAPF64','getExceptionMessage']", {force = true})
    add_ldflags("-sMODULARIZE=1", {force = true})
    add_ldflags("-sEXPORT_ES6=1", {force = true})
    add_ldflags("-sEXPORT_NAME=createAlembicModule", {force = true})
    add_ldflags("-sENVIRONMENT=web,webview,worker,node", {force = true})
    add_ldflags("-sFILESYSTEM=0", {force = true})
end

target("alembic_wasm")
    setup_wasm_common()
    set_optimize("fastest")
    add_defines("NDEBUG")
    add_ldflags("-sASSERTIONS=0", {force = true})
    add_ldflags("-sSTACK_OVERFLOW_CHECK=0", {force = true})
    set_targetdir("build/wasm")

    after_build(function (target)
        local out_dir = path.join(os.projectdir(), "src", "wasm", "generated")
        os.mkdir(out_dir)
        local js_file = target:targetfile()
        local wasm_file = path.join(path.directory(js_file), path.basename(js_file) .. ".wasm")
        if os.isfile(js_file) then
            os.cp(js_file, path.join(out_dir, "alembic_wasm.js"))
        end
        if os.isfile(wasm_file) then
            os.cp(wasm_file, path.join(out_dir, "alembic_wasm.wasm"))
        end
    end)

target("alembic_wasm_debug")
    set_default(false)
    setup_wasm_common()
    set_optimize("none")
    add_cxflags("-g3", "--profiling-funcs", {force = true})
    add_ldflags("-g3", "--profiling-funcs", {force = true})
    add_ldflags("-sASSERTIONS=2", {force = true})
    add_ldflags("-sSTACK_OVERFLOW_CHECK=2", {force = true})
    set_targetdir("build/wasm-debug")
