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
  }

  getPoint(t: number, optionalTarget?: THREE.Vector3): THREE.Vector3 {
    const point = optionalTarget || new THREE.Vector3();

    if (this.points.length === 0) {
      point.set(0, 0, 0);
      return point;
    }

    if (this.points.length === 1) {
      point.copy(this.points[0]!);
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

      if (point1 && point2) {
        point.lerpVectors(point1, point2, diff);
      } else {
        point.copy(this.points[0]!); // fallback to first point
      }
    } else {
      // For open curves
      const scaledT = t * (len - 1);
      const index = Math.floor(scaledT);
      const diff = scaledT - index;

      if (index >= len - 1) {
        const lastPoint = positions[len - 1];
        if (lastPoint) {
          point.copy(lastPoint);
        } else {
          point.copy(this.points[0]!); // fallback to first point
        }
      } else {
        const point1 = positions[index];
        const point2 = positions[index + 1];
        if (point1 && point2) {
          point.lerpVectors(point1, point2, diff);
        } else {
          point.copy(this.points[0]!); // fallback to first point
        }
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
    return await this.parseDetailedGeometry(buffer);
  }

  private readonly defaultAnimationFps = 24;

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

    // Create the vector in WASM memory space with pre-allocation to avoid memory fragmentation
    const vectorData = new module.VectorU8();

    // Pre-allocate with the size we need
    vectorData.resize(uint8Array.length);

    // Set data to the pre-allocated vector
    for (let i = 0; i < uint8Array.length; i++) {
      vectorData.set(i, uint8Array[i]); // Use set instead of push_back to avoid memory reallocation
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
    const animationClips: THREE.AnimationClip[] = [];

    // First try the enhanced geometric parsing if possible
    try {
      let t0 = performance.now();
      // Initialize WASM module
      const module = await ABCLoader.initWasmModule();
      let t1 = performance.now();

      if (!module) {
        throw new Error('WASM module not initialized');
      }

      // // Get detailed vertex data if available
      // const meshVertices = await this.getMeshVertices(buffer);
      // console.log(meshVertices)

      // Convert ArrayBuffer to Uint8Array
      const uint8Array = new Uint8Array(buffer);
      let t2 = performance.now();

      const ptr = module._malloc(uint8Array.length);
      module.HEAPU8.set(uint8Array, ptr); // 一次性拷贝（内部是 memcpy 级别）
      // Create the vector in WASM memory space
      const vectorData = new module.CreateU8VectorFromPtr(ptr, uint8Array.length);
      module._free(ptr);
      let t3 = performance.now();
      let t4 = performance.now();
      console.log(`init wasm module: ${t1 - t0}ms, convert arraybuffer to uint8array: ${t2 - t1}ms, create vector: ${t3 - t2}ms, set data: ${t4 - t3}ms`)

      {
        // tmp scope
        let mem_buf = new module.MemoryBufferInputStream(vectorData);
        // topObjectHandle 为wasm导出的对象，存在引用mem_buf的指针，
        // 此类IObj对象的生命周期不应该超过他需要的数据buffer
        let topObjectHandle = module.InitTopAlembicObject(mem_buf);

        if (topObjectHandle) {
          console.log('Top object name:', topObjectHandle.getName());
          console.log('Top object full name:', topObjectHandle.getFullName());
          console.log('Top object schema:', topObjectHandle.getMetaDataSchema());
          console.log('Number of children:', topObjectHandle.getNumChildren());

          // Get complete hierarchy from WASM using the recursive C++ function
          console.log('=== ALEMBIC HIERARCHY ===');
          result.name = topObjectHandle.getName();
          this.createObjectHierarchy(module, topObjectHandle, 0, result, animationClips, buffer);

          console.log("result = ", result);
        } else {
          console.error('Failed to initialize Alembic object from buffer');
        }

        // Clean up
        mem_buf.delete();
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
    result.animations = animationClips;
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

    // Create the vector in WASM memory space with pre-allocation to avoid memory fragmentation
    const vectorData = new module.VectorU8();

    // Pre-allocate with the size we need
    vectorData.resize(uint8Array.length);

    // Set data to the pre-allocated vector
    for (let i = 0; i < uint8Array.length; i++) {
      vectorData.set(i, uint8Array[i]); // Use set instead of push_back to avoid memory reallocation
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


  private createCamera(alembicWasmModule: any, iObj: any): THREE.PerspectiveCamera {
    // Wrap the IObject as ICamera
    const iCamera = alembicWasmModule.WrapCamera(iObj);
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
  private createObjectHierarchy(
    alembicWasmModule: any,
    handle: any,
    depth: number,
    parentObj: THREE.Object3D,
    animationClips: THREE.AnimationClip[],
    buffer?: ArrayBuffer
  ): void {

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
          this.createObjectHierarchy(alembicWasmModule, child_i, depth + 1, geo, animationClips, buffer);
          let xform = alembicWasmModule.xformGetMatrix(child_i);
          if (xform) {
            let newXform = new THREE.Matrix4();
            newXform.fromArray(xform.getValueView());
            geo.position.setFromMatrixPosition(newXform);
            geo.rotation.setFromRotationMatrix(newXform);
            geo.scale.setFromMatrixScale(newXform);
          }
          geo.name = child_i.getName();
        } else if (child_i_schema.startsWith("AbcGeom_PolyMesh")) {
          let geo = new THREE.BufferGeometry();
          let vertices = alembicWasmModule.get_mesh_vertices(child_i);
          // 将 WASM 返回的顶点数据转换为 Float32Array
          const vertexCount = vertices.size();
          let positionArray: Float32Array | null = null;
          if (vertexCount > 0) {
            positionArray = new Float32Array(vertices.view());

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
          mesh.name = child_i.getName();

          const vertexCacheClip = this.createVertexCacheAnimationClip(
            child_i,
            mesh
          );
          if (vertexCacheClip) {
            mesh.userData.animationClips = [vertexCacheClip];
            animationClips.push(vertexCacheClip);
          }

          parentObj.add(mesh);
          this.createObjectHierarchy(alembicWasmModule, child_i, depth + 1, mesh, animationClips, buffer);
        } else if (child_i_schema.startsWith("AbcGeom_Camera")) {
          let cam = this.createCamera(alembicWasmModule, child_i);
          cam.name = child_i.getName();
          parentObj.add(cam);
          this.createObjectHierarchy(alembicWasmModule, child_i, depth + 1, cam, animationClips, buffer);
        } else if (child_i_schema === "AbcGeom_Curve_v2") {
          // Handle Alembic Curve_v2 schema
          this.createCurve(alembicWasmModule, child_i, parentObj);
          this.createObjectHierarchy(alembicWasmModule, child_i, depth + 1, parentObj, animationClips, buffer);
        } else {
          console.log("unhandled mesh", child_i.getMetaDataSchema());
        }
      } catch (error) {
        console.error(`${indent}  - Error getting child ${i}:`, error);
      }
    }
  }

  private createVertexCacheAnimationClip(handle: any, mesh: THREE.Mesh): THREE.AnimationClip | null {
    const module = ABCLoader.wasmModule;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const basePositionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;

    if (!module || !basePositionAttr) {
      return null;
    }

    const animatedFrames = module.getAnimatedMeshVertices(handle);
    const frameCount = animatedFrames?.size?.() ?? 0;
    if (frameCount <= 1) {
      return null;
    }

    const vertexValueCount = basePositionAttr.array.length;
    const morphTargets: THREE.BufferAttribute[] = [];

    for (let i = 0; i < frameCount; i++) {
      const frame = animatedFrames.get(i);
      const frameValueCount = frame?.size?.() ?? 0;
      if (frameValueCount !== vertexValueCount) {
        console.warn(
          `[ABC] Skip animation for ${mesh.name}: frame size mismatch (${frameValueCount} vs ${vertexValueCount})`
        );
        return null;
      }

      const values = new Float32Array(frame.view());

      const morph = new THREE.BufferAttribute(values, 3);
      morph.name = `abc_morph_${i}`;
      morphTargets.push(morph);
    }

    geometry.morphAttributes.position = morphTargets;
    mesh.updateMorphTargets();

    const times = new Float32Array(frameCount);
    const weights = new Float32Array(frameCount * frameCount);
    const fps = this.defaultAnimationFps;
    for (let i = 0; i < frameCount; i++) {
      times[i] = i / fps;
      weights[(frameCount * i) + i] = 1;
    }

    const track = new THREE.NumberKeyframeTrack('.morphTargetInfluences', times, weights);
    const duration = times[times.length - 1] ?? 0;
    return new THREE.AnimationClip(`${mesh.name || 'abc_mesh'}_vertex_cache`, duration, [track]);
  }

  /**
   * Create Three.js curve objects from Alembic curve data
   * @param iObj - The Alembic IObject representing the curve
   * @param parentObj - The parent Three.js object to attach the curve to
   */
  private createCurve(alembicWasmModule: any, iObj: any, parentObj: THREE.Object3D): void {
    try {
      // Wrap the IObject as ICurves
      const iCurves = alembicWasmModule.WrapCurves(iObj);
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
      const curveWrap = curveSample.getWrap();

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
        const isClosed = curveWrap === alembicWasmModule.AbcCurvePeriodicity.kPeriodic;

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
