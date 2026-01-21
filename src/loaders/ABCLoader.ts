import * as THREE from 'three';

// ABC (Alembic) Loader interface
// Based on Three.js FBX loader structure

export class ABCLoader extends THREE.Loader {
  manager: THREE.LoadingManager;
  private static wasmModule: any = null; // Static to avoid re-initialization

  constructor(manager?: THREE.LoadingManager) {
    super();
    this.manager = manager || THREE.DefaultLoadingManager;
  }

  // Initialize the WASM module asynchronously
  private static async initWasmModule(): Promise<any> {
    if (ABCLoader.wasmModule) {
      return ABCLoader.wasmModule;
    }

    // Dynamically import the WASM module
    try {
      // Import the Emscripten-generated WASM module
      const createModule = (await import('../../AbcWASM/dist/alembic_echo_wasm.js')).default;

      // Initialize the module which will download the WASM binary
      ABCLoader.wasmModule = await createModule();
      return ABCLoader.wasmModule;
    } catch (error) {
      console.error('Error initializing WASM module:', error);
      throw error;
    }
  }

  // Main loading function - loads from URL
  load(
    url: string,
    onLoad: (object: THREE.Group) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: ErrorEvent) => void
  ): void {
    const scope = this;

    const loader = new THREE.FileLoader(this.manager);
    loader.setResponseType('arraybuffer');

    loader.load(
      url,
      function (data) {
        if (data instanceof ArrayBuffer) {
          // Initialize WASM module first, then parse
          ABCLoader.initWasmModule()
            .then(_ => { // Don't need the result, just ensure WASM is ready
              // Process the data directly in a promise chain
              scope.processDataAsync(data).then(result => {
                onLoad(result);
              }).catch((err: unknown) => {
                const error = err instanceof Error ? err : new Error(String(err));
                if (onError) {
                  const errorEvent: ErrorEvent = Object.assign(new Event('error'), {
                    error: error,
                    message: error.message,
                    filename: url,
                    lineno: 0,
                    colno: 0
                  });
                  onError(errorEvent);
                } else {
                  console.error(error);
                }
                scope.manager.itemError(url);
              });
            })
            .catch((err: unknown) => {
              const error = err instanceof Error ? err : new Error(String(err));
              if (onError) {
                const errorEvent: ErrorEvent = Object.assign(new Event('error'), {
                  error: error,
                  message: error.message,
                  filename: url,
                  lineno: 0,
                  colno: 0
                });
                onError(errorEvent);
              } else {
                console.error(error);
              }
              scope.manager.itemError(url);
            });
        } else {
          const error = new Error('Expected ArrayBuffer from loader');
          if (onError) {
            const errorEvent: ErrorEvent = Object.assign(new Event('error'), {
              error: error,
              message: error.message,
              filename: url,
              lineno: 0,
              colno: 0
            });
            onError(errorEvent);
          } else {
            console.error(error);
          }
          scope.manager.itemError(url);
        }
      },
      onProgress,
      onError as any // FileLoader expects (event: ProgressEvent) => void, but THREE.Loader passes ErrorEvent
    );
  }

  async processDataAsync(buffer: ArrayBuffer): Promise<THREE.Group> {
    // Use the enhanced detailed parsing by default
    return this.parseDetailedGeometry(buffer);
  }

  // Parse is still required by THREE.Loader interface but we'll keep it minimal
  parse(_buffer: ArrayBuffer): THREE.Group {
    // In a real implementation with sync parsing, but WASM is async-only
    console.warn('Sync parsing not available for ABC files with WASM backend. Use load() method instead.');
    return new THREE.Group();
  }

  private parseAbcStructureToThreejs(abcStructure: string): THREE.Group {
    const group = new THREE.Group();

    console.log('ABC Structure:\n', abcStructure);

    // The ABC structure from the WASM module contains information about
    // objects, compound properties, properties and their data types
    const lines = abcStructure.split('\n');

    for (const line of lines) {
      if (line.includes('Object')) {
        const objectName = this.extractObjectInfo(line, 'name');
        if (objectName) {
          console.log('Found object:', objectName);

          // In a complete implementation we would parse for geometry data
          // For now creating placeholder objects representing alembic file nodes
          const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
          const material = new THREE.MeshBasicMaterial({
            color: Math.random() * 0xffffff,
            wireframe: true
          });
          const objectMesh = new THREE.Mesh(geometry, material);
          objectMesh.name = objectName;

          group.add(objectMesh);
        }
      }
    }

    return group;
  }

  // Helper function to extract information from the ABC structure
  private extractObjectInfo(line: string, attribute: string): string | undefined {
    const match = line.match(new RegExp(`${attribute}=([\\w/\\-\\._]+)`));
    return match ? match[1] : undefined;
  }

  /**
   * Get raw mesh vertices from the WASM module for the loaded ABC file
   * This allows for direct access to vertex position data
   */
  async getMeshVertices(buffer: ArrayBuffer): Promise<Float32Array> {
    // Initialize WASM module
    const module = await ABCLoader.initWasmModule();

    if (!module) {
      throw new Error('WASM module not initialized');
    }

    // Convert ArrayBuffer to Uint8Array
    const uint8Array = new Uint8Array(buffer);

    // Create the vector in WASM memory space
    const vectorData = new module.VectorU8();

    // Add data to the vector
    for (let i = 0; i < uint8Array.length; i++) {
      vectorData.push_back(uint8Array[i]);
    }

    try {
      // Use the NEW function that's been bound in the C++ file specifically for memory
      const result = module.get_mesh_vertices_from_memory(vectorData);
      console.log("result", result);
      // Clean up the vector
      vectorData.delete();

      // Convert to Three.js compatible format
      // Emscripten vector uses .size() method, not .length
      const size = result.size();
      if (size > 0) {
        const floatArray = new Float32Array(size);
        for (let i = 0; i < size; i++) {
          floatArray[i] = result.get(i);
        }
        return floatArray;
      } else {
        return new Float32Array();
      }
    } catch (error) {
      console.error("Error calling WASM get_mesh_vertices_from_memory function:", error);
      vectorData.delete();
      return new Float32Array();
    }
  }

  /**
   * Enhanced method to parse full geometry data instead of basic structure
   */
  async parseDetailedGeometry(buffer: ArrayBuffer): Promise<THREE.Group> {
    // First try the enhanced geometric parsing if possible
    try {
      // Initialize WASM module
      const module = await ABCLoader.initWasmModule();

      if (!module) {
        throw new Error('WASM module not initialized');
      }

      // Get detailed vertex data if available
      const meshVertices = await this.getMeshVertices(buffer);
      console.log(meshVertices)

      if (meshVertices.length > 0) {
        // Have actual mesh vertices, create proper geometry
        return this.createGeometryFromVertices(meshVertices);
      } else {
        // Fall back to basic structure parsing
        // Use the same approach as processDataAsync to get the structure string
        const uint8Array = new Uint8Array(buffer);
        const vectorData = new module.VectorU8();

        for (let i = 0; i < uint8Array.length; i++) {
          vectorData.push_back(uint8Array[i]);
        }

        const result = module.read_alembic_structure_from_memory(vectorData);
        vectorData.delete();

        return this.parseAbcStructureToThreejs(result);
      }
    } catch (error) {
      console.error('Error in detailed geometry parsing:', error);
      // Fall back to basic parsing
      const module = await ABCLoader.initWasmModule();
      if (module) {
        // Use same approach as above
        const bufferUint8 = new Uint8Array(buffer);
        const vectorData = new module.VectorU8();

        for (let i = 0; i < bufferUint8.length; i++) {
          vectorData.push_back(bufferUint8[i]);
        }

        const result = module.read_alembic_structure_from_memory(vectorData);
        vectorData.delete();

        return this.parseAbcStructureToThreejs(result);
      } else {
        return new THREE.Group(); // Return empty group on complete failure
      }
    }
  }

  private createGeometryFromVertices(vertices: Float32Array): THREE.Group {
    const group = new THREE.Group();

    if (vertices.length === 0) {
      return group;
    }

    // Calculate how many vertices we have
    // We'll assume these are positions in the form [x1,y1,z1,x2,y2,z2,...]
    const vertexCount = vertices.length / 3;

    if (vertexCount >= 3) {
      // For mesh to be valid we need at least 3 vertices
      // Create geometry with the vertex data
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

      // For wireframes (to see the shape clearly during development)
      const edges = new THREE.EdgesGeometry(geometry);
      const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
      const wireframe = new THREE.LineSegments(edges, lineMaterial);
      group.add(wireframe);

      // Also add a shaded mesh
      const material = new THREE.MeshPhongMaterial({
        color: 0x4287f5,
        wireframe: false,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8
      });

      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
    } else if (vertices.length > 0) {
      // Just points
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

      const pointsMaterial = new THREE.PointsMaterial({
        color: 0xff0000,
        size: 0.1
      });
      const points = new THREE.Points(geometry, pointsMaterial);
      group.add(points);
    }

    return group;
  }

  // Dispose method for cleanup
  dispose(): void {
    // Clean up any resources if necessary
    ABCLoader.wasmModule = null;
  }
}

// Export a default instance similar to other loaders
export default ABCLoader;