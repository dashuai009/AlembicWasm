-- Project configuration
set_project("AbcWASM")
set_version("1.0.0")
set_xmakever("2.5.1")

-- Global settings
set_warnings("all", "error")

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

-- WASM target for Alembic echo
target("alembic_echo_wasm")
    set_kind("binary")
    add_rules("platform.wasm")
    add_files("alembic_echo.cpp")
    add_packages("alembic")
    add_includedirs(".")
    set_languages("cxx17") -- embind requires C++17

    -- Emscripten-specific settings
    add_ldflags("-lembind", {force = true})
    add_ldflags("--bind", {force = true})
    add_ldflags("-sWASM=1", {force = true})
    add_ldflags("-sALLOW_MEMORY_GROWTH=1", {force = true})
    -- add_ldflags("-sEXPORTED_FUNCTIONS=['_malloc','_free']", {force = true})
    add_ldflags("-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','stringToUTF8','UTF8ToString','FS_createPath','FS_createDataFile']", {force = true})
    add_ldflags("-sMODULARIZE=1", {force = true})
    add_ldflags("-sEXPORT_NAME=AlembicEchoModule", {force = true})
    add_ldflags("-sENVIRONMENT=web,webview,node,shell,worker", {force = true})
    add_ldflags("-sFORCE_FILESYSTEM=1", {force = true})
    add_ldflags("-sEXPORT_ES6=1", {force = true})
    add_ldflags("-sNO_DISABLE_EXCEPTION_CATCHING", {force = true})
    -- Debug/symbols + better runtime diagnostics
    add_cxflags("-g3", "-O0", {force = true})
    add_ldflags("-g3", "-O0", {force = true})

    add_ldflags("-sASSERTIONS=2", {force = true})

    -- Optional but useful for catching memory issues / stack issues
    add_ldflags("-sSTACK_OVERFLOW_CHECK=2", {force = true})
    -- add_ldflags("-sSAFE_HEAP=1", {force = true}) -- 很慢，仅排查内存问题时开

    set_targetdir("dist")

    -- Set output format to JS/WASM
    set_extension(".js")

