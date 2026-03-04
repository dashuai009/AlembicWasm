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

      if (point1 && point2) {
        point.lerpVectors(point1, point2, diff);
      } else {
        point.copy(this.points[0]); // fallback to first point
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
          point.copy(this.points[0]); // fallback to first point
        }
      } else {
        const point1 = positions[index];
        const point2 = positions[index + 1];
        if (point1 && point2) {
          point.lerpVectors(point1, point2, diff);
        } else {
          point.copy(this.points[0]); // fallback to first point
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
   * Enhanced method to animate mesh vertices over time
   * This version uses an alternative approach that directly works with the buffer and
   * traverses the hierarchy to find animated mesh objects
   */
  async getAnimatedMeshVertices(buffer: ArrayBuffer, topObjectHandle?: any): Promise<{ frames: Float32Array[], frameTimeInfo?: { start: number, end: number, fps: number } }> {
    const result: { frames: Float32Array[], frameTimeInfo?: { start: number, end: number, fps: number } } = { frames: [] };

    try {
      // Initialize WASM module
      const module = await ABCLoader.initWasmModule();

      if (!module) {
        throw new Error('WASM module not initialized');
      }

      console.log('Attempting to extract animated mesh vertices');

      // Use the buffer directly and traverse from top handle if it exists
      if (!topObjectHandle) {
        // If no handle provided, let our main parsing method initialize one
        const uint8Array = new Uint8Array(buffer);
        const vectorData = new module.VectorU8();

        vectorData.resize(uint8Array.length);
        for (let i = 0; i < uint8Array.length; i++) {
          vectorData.set(i, uint8Array[i]); // Use set instead of push_back to avoid memory reallocation
        }

        try {
          // Use AlembicObjectHandle with memory buffer to extract animated vertices
          let mem_buf = new module.MemoryBufferInputStream(vectorData);
          topObjectHandle = module.InitTopAlembicObject(mem_buf);
        } catch (e) {
          console.error('Error initializing Alembic object from buffer for animation extraction:', e);
        }

        // Clean up buffer resources here, but leave topObjectHandle for use below
        vectorData.delete();
      }

      if (topObjectHandle) {
        console.log('Found top object, attempting to extract animation data recursively');

        // Use a method similar to createObjectHierarchy to find animated mesh objects
        try {
          const animatedVerts = await this.extractAnimatedMeshVertices(topObjectHandle, module);
          if (animatedVerts && animatedVerts.length > 0) {
            result.frames = animatedVerts;
            console.log(`Found ${result.frames.length} animated frame sets`);
          }
        } catch (e) {
          console.error('Error during animated vertices extraction via hierarchical approach:', e);
        }

        // Note: Don't delete topObjectHandle here as it might be used by createObjectHierarchy later
      }

    } catch (error) {
      console.error("Error calling WASM getAnimatedMeshVertices function:", error);
    }

    if (result.frames.length === 0) {
      console.warn('No animated frames retrieved from WASM module. The .abc file might not contain vertex animations.');
    }

    return result;
  }

  /**
   * Recursive function to find mesh objects in the Alembic hierarchy and extract their animated vertices
   * This is a specialized helper function for animation data extraction
   */
  private async extractAnimatedMeshVertices(handle: any, module: any, depth: number = 0): Promise<Float32Array[]> {
    let allFrameSets: Float32Array[] = [];
    const maxDepth = 6;  // Prevent deep recursion causing stack overflow
    if (depth > maxDepth) return [];

    try {
      // Get object details
      const name = handle.getName() || 'unnamed';
      const schema = handle.getMetaDataSchema() || 'no_schema';
      const numChildren = handle.getNumChildren();

      console.log(`${'  '.repeat(depth)}Processing object ${name} [${schema}] with ${numChildren} children`);

      // Only try getting animation data if this object is PolyMesh schema
      if (schema.startsWith("AbcGeom_PolyMesh")) {
        console.log(`${'  '.repeat(depth)}Found PolyMesh schema, attempting to extract animated vertices`);
        // try {
        // Check if this mesh has animated data by examining if its position property is an array property
        // Only attempt to get animation if the schema has time-varying positions
        if (module.getAnimatedMeshVertices) {
          // Add timeout to handle potential freeze issues
          const animatedVerticesResult = module.getAnimatedMeshVertices(handle);

          if (animatedVerticesResult) {
            const numFrames = animatedVerticesResult.size();

            // Only continue if there are multiple frames implying animation
            if (numFrames > 1) {
              console.log(`${'  '.repeat(depth)}Successfully extracted ${numFrames} animated frames from mesh ${name}`);

              for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
                const frameData = animatedVerticesResult.get(frameIdx);
                const frameSize = frameData.size();

                if (frameSize > 0) {
                  const frameArray = new Float32Array(frameSize);
                  for (let j = 0; j < frameSize; j++) {
                    frameArray[j] = frameData.get(j);
                  }
                  allFrameSets.push(frameArray);
                }
              }
            } else if (numFrames === 1) {
              console.log(`${'  '.repeat(depth)}Found only 1 frame for mesh ${name}, skipping (not animated)`);
            } else {
              console.log(`${'  '.repeat(depth)}No frames found for mesh ${name}`);
            }
          } else {
            console.log(`${'  '.repeat(depth)}No animation data returned for mesh ${name}`);
          }
        }
        // } catch (err) {
        //   console.warn(`${'  '.repeat(depth)}Could not extract animation from mesh ${name}:`, (err as Error).message);
        //   // Continue processing even if this mesh fails
        // }
      }

      // Process child objects recursively
      for (let i = 0; i < numChildren; i++) {
        try {
          const child = handle.getChild(i);
          if (child) {
            // Add a small delay to avoid overwhelming the system
            const childFrames = await this.extractAnimatedMeshVertices(child, module, depth + 1);
            if (childFrames && childFrames.length > 0) {
              allFrameSets = allFrameSets.concat(childFrames);
              console.log(`${'  '.repeat(depth)}Added ${childFrames.length} frames from child ${i}`);
            }
          }
        } catch (err) {
          console.warn(`${'  '.repeat(depth)}Error processing child ${i} of ${name}:`, err);
          // Continue with other children
        }
      }

      console.log(`${'  '.repeat(depth)}Completed processing ${name}, found ${allFrameSets.length} frame sets`);
    } catch (e) {
      console.error(`Error in extractAnimatedMeshVertices for depth ${depth}:`, e);
    }

    return allFrameSets;
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

      // // Get detailed vertex data if available
      // const meshVertices = await this.getMeshVertices(buffer);
      // console.log(meshVertices)

      // Convert ArrayBuffer to Uint8Array
      const uint8Array = new Uint8Array(buffer);

      // Create the vector in WASM memory space
      const vectorData = new module.VectorU8();

      console.log(`the size of input file is ${uint8Array.length}`)
      // Add data to the vector
      for (let i = 0; i < uint8Array.length; i++) {
        vectorData.push_back(uint8Array[i]);
      }

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
          await this.createObjectHierarchy(topObjectHandle, 0, result, buffer);

          console.log("result = ", result);
        } else {
          console.error('Failed to initialize Alembic object from buffer');
        }

        // 在模型创建完成后初始化动画，如果之前创建了topObjectHandle，也传入用于动画数据
        await this.initializeAnimations(result, buffer, topObjectHandle);

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
    return result;
  }

  /**
   * Initialize animations after the hierarchy is built.
   * This function will be called after createObjectHierarchy finishes.
   */
  private async initializeAnimations(result: THREE.Group, buffer: ArrayBuffer, topObjectHandle?: any) {
    try {
      // 尝试获取完整的动画数据
      const allAnimationData = await this.getAnimatedMeshVertices(buffer, topObjectHandle);

      if (allAnimationData && allAnimationData.frames && allAnimationData.frames.length > 0) {
        console.log(`Successfully retrieved animation data with ${allAnimationData.frames.length} frames`);

        // 遍历场景图，并将动画数据应用到匹配的网格
        result.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.userData.abcObjectName) {
            // 为网格设置动画数据
            this.setupVertexAnimation(obj, allAnimationData);
          }
        });
      } else {
        console.log('No animation data found in the ABC file');
      }
    } catch (e) {
      console.error('Error initializing animations:', (e as Error).message);
      // 即使动画数据不可用，我们仍保持网格上的基础动画数据结构
    }
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
  private async createObjectHierarchy(handle: any, depth: number, parentObj: THREE.Object3D, buffer?: ArrayBuffer): Promise<void> {

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
          await this.createObjectHierarchy(child_i, depth + 1, geo, buffer);
          let xform = module.xformGetMatrix(child_i);
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
          let vertices = module.get_mesh_vertices(child_i);
          // 将 WASM 返回的顶点数据转换为 Float32Array
          const vertexCount = vertices.size();
          let positionArray: Float32Array | null = null;
          if (vertexCount > 0) {
            positionArray = new Float32Array(vertexCount);
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
          mesh.name = child_i.getName();

          // 初始化动画相关用户数据
          mesh.userData.abcObjectName = child_i.getName();
          mesh.userData.originalPositions = positionArray ? new Float32Array(positionArray) : null; // 保存原始顶点
          mesh.userData.isPlaying = false; // 初始状态为停止播放

          parentObj.add(mesh);
          await this.createObjectHierarchy(child_i, depth + 1, mesh, buffer);
        } else if (child_i_schema.startsWith("AbcGeom_Camera")) {
          let cam = await this.createCamera(child_i);
          cam.name = child_i.getName();
          parentObj.add(cam);
          await this.createObjectHierarchy(child_i, depth + 1, cam, buffer);
        } else if (child_i_schema === "AbcGeom_Curve_v2") {
          // Handle Alembic Curve_v2 schema
          await this.createCurve(child_i, parentObj);
          await this.createObjectHierarchy(child_i, depth + 1, parentObj, buffer);
        } else {
          console.log("unhandled mesh", child_i.getMetaDataSchema());
        }
      } catch (error) {
        console.error(`${indent}  - Error getting child ${i}:`, error);
      }
    }
  }

  // This function is used to set up vertex animations for meshes
  private setupVertexAnimation(mesh: THREE.Mesh, animationData: { frames: Float32Array[], frameTimeInfo?: { start: number, end: number, fps: number } }) {
    if (!animationData || !animationData.frames || animationData.frames.length === 0) return;

    try {
      const animationFrames = animationData.frames;

      // 将动画帧存储在网格的用户数据中，以便稍后在动画循环中使用
      mesh.userData.animationFrames = animationFrames;
      mesh.userData.currentFrame = 0;
      mesh.userData.totalFrames = animationFrames.length;

      // 添加动画元数据
      mesh.userData.startTime = animationData.frameTimeInfo?.start || 0;
      mesh.userData.endTime = animationData.frameTimeInfo?.end || animationFrames.length - 1;
      mesh.userData.fps = animationData.frameTimeInfo?.fps || 24; // 默认24fps
      mesh.userData.animationDuration = mesh.userData.totalFrames / mesh.userData.fps;  // 动画总时长（秒）

      mesh.userData.isPlaying = true;
      mesh.userData.isPaused = false;
      mesh.userData.animationStartTime = Date.now(); // 动画开始时间戳
      mesh.userData.animationCurrentTime = 0; // 当前动画时间（秒）

      // 存储原始位置用于插值计算
      mesh.userData.originalPositions = (mesh.geometry as THREE.BufferGeometry).getAttribute('position').clone();

      // 初始化插值相关数据
      mesh.userData.currentVertices = new Float32Array(mesh.userData.originalPositions.array as Float32Array);
      mesh.userData.nextFrameIndex = 1;
      mesh.userData.interpolationFactor = 0.0;

      console.log(`Setup animation with ${animationFrames.length} frames for ${mesh.name}, duration: ${mesh.userData.animationDuration}s at ${mesh.userData.fps}fps`);
    } catch (error) {
      console.error('Error setting up vertex animation:', error);
    }
  }
  public applyAnimationAtTime(mesh: THREE.Mesh, timeSec: number) {
    const frames: ArrayLike<number>[] | undefined = mesh.userData.animationFrames;
    if (!frames || frames.length <= 1) return;

    const fps = mesh.userData.fps ?? 24;
    const totalFrames = frames.length;

    // 如果你有 duration，用它循环；没有就按 totalFrames/fps
    const duration = mesh.userData.animationDuration ?? (totalFrames / fps);
    const t = duration > 0 ? (timeSec % duration) : timeSec;

    const frameTime = t * fps;           // 连续帧
    const i0 = Math.floor(frameTime) % totalFrames;
    const i1 = (i0 + 1) % totalFrames;
    const a = frameTime - Math.floor(frameTime);

    const f0 = frames[i0];
    const f1 = frames[i1];

    const geom = mesh.geometry as THREE.BufferGeometry;
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    const dst = posAttr.array as Float32Array;

    if (!f0 || !f1 || f0.length !== dst.length || f1.length !== dst.length) return;

    for (let k = 0; k < dst.length; k++) {
      dst[k] = f0[k] + (f1[k] - f0[k]) * a;
    }
    posAttr.needsUpdate = true;
  }

  public applyAnimationFrame(mesh: THREE.Mesh, deltaTime: number) {
    const frames: ArrayLike<number>[] | undefined = mesh.userData.animationFrames;
    if (!frames || frames.length <= 1) return;
    if (mesh.userData.isPlaying === false) return;

    const totalFrames = frames.length;
    const fps = mesh.userData.fps ?? 24;
    const duration = mesh.userData.animationDuration ?? (totalFrames / fps);

    // 累计时间 + 循环
    let t = (mesh.userData.animationCurrentTime ?? 0) + deltaTime;
    if (duration > 0) t = t % duration;
    mesh.userData.animationCurrentTime = t;

    const timePerFrame = 1 / fps;
    const frameTime = t / timePerFrame;             // 连续帧索引（带小数）
    const i0 = Math.floor(frameTime) % totalFrames; // 当前帧
    const i1 = (i0 + 1) % totalFrames;              // 下一帧
    const a = frameTime - Math.floor(frameTime);    // 插值因子 [0,1)

    const f0 = frames[i0];
    const f1 = frames[i1] ?? f0;

    const geometry = mesh.geometry as THREE.BufferGeometry;
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!posAttr) return;

    // 直接对底层 array 写入（最快、最稳定）
    const dst = posAttr.array as Float32Array;

    // 强一致性检查：必须完全一致，否则就会出现“部分顶点没更新=残留”
    if (!f0 || f0.length !== dst.length || !f1 || f1.length !== dst.length) {
      console.error(
        `[ABC] frame size mismatch on mesh=${mesh.name}`,
        { f0: f0?.length, f1: f1?.length, dst: dst.length }
      );
      return;
    }

    // 插值写满整个 position buffer
    for (let k = 0; k < dst.length; k++) {
      const v0 = f0[k];
      const v1 = f1[k];
      dst[k] = v0 + (v1 - v0) * a;
    }

    posAttr.needsUpdate = true;

    // 法线：每帧重算非常耗，建议降频或改为更新 normal attribute
    const normalEveryN = mesh.userData.normalEveryN ?? 0; // 0=不重算；例如 2/4/8 降频
    if (normalEveryN > 0) {
      const nCount = (mesh.userData._normalCounter ?? 0) + 1;
      mesh.userData._normalCounter = nCount;
      if (nCount % normalEveryN === 0) {
        geometry.computeVertexNormals();
        const nAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
        if (nAttr) nAttr.needsUpdate = true;
      }
    }

    // 如果你遇到裁剪异常（不是残影），再打开它
    // geometry.computeBoundingSphere();

    mesh.userData.currentFrame = i0;
    mesh.userData.nextFrameIndex = i1;
    mesh.userData.interpolationFactor = a;
  }


  // 设置动画播放状态
  public setAnimationPlaying(mesh: THREE.Mesh, isPlaying: boolean) {
    mesh.userData.isPlaying = isPlaying;
    if (isPlaying) {
      mesh.userData.animationStartTime = Date.now();
    }
  }

  // 设置动画播放速度
  public setAnimationSpeed(mesh: THREE.Mesh, speed: number) {
    mesh.userData.animationSpeed = speed;
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