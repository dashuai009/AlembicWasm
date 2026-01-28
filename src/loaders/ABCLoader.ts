import * as THREE from 'three';

/**
 * A custom curve class for handling Alembic curves
 * This extends THREE.Curve to provide specialized functionality for Alembic curve data
 */
export class ABCCurve extends THREE.Curve<THREE.Vector3> {
  public points: THREE.Vector3[];
  public isClosed: boolean;

  constructor(points: THREE.Vector3[], isClosed: boolean = false) {
    super();
    this.points = points;
    this.isClosed = isClosed;
    this.type = 'ABCCurve';
  }

  getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
    const point = optionalTarget || new THREE.Vector3();
    
    if (this.points.length === 0) {
      point.set(0, 0, 0);
      return point;
    }

    if (this.points.length === 1) {
      point.copy(this.points[0]);
      return point;
    }

    // Interpolate along the curve
    const positions = this.points;
    const len = positions.length;
    
    if (this.isClosed) {
      // For closed curves, we connect the last point to the first
      const totalSegments = len;
      const scaledT = t * totalSegments;
      const index = Math.floor(scaledT);
      const diff = scaledT - index;
      
      const point1 = positions[index % len];
      const point2 = positions[(index + 1) % len];
      
      point.lerpVectors(point1, point2, diff);
    } else {
      // For open curves
      const scaledT = t * (len - 1);
      const index = Math.floor(scaledT);
      const diff = scaledT - index;
      
      if (index >= len - 1) {
        point.copy(positions[len - 1]);
      } else {
        const point1 = positions[index];
        const point2 = positions[index + 1];
        point.lerpVectors(point1, point2, diff);
      }
    }
    
    return point;
  }

  // Get points for visualization as a line
  getPointsForVisualization(divisions?: number): THREE.Vector3[] {
    if (divisions === undefined) {
      divisions = this.points.length * 2;
    }
    return this.getPoints(divisions);
  }

  // Get the bounding box of the curve
  getBoundingBox(): THREE.Box3 {
    const bbox = new THREE.Box3();
    if (this.points.length > 0) {
      bbox.setFromPoints(this.points);
    }
    return bbox;
  }
}



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
    let result = new THREE.Group();
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

      // Convert ArrayBuffer to Uint8Array
      const uint8Array = new Uint8Array(buffer);

      // Create the vector in WASM memory space
      const vectorData = new module.VectorU8();

      // Add data to the vector
      for (let i = 0; i < uint8Array.length; i++) {
        vectorData.push_back(uint8Array[i]);
      }

      {
        // tmp scope
        let mem_buf = new module.MemoryBufferInputStream(vectorData);
        const topObjectHandle = module.InitTopAlembicObject(mem_buf);

        if (topObjectHandle) {
          console.log('Top object name:', topObjectHandle.getName());
          console.log('Top object full name:', topObjectHandle.getFullName());
          console.log('Top object schema:', topObjectHandle.getMetaDataSchema());
          console.log('Number of children:', topObjectHandle.getNumChildren());

          // Get complete hierarchy from WASM using the recursive C++ function
          console.log('=== ALEMBIC HIERARCHY ===');
          await this.createObjectHierarchy(topObjectHandle, 0, result);

          console.log("result = ", result);
        }
      }
      vectorData.delete();

      // if (meshVertices.length > 0) {
      //   // Have actual mesh vertices, create proper geometry
      //   return this.createGeometryFromVertices(meshVertices);
      // } else {
      //   // Fall back to basic structure parsing
      //   // Use the same approach as processDataAsync to get the structure string
      //   const uint8Array = new Uint8Array(buffer);
      //   const vectorData = new module.VectorU8();

      //   for (let i = 0; i < uint8Array.length; i++) {
      //     vectorData.push_back(uint8Array[i]);
      //   }

      //   const result = module.read_alembic_structure_from_memory(vectorData);
      //   vectorData.delete();

      //   return this.parseAbcStructureToThreejs(result);
      // }
    } catch (error) {
      console.error('Error in detailed geometry parsing:', error);
      // // Fall back to basic parsing
      // const module = await ABCLoader.initWasmModule();
      // if (module) {
      //   // Use same approach as above
      //   const bufferUint8 = new Uint8Array(buffer);
      //   const vectorData = new module.VectorU8();

      //   for (let i = 0; i < bufferUint8.length; i++) {
      //     vectorData.push_back(bufferUint8[i]);
      //   }

      //   const result = module.read_alembic_structure_from_memory(vectorData);
      //   vectorData.delete();

      //   return this.parseAbcStructureToThreejs(result);
      // } else {
      //   return new THREE.Group(); // Return empty group on complete failure
      // }
    }
    return result;
  }

  /**
   * Get AlembicObjectHandle for the top-level object in the Alembic file
   * This allows interaction with the IObject properties via WASM
   */
  async getTopObjectHandle(buffer: ArrayBuffer): Promise<any> {
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
      // Create a new AlembicObjectHandle from the buffer
      const handle = new module.AlembicObjectHandle(vectorData);

      // Clean up the vector after creating the handle
      vectorData.delete();

      return handle;
    } catch (error) {
      console.error("Error creating AlembicObjectHandle:", error);
      vectorData.delete();
      return null;
    }
  }


  private async createCamera(iObj: any): Promise<THREE.PerspectiveCamera> {
    const module = await ABCLoader.initWasmModule();

    // Wrap the IObject as ICamera
    const iCamera = module.WrapCamera(iObj);
    const cameraSchema = iCamera.getSchema();

    // Get the camera sample (first frame)
    const cameraSample = cameraSchema.getValue();

    // Get camera parameters from Alembic
    // Alembic uses: focal length in mm, aperture in cm
    const focalLengthMM = cameraSample.getFocalLength();
    const horizontalApertureCM = cameraSample.getHorizontalAperture();
    const verticalApertureCM = cameraSample.getVerticalAperture();
    const nearClipCM = cameraSample.getNearClippingPlane();
    const farClipCM = cameraSample.getFarClippingPlane();

    // Calculate field of view
    // FOV = 2 * atan(aperture / (2 * focalLength))
    // Convert horizontal aperture from cm to mm for calculation
    const horizontalApertureMM = horizontalApertureCM * 10;
    const fovRadians = 2 * Math.atan(horizontalApertureMM / (2 * focalLengthMM));
    const fovDegrees = fovRadians * (180 / Math.PI);

    // Calculate aspect ratio from apertures
    const aspectRatio = horizontalApertureCM / verticalApertureCM;

    // Convert clipping planes from cm to scene units (assuming 1 unit = 1 cm)
    const near = nearClipCM;
    const far = farClipCM;

    // Create THREE.PerspectiveCamera with calculated parameters
    const camera = new THREE.PerspectiveCamera(fovDegrees, aspectRatio, near, far);

    // Set camera name
    camera.name = iObj.getName() || 'AlembicCamera';

    // // Log camera info for debugging
    // console.log(`Camera created: ${camera.name}`);
    // console.log(`  Focal Length: ${focalLengthMM}mm`);
    // console.log(`  Horizontal Aperture: ${horizontalApertureCM}cm`);
    // console.log(`  Vertical Aperture: ${verticalApertureCM}cm`);
    // console.log(`  FOV: ${fovDegrees.toFixed(2)}°`);
    // console.log(`  Aspect Ratio: ${aspectRatio.toFixed(3)}`);
    // console.log(`  Near: ${near}, Far: ${far}`);

    return camera;
  }

  /**
   * Recursively print the object hierarchy with proper indentation
   * @param handle - AlembicObjectHandle to print
   * @param depth - Current depth level for indentation
   */
  private async createObjectHierarchy(handle: any, depth: number, parentObj: THREE.Object3D): Promise<void> {

    // let testg = new THREE.Group();
    // testg.position.set(0, 0, 10);
    // parentObj.add(testg);

    // let testmesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 1), new THREE.MeshBasicMaterial({ color: 0x4287f5 }));
    // testg.add(testmesh);

    // let testmesh2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x4287f5 }));
    // parentObj.add(testmesh2);
    // return;
    // Initialize WASM module
    const module = await ABCLoader.initWasmModule();

    const indent = '  '.repeat(depth); // Two spaces per depth level
    const name = handle.getName() || 'unnamed';
    const schema = handle.getMetaDataSchema() || 'no_schema';
    const numChildren = handle.getNumChildren();

    console.log(`${indent}- ${name} [${schema}] (${numChildren} children)`);

    // Recursively print children using the child attribute methods
    for (let i = 0; i < numChildren; i++) {
      try {
        const child_i = handle.getChild(i);
        const child_i_schema = child_i.getMetaDataSchema() || 'no_schema';

        if (child_i_schema.startsWith("AbcGeom_Xform")) {
          let geo = new THREE.Group();
          parentObj.add(geo);
          await this.createObjectHierarchy(child_i, depth + 1, geo);
          let xform = module.xformGetMatrix(child_i);
          let newXform = new THREE.Matrix4();
          newXform.fromArray(xform.getValueView());
          geo.position.setFromMatrixPosition(newXform);
          geo.rotation.setFromRotationMatrix(newXform);
          geo.scale.setFromMatrixScale(newXform);
        } else if (child_i_schema.startsWith("AbcGeom_PolyMesh")) {
          let geo = new THREE.BufferGeometry();
          let vertices = module.get_mesh_vertices(child_i);
          // 将 WASM 返回的顶点数据转换为 Float32Array
          const vertexCount = vertices.size();
          if (vertexCount > 0) {
            const positionArray = new Float32Array(vertexCount);
            for (let j = 0; j < vertexCount; j++) {
              positionArray[j] = vertices.get(j);
            }

            // 设置 position 属性 (每个顶点3个分量: x, y, z)
            geo.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));

            // 计算法线以便正确光照
            geo.computeVertexNormals();
          }

          // 创建材质和网格
          const material = new THREE.MeshPhongMaterial({
            color: 0x4287f5,
            side: THREE.DoubleSide,
            flatShading: true
          });
          let mesh = new THREE.Mesh(geo, material);
          mesh.name = name;

          parentObj.add(mesh);
          await this.createObjectHierarchy(child_i, depth + 1, mesh);
        } else if (child_i_schema.startsWith("AbcGeom_Camera")){
          let cam = await this.createCamera(child_i);
          parentObj.add(cam);
          await this.createObjectHierarchy(child_i, depth + 1, cam);
        } else if (child_i_schema === "AbcGeom_Curve_v2") {
          // Handle Alembic Curve_v2 schema
          await this.createCurve(child_i, parentObj);
          await this.createObjectHierarchy(child_i, depth + 1, parentObj);
        } else {
          console.log("unhandled mesh", child_i.getMetaDataSchema());
        }
      } catch (error) {
        console.error(`${indent}  - Error getting child ${i}:`, error);
      }
    }
  }

  /**
   * Create Three.js curve objects from Alembic curve data
   * @param iObj - The Alembic IObject representing the curve
   * @param parentObj - The parent Three.js object to attach the curve to
   */
  private async createCurve(iObj: any, parentObj: THREE.Object3D): Promise<void> {
    try {
      const module = await ABCLoader.initWasmModule();
      
      // Wrap the IObject as ICurves
      const iCurves = module.WrapCurves(iObj);
      const curveSchema = iCurves.getSchema();
      
      // Get curve sample data
      const curveSample = curveSchema.getValue();
      
      // Get positions
      const positionsPtr = curveSample.getPositions();
      // if (!positionsPtr) {
      //   console.warn('Curve has no position data');
      //   return;
      // }
      
      // // Get curve information
      const numCurves = curveSample.getNumCurves();
      // console.log(`numCurves: ${numCurves}`);
      const curvesNumVerticesPtr = curveSample.getCurvesNumVertices();
      const curveType = curveSample.getType();
      const curveWrap = curveSample.getWrap();
      
      // // Get additional curve properties if available
      // const widthsParam = curveSchema.getWidthsParam();
      // const normalsParam = curveSchema.getNormalsParam();
      // const uvsParam = curveSchema.getUVsParam();
      
      // // Check if these parameters are valid
      // const hasWidths = widthsParam && widthsParam.valid();
      // const hasNormals = normalsParam && normalsParam.valid();
      // const hasUVs = uvsParam && uvsParam.valid();
      
      // console.log(`Creating curve with ${numCurves} curves, type: ${curveType}, wrap: ${curveWrap}`);
      // console.log(`Curve properties - Widths: ${hasWidths}, Normals: ${hasNormals}, UVs: ${hasUVs}`);
      
      // Process each curve
      let currentIndex = 0;

      let positionArray = positionsPtr.getFloatView();
      let numVerticesArray = curvesNumVerticesPtr.getView();
      for (let i = 0; i < numCurves; i++) {
        const numVertices = numVerticesArray[i];
        const points: THREE.Vector3[] = [];
        
        // Extract points for this curve
        for (let j = 0; j < numVertices; j++) {
          const idx = currentIndex + j;
          // Each position has 3 components (x, y, z)
          const x = positionArray[idx * 3];
          const y = positionArray[idx * 3 + 1];
          const z = positionArray[idx * 3 + 2];
          points.push(new THREE.Vector3(x, y, z));
        }
        
        // Determine if curve is closed based on wrap type
        const isClosed = curveWrap === module.AbcCurvePeriodicity.kPeriodic;
        
        // Create our custom ABC curve
        const abcCurve = new ABCCurve(points, isClosed);
        
        // Generate points for visualization
        const curvePoints = abcCurve.getPointsForVisualization(50);
        
        // Create a Line to visualize the curve
        const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
        const material = new THREE.LineBasicMaterial({ 
          color: 0x00ff00,
          linewidth: 2
        });
        
        const curveName = `${iObj.getName()}_curve_${i}`;
        const line = new THREE.Line(geometry, material);
        line.name = curveName;
        
        // Also add points for debugging
        const pointsGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const pointsMaterial = new THREE.PointsMaterial({ 
          color: 0xff0000, 
          size: 0.1,
          sizeAttenuation: true
        });
        const pointsObject = new THREE.Points(pointsGeometry, pointsMaterial);
        pointsObject.name = `${curveName}_points`;
        
        // Add both the line and points to the parent
        parentObj.add(line);
        parentObj.add(pointsObject);
        
        // Update index for next curve
        currentIndex += numVertices;
      }
      positionsPtr.delete();
      curvesNumVerticesPtr.delete();
    } catch (error) {
      console.error('Error creating curve:', error);
    }
  }

  // Dispose method for cleanup
  dispose(): void {
    // Clean up any resources if necessary
    ABCLoader.wasmModule = null;
  }
}

// Export a default instance similar to other loaders
export default ABCLoader;