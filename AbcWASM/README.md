# AbcWASM

**AbcWASM** is a C++ to WebAssembly (WASM) wrapper for the Alembic library that enables Alembic file (.abc) parsing and processing in web environments. The library is designed to seamlessly integrate with Three.js for WebGL-based 3D visualization of Alembic geometry.

## Overview

AbcWASM provides JavaScript bindings for the core Alembic functionality using Emscripten's binding system (embind). It allows:
- Reading and parsing Alembic files from the web browser
- Extracting structure information from Alembic archives
- Retrieving vertex geometry data for mesh visualization
- Memory-based file processing (for files loaded as ArrayBuffer in the browser)

## Features

- **WASM-based:** Runs Alembic processing directly in the browser without server dependencies
- **Cross-platform:** Built with xmake for platform-agnostic builds
- **Three.js Integration:** Designed to work seamlessly with Three.js ABCLoader
- **Memory Efficient:** Supports both file-based and memory-based Alembic processing
- **Geometry Extraction:** Direct access to vertex data for 3D rendering

## Dependencies

- Emscripten for WASM compilation
- Alembic C++ library (version 1.7.0 or later)
- xmake build system

## xmake Build Configuration

### Prerequisites

Make sure to install:
1. **Emscripten SDK** (emcc)
2. **xmake** build system
3. **Alembic** library development headers

### Environment Setup

```bash
# Install xmake
curl -fsSL https://xmake.io/shget.text | bash

# Install Alembic using package manager:
# macOS
brew install -vd alembic

# Linux
sudo apt install libalembic-dev

# Or use xmake packages
xrepo install alembic
```

### Build Configuration

The xmake.lua configuration file defines the build system for both native tests and WASM builds:

```lua
-- Project configuration
set_project("AbcWASM")
set_version("1.0.0")
set_xmakever("2.5.1")

-- Global settings
set_warnings("all", "error")

-- Package dependencies
add_requires("alembic", {configs = {shared = true}})
```

### Native Test Build

To build the native test executable:
```bash
xmake f -p linux    # or -p macosx, -p windows
xmake build test_alembic
```

### WASM Build (Primary Target)

To build the main WASM module:
```bash
# Configure for WASM platform
xmake f -p wasm -a wasm32

# Build the WASM module
xmake build alembic_echo_wasm

# Output will be in dist/ directory
# - alembic_echo_wasm.js (JavaScript bindings)
# - alembic_echo_wasm.wasm (WebAssembly binary)
```

### xmake.lua Configuration Details

The `xmake.lua` file contains two targets:

1. **test_alembic** - Native executable for testing Alembic functionality
2. **alembic_echo_wasm** - WASM module with JavaScript bindings

Key Emscripten flags used in WASM target:
- `-sMODULARIZE=1` - Creates a modularized and asynchronous module
- `-sEXPORT_NAME=AlembicEchoModule` - Export name for the WASM module
- `-sENVIRONMENT=web,webview,node,shell,worker` - Supports multiple environment targets
- `-sEXPORTED_RUNTIME_METHODS` - Exports file system and common runtime methods
- `-sWASM=1` - Enable WebAssembly (default, but explicit for clarity)

## API Reference

### Available Functions

The following functions are exported and available in JavaScript after WASM module initialization:

1. **`read_alembic_structure(filename)`**
   - Reads and returns the structure of an Alembic file as a structured string
   - Intended for file system access (not directly used in browser)

2. **`read_alembic_structure_from_memory(buffer)`**
   - Processes Alembic data from a memory buffer (Array-like)
   - Primary function for browser usage with ArrayBuffer input

3. **`get_mesh_vertices(filename)`**
   - Reads an Alembic file and returns mesh vertex data as vector of floats [x,y,z,x,y,z,...]
   - Intended for file system access (not directly used in browser)

4. **`get_mesh_vertices_from_memory(buffer)`**
   - Extracts mesh vertex data directly from memory buffer
   - Used by Three.js ABCLoader for real-time geometry parsing

5. **Vector registration functions:**
   - `VectorU8` - Vector of unsigned 8-bit integers
   - `VectorFloat` - Vector of float values

### Usage with JavaScript

```javascript
// After importing the generated module
import createModule from './dist/alembic_echo_wasm.js';

// Initialize the module
const module = await createModule();

// Process an ArrayBuffer buffer containing Alembic data
const bufferData = new module.VectorU8();
for (let i = 0; i < uint8Buffer.length; i++) {
    bufferData.push_back(uint8Buffer[i]);
}

// Extract information
const structure = module.read_alembic_structure_from_memory(bufferData);
const vertices = module.get_mesh_vertices_from_memory(bufferData);

// Clean up the vector after use
bufferData.delete();
```

## Integration with Three.js

The AbcWASM library is specifically designed to work with Three.js through the ABCLoader. When Three.js encounters an Alembic file, it uses:

1. The WASM module to parse the Alembic structure
2. Extract geometry data for visualization
3. Create appropriate Three.js objects (meshes, groups, etc.)

### ABCLoader Example

```typescript
import * as THREE from 'three';
import { ABCLoader } from './loaders/ABCLoader';

const loader = new ABCLoader();
loader.load(
    'path/to/geometry.abc',
    (group) => {
        scene.add(group); // Add parsed Alembic objects to the scene
    },
    (progress) => {
        console.log('Loading progress:', progress);
    },
    (error) => {
        console.error('Error loading ABC file:', error);
    }
);
```

## Building and Testing

### Complete Build Process

```bash
# 1. Install dependencies
xrepo install alembic

# 2. Build WASM module
xmake f -p wasm -a wasm32
xmake build alembic_echo_wasm

# 3. Check output files in dist/ directory
ls -la dist/
```

### Debug Build

For debugging purposes (more verbose output, debugging symbols):
```bash
xmake f -p wasm -a wasm32 -m debug
xmake build alembic_echo_wasm
```

### Release Build

For production use (optimized and smaller file size):
```bash
xmake f -p wasm -a wasm32 -m release
xmake build alembic_echo_wasm
```

## Folder Structure

```
AbcWASM/
├── README.md              # This documentation
├── xmake.lua             # xmake build configuration
├── alembic_echo.*        # Core library files
├── test_alembic.cpp      # Native test implementation
├── dist/                 # Compiled output files (generated)
└── build/                # Intermediate build files (generated)
```

## Performance Considerations

- **Module Size:** The WASM module includes the full Alembic library, which can be substantial
- **Memory Usage:** Large Alembic files require significant memory allocation during processing
- **Loading Time:** First-time module initialization may take a few seconds for download and compilation
- **Geometry Complexity:** Complex scenes with many polygons may impact rendering performance

## Troubleshooting

### Common Issues

1. **"Cannot load WASM module"** - Ensure the .wasm file is accessible and properly served with correct MIME type
2. **"Invalid Alembic file"** - File may be corrupted or not in Alembic format
3. **Performance Issues** - Large files should be processed incrementally or simplified externally

### Debugging Tips

- Enable verbose output in JavaScript to see processing logs
- Check Web Console for Emscripten-specific messages
- Use browser developer tools to examine heap and stack limitations

## License

This library is provided as part of the Alembic to Three.js ecosystem. Please refer to the main project's licensing and the Alembic library's license terms.

## Contributing

Bug reports, pull requests, and improvements to the WASM build system or the C++ core functionality are welcome.

---

*Part of the Alembic to Three.js visualization pipeline*