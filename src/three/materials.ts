import * as THREE from "three";
import {
  FlattenedMaterial,
  ICompoundProperty,
  IMaterial,
  OMaterial,
  PlainOldDataType,
  type SampleSelectorInput,
} from "../index.js";

export interface ExtractedPbrParams {
  name?: string;
  color: [number, number, number];
  emissive: [number, number, number];
  roughness: number;
  metalness: number;
  opacity: number;
  ior: number;
  doubleSided: boolean;
  wireframe: boolean;
}

const DEFAULT_PBR: ExtractedPbrParams = {
  color: [0.78, 0.8, 0.84],
  emissive: [0, 0, 0],
  roughness: 0.45,
  metalness: 0.08,
  opacity: 1.0,
  ior: 1.5,
  doubleSided: false,
  wireframe: false,
};

function readFloatTuple(
  compound: ICompoundProperty,
  names: readonly string[],
  selector?: SampleSelectorInput
): number[] | null {
  for (const propName of names) {
    if (!compound.hasProperty(propName)) {
      continue;
    }
    const hdr = compound.getHeader(propName);
    if (!hdr) {
      continue;
    }
    if (hdr.isScalar) {
      const prop = compound.getScalar(propName);
      try {
        const samp = prop.getSample(selector);
        if (samp instanceof Float32Array || samp instanceof Float64Array) {
          return Array.from(samp);
        }
        if (Array.isArray(samp) && typeof samp[0] === "boolean") {
          return samp.map((b) => (b ? 1 : 0));
        }
        if (ArrayBuffer.isView(samp)) {
          return Array.from(samp as unknown as ArrayLike<number | bigint>, (v) => Number(v));
        }
      } finally {
        prop.dispose();
      }
    } else if (hdr.isArray) {
      const prop = compound.getArray(propName);
      try {
        const samp = prop.getSample(selector);
        if (samp instanceof Float32Array || samp instanceof Float64Array) {
          return Array.from(samp);
        }
      } finally {
        prop.dispose();
      }
    }
  }
  return null;
}

function applyCompoundToPbr(
  compound: ICompoundProperty,
  out: ExtractedPbrParams,
  selector?: SampleSelectorInput
): void {
  const baseColor = readFloatTuple(
    compound,
    ["baseColor", "diffuseColor", "Kd", "color", "base_color", "albedo"],
    selector
  );
  if (baseColor && baseColor.length >= 3) {
    out.color = [baseColor[0]!, baseColor[1]!, baseColor[2]!];
    if (baseColor.length >= 4 && Number.isFinite(baseColor[3])) {
      out.opacity = baseColor[3]!;
    }
  }

  const emissive = readFloatTuple(
    compound,
    ["emissiveColor", "emissionColor", "emission_color", "emissive", "Ke"],
    selector
  );
  if (emissive && emissive.length >= 3) {
    out.emissive = [emissive[0]!, emissive[1]!, emissive[2]!];
  }

  const roughness = readFloatTuple(
    compound,
    ["roughness", "specularRoughness", "specular_roughness", "coatRoughness"],
    selector
  );
  if (roughness && roughness.length >= 1) {
    out.roughness = clamp01(roughness[0]!);
  }

  const metalness = readFloatTuple(
    compound,
    ["metallic", "metalness", "metal"],
    selector
  );
  if (metalness && metalness.length >= 1) {
    out.metalness = clamp01(metalness[0]!);
  }

  const opacity = readFloatTuple(compound, ["opacity", "alpha", "presence"], selector);
  if (opacity && opacity.length >= 1) {
    out.opacity = clamp01(opacity[0]!);
  } else {
    const transmission = readFloatTuple(compound, ["transmission", "transparency"], selector);
    if (transmission && transmission.length >= 1) {
      out.opacity = clamp01(1 - transmission[0]!);
    }
  }

  const ior = readFloatTuple(compound, ["ior", "specularIOR", "specular_IOR"], selector);
  if (ior && ior.length >= 1 && ior[0]! > 0) {
    out.ior = ior[0]!;
  }

  const doubleSided = readFloatTuple(compound, ["doubleSided", "twoSided"], selector);
  if (doubleSided && doubleSided.length >= 1) {
    out.doubleSided = doubleSided[0]! !== 0;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function extractPbrParamsFromFlattened(
  flat: FlattenedMaterial,
  selector?: SampleSelectorInput
): ExtractedPbrParams | null {
  if (flat.empty) {
    return null;
  }
  const out: ExtractedPbrParams = {
    ...DEFAULT_PBR,
    color: [...DEFAULT_PBR.color],
    emissive: [...DEFAULT_PBR.emissive],
  };

  let matched = false;
  for (const target of flat.getTargetNames()) {
    for (const shaderType of flat.getShaderTypesForTarget(target)) {
      const entries = flat.getShaderParametersList(target, shaderType);
      if (entries.length > 0) {
        matched = true;
        // Apply from lowest-priority entry to highest-priority (index 0 in MaterialFlatten wins)
        for (let i = entries.length - 1; i >= 0; i--) {
          applyCompoundToPbr(entries[i]!.properties, out, selector);
        }
        for (const e of entries) {
          e.properties.dispose();
        }
      }
    }
  }

  const nodeCount = flat.numNetworkNodes;
  for (let i = 0; i < nodeCount; i++) {
    const node = flat.getNetworkNodeByIndex(i);
    if (node && node.parameters.length > 0) {
      matched = true;
      for (let j = node.parameters.length - 1; j >= 0; j--) {
        applyCompoundToPbr(node.parameters[j]!.properties, out, selector);
      }
      for (const e of node.parameters) {
        e.properties.dispose();
      }
    }
  }

  return matched ? out : null;
}

export function extractPbrParamsFromIMaterial(
  mat: IMaterial,
  selector?: SampleSelectorInput
): ExtractedPbrParams {
  const flat = mat.flatten();
  try {
    const fromFlat = extractPbrParamsFromFlattened(flat, selector);
    if (fromFlat) {
      fromFlat.name = mat.object?.name;
      return fromFlat;
    }
  } finally {
    flat.dispose();
  }

  const out: ExtractedPbrParams = {
    ...DEFAULT_PBR,
    name: mat.object?.name,
    color: [...DEFAULT_PBR.color],
    emissive: [...DEFAULT_PBR.emissive],
  };

  for (const target of mat.getTargetNames()) {
    for (const shaderType of mat.getShaderTypesForTarget(target)) {
      const params = mat.getShaderParameters(target, shaderType);
      if (params) {
        applyCompoundToPbr(params, out, selector);
        params.dispose();
      }
    }
  }
  return out;
}

export function buildThreeMaterialFromPbr(
  params: ExtractedPbrParams,
  options?: { hasVertexColors?: boolean; doubleSided?: boolean }
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    name: params.name ?? "",
    color: new THREE.Color(params.color[0], params.color[1], params.color[2]),
    emissive: new THREE.Color(params.emissive[0], params.emissive[1], params.emissive[2]),
    roughness: params.roughness,
    metalness: params.metalness,
    opacity: params.opacity,
    transparent: params.opacity < 0.999,
    vertexColors: options?.hasVertexColors ?? false,
    side:
      (options?.doubleSided ?? params.doubleSided) ? THREE.DoubleSide : THREE.FrontSide,
  });
  return mat;
}

/**
 * Serializes a Three.js Material into an Alembic `OMaterial` using `usdPreviewSurface`
 * conventions so Maya, Houdini, Blender, Unreal, and `ABCLoader` all read PBR properties cleanly.
 */
export function writeThreeMaterialToOMaterial(
  source: THREE.Material,
  target: OMaterial,
  timeSamplingIndex = 0
): void {
  target.setShader("universal", "surface", "UsdPreviewSurface");
  const params = target.getShaderParameters("universal", "surface");
  try {
    const std = source as Partial<THREE.MeshStandardMaterial & THREE.MeshBasicMaterial>;
    const c = std.color ?? new THREE.Color(0.8, 0.8, 0.8);
    const e = std.emissive ?? new THREE.Color(0, 0, 0);
    const roughness = typeof std.roughness === "number" ? std.roughness : 0.5;
    const metalness = typeof std.metalness === "number" ? std.metalness : 0.0;
    const opacity = typeof source.opacity === "number" ? source.opacity : 1.0;
    const doubleSided = source.side === THREE.DoubleSide;

    const baseColorProp = params.createScalar("diffuseColor", PlainOldDataType.Float32, {
      extent: 3,
      interpretation: "rgb",
      timeSamplingIndex,
    });
    baseColorProp.setSample([c.r, c.g, c.b]);
    baseColorProp.dispose();

    const emissiveProp = params.createScalar("emissiveColor", PlainOldDataType.Float32, {
      extent: 3,
      interpretation: "rgb",
      timeSamplingIndex,
    });
    emissiveProp.setSample([e.r, e.g, e.b]);
    emissiveProp.dispose();

    const roughProp = params.createScalar("roughness", PlainOldDataType.Float32, {
      timeSamplingIndex,
    });
    roughProp.setSample(roughness);
    roughProp.dispose();

    const metalProp = params.createScalar("metallic", PlainOldDataType.Float32, {
      timeSamplingIndex,
    });
    metalProp.setSample(metalness);
    metalProp.dispose();

    const opacityProp = params.createScalar("opacity", PlainOldDataType.Float32, {
      timeSamplingIndex,
    });
    opacityProp.setSample(opacity);
    opacityProp.dispose();

    const dsProp = params.createScalar("doubleSided", PlainOldDataType.Boolean, {
      timeSamplingIndex,
    });
    dsProp.setSample(doubleSided);
    dsProp.dispose();
  } finally {
    params.dispose();
  }
}
