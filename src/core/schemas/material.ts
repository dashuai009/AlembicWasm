import type {
  AlembicWasmModule,
  IMaterialWrap,
  IObjectWrap,
  MaterialFlattenWrap,
  OMaterialWrap,
  RawFlattenedMaterialNodeInfo,
  RawMaterialInterfaceMapping,
  RawMaterialNodeConnection,
  RawMaterialNodeInfo,
  RawMaterialTerminalInfo,
} from "../../wasm/bindings.js";
import { getAlembicModule } from "../../wasm/loader.js";
import { callWasm } from "../errors.js";
import { normalizeMetaData, type MetaDataMap } from "../metadata.js";
import { ICompoundProperty, OCompoundProperty } from "../properties.js";
import { IObject, OObject } from "../object.js";

export type MaterialNodeConnection = RawMaterialNodeConnection;
export type MaterialTerminalInfo = RawMaterialTerminalInfo;
export type MaterialInterfaceMapping = RawMaterialInterfaceMapping;

export interface MaterialNetworkNode {
  name: string;
  target: string;
  nodeType: string;
  parameters: ICompoundProperty | null;
  connections: MaterialNodeConnection[];
}

export interface FlattenedShaderParamEntry {
  name: string;
  properties: ICompoundProperty;
}

export interface FlattenedMaterialNetworkNode {
  name: string;
  target: string;
  nodeType: string;
  parameters: FlattenedShaderParamEntry[];
  connections: MaterialNodeConnection[];
}

function mapRawNode(mod: AlembicWasmModule, raw: RawMaterialNodeInfo): MaterialNetworkNode {
  return {
    name: raw.name,
    target: raw.target,
    nodeType: raw.nodeType,
    parameters: raw.parameters ? new ICompoundProperty(raw.parameters, mod) : null,
    connections: raw.connections,
  };
}

function mapRawFlattenedNode(
  mod: AlembicWasmModule,
  raw: RawFlattenedMaterialNodeInfo
): FlattenedMaterialNetworkNode {
  return {
    name: raw.name,
    target: raw.target,
    nodeType: raw.nodeType,
    parameters: raw.parameters.map((entry) => ({
      name: entry.name,
      properties: new ICompoundProperty(entry.parent, mod),
    })),
    connections: raw.connections,
  };
}

export class IMaterial implements Disposable {
  readonly kind = "Material" as const;
  readonly object: IObject | null;
  readonly handle: IMaterialWrap;
  private readonly mod: AlembicWasmModule;

  constructor(objectOrWrap: IObject | IObjectWrap | IMaterialWrap, mod = getAlembicModule()) {
    this.mod = mod;
    if (objectOrWrap instanceof IObject) {
      this.object = objectOrWrap;
      this.handle = callWasm(mod, () => new mod.IMaterialWrap(objectOrWrap.handle));
    } else if ("getSchemaType" in objectOrWrap) {
      this.object = new IObject(objectOrWrap, mod);
      this.handle = callWasm(mod, () => new mod.IMaterialWrap(objectOrWrap));
    } else {
      this.object = null;
      this.handle = objectOrWrap;
    }
  }

  get valid(): boolean {
    return callWasm(this.mod, () => this.handle.valid());
  }

  getTargetNames(): string[] {
    return callWasm(this.mod, () => this.handle.getTargetNames());
  }

  getShaderTypesForTarget(target: string): string[] {
    return callWasm(this.mod, () => this.handle.getShaderTypesForTarget(target));
  }

  getShader(target: string, shaderType: string): string {
    return callWasm(this.mod, () => this.handle.getShader(target, shaderType));
  }

  getShaderParameters(target: string, shaderType: string): ICompoundProperty | null {
    const raw = callWasm(this.mod, () => this.handle.getShaderParameters(target, shaderType));
    return raw ? new ICompoundProperty(raw, this.mod) : null;
  }

  get numNetworkNodes(): number {
    return callWasm(this.mod, () => this.handle.getNumNetworkNodes());
  }

  getNetworkNodeNames(): string[] {
    return callWasm(this.mod, () => this.handle.getNetworkNodeNames());
  }

  getNetworkNode(nodeName: string): MaterialNetworkNode | null {
    const raw = callWasm(this.mod, () => this.handle.getNetworkNodeInfo(nodeName));
    return raw ? mapRawNode(this.mod, raw) : null;
  }

  getNetworkTerminalTargetNames(): string[] {
    return callWasm(this.mod, () => this.handle.getNetworkTerminalTargetNames());
  }

  getNetworkTerminalShaderTypesForTarget(target: string): string[] {
    return callWasm(this.mod, () => this.handle.getNetworkTerminalShaderTypesForTarget(target));
  }

  getNetworkTerminal(target: string, shaderType: string): MaterialTerminalInfo | null {
    return callWasm(this.mod, () => this.handle.getNetworkTerminal(target, shaderType));
  }

  getNetworkInterfaceParameters(): ICompoundProperty | null {
    const raw = callWasm(this.mod, () => this.handle.getNetworkInterfaceParameters());
    return raw ? new ICompoundProperty(raw, this.mod) : null;
  }

  getNetworkInterfaceParameterMappings(): MaterialInterfaceMapping[] {
    return callWasm(this.mod, () => this.handle.getNetworkInterfaceParameterMappings());
  }

  flatten(): FlattenedMaterial {
    const flatWrap = callWasm(this.mod, () => this.mod.flattenMaterialSchema(this.handle));
    return new FlattenedMaterial(flatWrap, this.mod);
  }

  dispose(): void {
    if (!this.handle.isDeleted()) {
      this.handle.delete();
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

export class FlattenedMaterial implements Disposable {
  readonly handle: MaterialFlattenWrap;
  private readonly mod: AlembicWasmModule;

  constructor(handle: MaterialFlattenWrap, mod = getAlembicModule()) {
    this.handle = handle;
    this.mod = mod;
  }

  get empty(): boolean {
    return callWasm(this.mod, () => this.handle.empty());
  }

  getTargetNames(): string[] {
    return callWasm(this.mod, () => this.handle.getTargetNames());
  }

  getShaderTypesForTarget(target: string): string[] {
    return callWasm(this.mod, () => this.handle.getShaderTypesForTarget(target));
  }

  getShader(target: string, shaderType: string): string {
    return callWasm(this.mod, () => this.handle.getShader(target, shaderType));
  }

  getShaderParametersList(target: string, shaderType: string): FlattenedShaderParamEntry[] {
    const list = callWasm(this.mod, () => this.handle.getShaderParametersList(target, shaderType));
    return list.map((entry) => ({
      name: entry.name,
      properties: new ICompoundProperty(entry.parent, this.mod),
    }));
  }

  getNetworkTerminalTargetNames(): string[] {
    return callWasm(this.mod, () => this.handle.getNetworkTerminalTargetNames());
  }

  getNetworkTerminalShaderTypesForTarget(target: string): string[] {
    return callWasm(this.mod, () => this.handle.getNetworkTerminalShaderTypesForTarget(target));
  }

  getNetworkTerminal(target: string, shaderType: string): MaterialTerminalInfo | null {
    return callWasm(this.mod, () => this.handle.getNetworkTerminal(target, shaderType));
  }

  get numNetworkNodes(): number {
    return callWasm(this.mod, () => this.handle.getNumNetworkNodes());
  }

  getNetworkNodeByIndex(index: number): FlattenedMaterialNetworkNode | null {
    const raw = callWasm(this.mod, () => this.handle.getNetworkNodeByIndex(index));
    return raw ? mapRawFlattenedNode(this.mod, raw) : null;
  }

  dispose(): void {
    if (!this.handle.isDeleted()) {
      this.handle.delete();
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

export class OMaterial implements Disposable {
  readonly handle: OMaterialWrap;
  private readonly mod: AlembicWasmModule;

  constructor(
    parentOrWrap: OObject | OMaterialWrap,
    name?: string,
    metaData?: MetaDataMap,
    mod = getAlembicModule()
  ) {
    this.mod = mod;
    if (parentOrWrap instanceof OObject) {
      this.handle = callWasm(mod, () =>
        mod.createOMaterial(parentOrWrap.handle, name ?? "material", normalizeMetaData(metaData))
      );
    } else {
      this.handle = parentOrWrap;
    }
  }

  get object(): OObject | null {
    const raw = callWasm(this.mod, () => this.handle.getObject());
    return raw ? new OObject(raw, this.mod) : null;
  }

  setShader(target: string, shaderType: string, shaderName: string): void {
    callWasm(this.mod, () => this.handle.setShader(target, shaderType, shaderName));
  }

  getShaderParameters(target: string, shaderType: string): OCompoundProperty {
    return new OCompoundProperty(
      callWasm(this.mod, () => this.handle.getShaderParameters(target, shaderType)),
      this.mod
    );
  }

  addNetworkNode(nodeName: string, target: string, nodeType: string): void {
    callWasm(this.mod, () => this.handle.addNetworkNode(nodeName, target, nodeType));
  }

  setNetworkNodeConnection(
    nodeName: string,
    inputName: string,
    connectedNodeName: string,
    connectedOutputName: string
  ): void {
    callWasm(this.mod, () =>
      this.handle.setNetworkNodeConnection(
        nodeName,
        inputName,
        connectedNodeName,
        connectedOutputName
      )
    );
  }

  getNetworkNodeParameters(nodeName: string): OCompoundProperty {
    return new OCompoundProperty(
      callWasm(this.mod, () => this.handle.getNetworkNodeParameters(nodeName)),
      this.mod
    );
  }

  setNetworkTerminal(target: string, shaderType: string, nodeName: string, outputName: string): void {
    callWasm(this.mod, () =>
      this.handle.setNetworkTerminal(target, shaderType, nodeName, outputName)
    );
  }

  setNetworkInterfaceParameterMapping(
    interfaceParamName: string,
    mapToNodeName: string,
    mapToParamName: string
  ): void {
    callWasm(this.mod, () =>
      this.handle.setNetworkInterfaceParameterMapping(
        interfaceParamName,
        mapToNodeName,
        mapToParamName
      )
    );
  }

  getNetworkInterfaceParameters(): OCompoundProperty {
    return new OCompoundProperty(
      callWasm(this.mod, () => this.handle.getNetworkInterfaceParameters()),
      this.mod
    );
  }

  dispose(): void {
    if (!this.handle.isDeleted()) {
      this.handle.delete();
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

export function assignMaterial(target: OObject, materialFullPath: string): void {
  const mod = getAlembicModule();
  callWasm(mod, () => mod.assignMaterialToObject(target.handle, materialFullPath));
}

export function addLocalMaterial(target: OObject): OMaterial {
  const mod = getAlembicModule();
  const wrap = callWasm(mod, () => mod.addLocalMaterialToObject(target.handle));
  return new OMaterial(wrap, undefined, undefined, mod);
}

export function getMaterialAssignmentPath(target: IObject): string | null {
  const mod = getAlembicModule();
  const path = callWasm(mod, () => mod.getObjectMaterialAssignmentPath(target.handle));
  return path.length > 0 ? path : null;
}

export function getLocalMaterial(target: IObject): IMaterial | null {
  const mod = getAlembicModule();
  const wrap = callWasm(mod, () => mod.getObjectLocalMaterial(target.handle));
  return wrap ? new IMaterial(wrap, mod) : null;
}

export function flattenObjectMaterial(target: IObject): FlattenedMaterial {
  const mod = getAlembicModule();
  const wrap = callWasm(mod, () => mod.flattenObjectMaterial(target.handle));
  return new FlattenedMaterial(wrap, mod);
}
