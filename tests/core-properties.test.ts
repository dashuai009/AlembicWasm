import { describe, expect, it } from "vitest";
import {
  GeometryScope,
  PlainOldDataType,
  createArchive,
  openArchive,
} from "../src/index.js";

describe("Generic Scalar, Array, Compound Properties & GeomParams across all 14 POD types", () => {
  it("round-trips Scalar and Array properties for all 14 POD types and multi-component extents", async () => {
    const writer = await createArchive({ appName: "pod-test" });
    const holder = writer.top.addChild("propHolder");
    const rootProps = holder.getProperties();
    const sub = rootProps.createCompound("nested", { note: "sub-compound" });

    // 1. Boolean (scalar extent=3, array)
    const sBool = sub.createScalar("sBool", PlainOldDataType.Boolean, { extent: 3 });
    sBool.setSample([true, false, true]);
    sBool.dispose();

    const aBool = sub.createArray("aBool", PlainOldDataType.Boolean, { extent: 1 });
    aBool.setSample([false, true, true, false]);
    aBool.dispose();

    // 2. Int8 / Uint8
    const sI8 = sub.createScalar("sI8", PlainOldDataType.Int8);
    sI8.setSample(-42);
    sI8.dispose();

    const aU8 = sub.createArray("aU8", PlainOldDataType.Uint8, { extent: 2 });
    aU8.setSample(new Uint8Array([10, 200, 30, 255]));
    aU8.dispose();

    // 3. Int16 / Uint16
    const sI16 = sub.createScalar("sI16", PlainOldDataType.Int16);
    sI16.setSample(-12345);
    sI16.dispose();

    const aU16 = sub.createArray("aU16", PlainOldDataType.Uint16);
    aU16.setSample(new Uint16Array([0, 1024, 65535]));
    aU16.dispose();

    // 4. Int32 / Uint32
    const sI32 = sub.createScalar("sI32", PlainOldDataType.Int32, { extent: 2 });
    sI32.setSample(new Int32Array([-100000, 200000]));
    sI32.dispose();

    const aU32 = sub.createArray("aU32", PlainOldDataType.Uint32);
    aU32.setSample(new Uint32Array([1, 2, 4000000000]));
    aU32.dispose();

    // 5. Int64 / Uint64 (64-bit BigInt)
    const sI64 = sub.createScalar("sI64", PlainOldDataType.Int64);
    sI64.setSample(-9007199254740993n);
    sI64.dispose();

    const aU64 = sub.createArray("aU64", PlainOldDataType.Uint64);
    aU64.setSample(new BigUint64Array([1n, 18446744073709551610n]));
    aU64.dispose();

    // 6. Float16 (auto half <-> float32 conversion!)
    const sF16 = sub.createScalar("sF16", PlainOldDataType.Float16, { extent: 3 });
    sF16.setSample([0.5, -1.25, 3.5]);
    sF16.dispose();

    const aF16 = sub.createArray("aF16", PlainOldDataType.Float16, { extent: 2 });
    aF16.setSample(new Float32Array([0.25, 0.75, -2.0, 4.0]));
    aF16.dispose();

    // 7. Float32 / Float64 (V3f & M44d extent=16)
    const sV3f = sub.createScalar("sV3f", PlainOldDataType.Float32, {
      extent: 3,
      interpretation: "vector",
    });
    sV3f.setSample([1.5, -2.5, 3.25]);
    sV3f.dispose();

    const sM44d = sub.createScalar("sM44d", PlainOldDataType.Float64, {
      extent: 16,
      interpretation: "matrix",
    });
    const mat16 = Float64Array.from({ length: 16 }, (_, i) => i * 0.5);
    sM44d.setSample(mat16);
    sM44d.dispose();

    // 8. String & Wstring
    const sStr = sub.createScalar("sStr", PlainOldDataType.String);
    sStr.setSample("Ogawa UTF-8 字符串");
    sStr.dispose();

    const aStr = sub.createArray("aStr", PlainOldDataType.String);
    aStr.setSample(["alpha", "beta", "gamma"]);
    aStr.dispose();

    const sWstr = sub.createScalar("sWstr", PlainOldDataType.Wstring);
    sWstr.setSample("WideStringTest");
    sWstr.dispose();

    sub.dispose();
    rootProps.dispose();
    holder.dispose();

    const bytes = writer.finalize();
    const reader = await openArchive(bytes);
    try {
      const obj = reader.findObject("/propHolder")!;
      const rp = obj.getProperties();
      const rSub = rp.getCompound("nested");
      expect(rSub.metaData.note).toBe("sub-compound");

      expect(rSub.getScalar("sBool").getSample()).toEqual([true, false, true]);
      expect(rSub.getArray("aBool").getSample()).toEqual([false, true, true, false]);

      expect(Array.from(rSub.getScalar("sI8").getSample() as Int8Array)).toEqual([-42]);
      expect(Array.from(rSub.getArray("aU8").getSample() as Uint8Array)).toEqual([10, 200, 30, 255]);

      expect(Array.from(rSub.getScalar("sI16").getSample() as Int16Array)).toEqual([-12345]);
      expect(Array.from(rSub.getArray("aU16").getSample() as Uint16Array)).toEqual([0, 1024, 65535]);

      expect(Array.from(rSub.getScalar("sI32").getSample() as Int32Array)).toEqual([-100000, 200000]);
      expect(Array.from(rSub.getArray("aU32").getSample() as Uint32Array)).toEqual([1, 2, 4000000000]);

      expect(Array.from(rSub.getScalar("sI64").getSample() as BigInt64Array)).toEqual([-9007199254740993n]);
      expect(Array.from(rSub.getArray("aU64").getSample() as BigUint64Array)).toEqual([
        1n,
        18446744073709551610n,
      ]);

      const rf16 = rSub.getScalar("sF16").getSample() as Float32Array;
      expect(rf16[0]).toBeCloseTo(0.5, 3);
      expect(rf16[1]).toBeCloseTo(-1.25, 3);
      expect(rf16[2]).toBeCloseTo(3.5, 3);

      const af16 = rSub.getArray("aF16").getSample() as Float32Array;
      expect(Array.from(af16)).toEqual([0.25, 0.75, -2.0, 4.0]);

      const rv3 = rSub.getScalar("sV3f").getSample() as Float32Array;
      expect(Array.from(rv3)).toEqual([1.5, -2.5, 3.25]);

      const rm44 = rSub.getScalar("sM44d").getSample() as Float64Array;
      expect(Array.from(rm44)).toEqual(Array.from(mat16));

      expect(rSub.getScalar("sStr").getSample()).toEqual(["Ogawa UTF-8 字符串"]);
      expect(rSub.getArray("aStr").getSample()).toEqual(["alpha", "beta", "gamma"]);
      expect(rSub.getScalar("sWstr").getSample()).toEqual(["WideStringTest"]);

      rSub.dispose();
      rp.dispose();
      obj.dispose();
    } finally {
      reader.close();
    }
  });

  it("round-trips indexed and non-indexed GenericGeomParams across all 5 GeometryScopes", async () => {
    const scopes = [
      GeometryScope.Constant,
      GeometryScope.Uniform,
      GeometryScope.Varying,
      GeometryScope.Vertex,
      GeometryScope.FaceVarying,
    ];

    const writer = await createArchive({ appName: "geomparam-test" });
    const poly = writer.top.addPolyMesh("mesh");
    poly.setSample({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      faceCounts: new Int32Array([4]),
      faceIndices: new Int32Array([0, 1, 2, 3]),
    });

    const arb = poly.getArbGeomParams();

    // Non-indexed params for all 5 scopes
    for (const scope of scopes) {
      const gp = arb.createGeomParam(`param_${scope}`, {
        pod: PlainOldDataType.Float32,
        extent: 2,
        scope,
        isIndexed: false,
      });
      gp.setSample(new Float32Array([0.1, 0.2, 0.3, 0.4]));
      gp.dispose();
    }

    // Indexed FaceVarying RGB color parameter
    const indexedCd = arb.createGeomParam("indexedCd", {
      pod: PlainOldDataType.Float32,
      extent: 3,
      scope: GeometryScope.FaceVarying,
      isIndexed: true,
      interpretation: "rgb",
    });
    indexedCd.setSample(
      new Float32Array([1, 0, 0, 0, 1, 0]), // 2 palette entries: Red, Green
      new Uint32Array([0, 1, 0, 1]) // 4 corners alternating Red, Green
    );
    indexedCd.dispose();

    arb.dispose();
    poly.dispose();

    const bytes = writer.finalize();
    const reader = await openArchive(bytes);
    try {
      const obj = reader.findObject("/mesh")!;
      const ipoly = obj.asPolyMesh()!;
      const rArb = ipoly.getArbGeomParams()!;

      for (const scope of scopes) {
        const gp = rArb.getGeomParam(`param_${scope}`);
        expect(gp.scope).toBe(scope);
        expect(gp.isIndexed).toBe(false);
        const vals = gp.getExpandedSample(0) as Float32Array;
        expect(vals.length).toBe(4);
        expect(vals[0]).toBeCloseTo(0.1, 5);
        expect(vals[3]).toBeCloseTo(0.4, 5);
        gp.dispose();
      }

      const rIdx = rArb.getGeomParam("indexedCd");
      expect(rIdx.isIndexed).toBe(true);
      expect(rIdx.scope).toBe(GeometryScope.FaceVarying);
      const indexed = rIdx.getIndexedSample(0);
      expect((indexed.values as Float32Array).length).toBe(6);
      expect(Array.from(indexed.indices!)).toEqual([0, 1, 0, 1]);

      const expanded = rIdx.getExpandedSample(0) as Float32Array;
      expect(Array.from(expanded)).toEqual([
        1, 0, 0,
        0, 1, 0,
        1, 0, 0,
        0, 1, 0,
      ]);
      rIdx.dispose();

      rArb.dispose();
      ipoly.dispose();
      obj.dispose();
    } finally {
      reader.close();
    }
  });
});
