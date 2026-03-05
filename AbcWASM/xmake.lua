-- Project configuration
set_project("AbcWASM")
set_version("1.0.0")
set_xmakever("2.5.1")

-- Global settings
set_warnings("all")

-- Package dependencies
add_requires("alembic", {configs = {shared = true}})

-- Native target for Alembic test
target("test_alembic")
    set_kind("binary")
    add_files("test_alembic.cpp")
    add_packages("alembic")
    set_languages("cxx17")
    if is_plat("macosx") then
        add_shflags("-rpath", "@loader_path/../Frameworks")
        add_shflags("-rpath", "$(LIBRARY_SEARCH_PATHS)")
    end
    -- Run from project directory (where xmake.lua is located)
    set_rundir("$(projectdir)")

local function setup_wasm_common()
    set_kind("binary")
    add_rules("platform.wasm")
    add_files("alembic_echo.cpp")
    add_packages("alembic")
    add_includedirs(".")
    set_languages("cxx17")
    set_extension(".js")

    add_ldflags("-lembind", {force = true})
    add_ldflags("--bind", {force = true})
    add_ldflags("-sWASM=1", {force = true})
    add_ldflags("-sALLOW_MEMORY_GROWTH=1", {force = true})
    add_ldflags("-sEXPORTED_FUNCTIONS=['_malloc','_free']", {force = true})
    add_ldflags("-sEXPORTED_RUNTIME_METHODS=['HEAPU8','wasmMemory','ccall','cwrap','stringToUTF8','UTF8ToString','FS_createPath','FS_createDataFile']", {force = true})
    add_ldflags("-sMODULARIZE=1", {force = true})
    add_ldflags("-sEXPORT_NAME=AlembicEchoModule", {force = true})
    add_ldflags("-sENVIRONMENT=web,webview,node,shell,worker", {force = true})
    add_ldflags("-sFORCE_FILESYSTEM=1", {force = true})
    add_ldflags("-sEXPORT_ES6=1", {force = true})
    add_ldflags("-sNO_DISABLE_EXCEPTION_CATCHING", {force = true})
    add_ldflags("-sMAXIMUM_MEMORY=4294967296", {force = true})
    add_ldflags("-sSTACK_SIZE=15MB", {force = true})
end

target("alembic_echo_wasm")
    setup_wasm_common()
    set_optimize("smallest")
    add_defines("NDEBUG")
    add_ldflags("-sASSERTIONS=0", {force = true})
    add_ldflags("-sSTACK_OVERFLOW_CHECK=0", {force = true})

    -- add_ldflags("--profiling-funcs", {force = true})
    -- -- 可选：source map（注意体积和部署）
    -- add_cxflags("-gsource-map", {force = true})
    -- add_ldflags("-gsource-map", {force = true})

    set_targetdir("dist")

target("alembic_echo_wasm_debug")
    setup_wasm_common()
    set_optimize("none")
    add_cxflags("--profiling-funcs", {force = true})
    add_ldflags("--profiling-funcs", {force = true})
    add_cxflags("-g3", {force = true})
    add_ldflags("-g3", {force = true})
    add_ldflags("-sASSERTIONS=2", {force = true})
    add_ldflags("-sSTACK_OVERFLOW_CHECK=2", {force = true})
    set_targetdir("dist-debug")

