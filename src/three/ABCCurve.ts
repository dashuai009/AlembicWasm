import * as THREE from "three";
import {
  BasisType,
  CurvePeriodicity,
  CurveType,
  type CurvesSample,
} from "../index.js";

/**
 * Three.js `Curve<THREE.Vector3>` representing a single strand from an Alembic `ICurves` schema.
 * Supports Linear, Cubic Bezier, Cubic B-Spline, Catmull-Rom, and Periodic/Non-Periodic strands.
 */
export class ABCCurve extends THREE.Curve<THREE.Vector3> {
  readonly points: THREE.Vector3[];
  readonly curveType: CurveType;
  readonly wrap: CurvePeriodicity;
  readonly basis: BasisType;
  readonly weights: Float32Array | null;

  constructor(
    points: THREE.Vector3[],
    options?: {
      curveType?: CurveType;
      wrap?: CurvePeriodicity;
      basis?: BasisType;
      weights?: Float32Array | null;
    }
  ) {
    super();
    this.points = points;
    this.curveType = options?.curveType ?? CurveType.Linear;
    this.wrap = options?.wrap ?? CurvePeriodicity.NonPeriodic;
    this.basis = options?.basis ?? BasisType.NoBasis;
    this.weights = options?.weights ?? null;
  }

  override getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
    const pts = this.points;
    const n = pts.length;
    if (n === 0) {
      return optionalTarget.set(0, 0, 0);
    }
    if (n === 1) {
      return optionalTarget.copy(pts[0]!);
    }

    const u = Math.max(0, Math.min(1, t));
    const closed = this.wrap === CurvePeriodicity.Periodic;

    if (this.curveType === CurveType.Linear || n < 4) {
      const segCount = closed ? n : n - 1;
      const scaled = u * segCount;
      const i0 = Math.min(segCount - 1, Math.floor(scaled));
      const frac = scaled - i0;
      const p0 = pts[i0 % n]!;
      const p1 = pts[(i0 + 1) % n]!;
      return optionalTarget.lerpVectors(p0, p1, frac);
    }

    if (this.basis === BasisType.Bezier && !closed && (n - 1) % 3 === 0) {
      const numSpans = Math.floor((n - 1) / 3);
      const scaled = u * numSpans;
      const span = Math.min(numSpans - 1, Math.floor(scaled));
      const s = scaled - span;
      const base = span * 3;
      return evalCubicBezier(
        pts[base]!,
        pts[base + 1]!,
        pts[base + 2]!,
        pts[base + 3]!,
        s,
        optionalTarget
      );
    }

    if (this.basis === BasisType.CatmullRom) {
      const numSpans = closed ? n : Math.max(1, n - 3);
      const scaled = u * numSpans;
      const span = Math.min(numSpans - 1, Math.floor(scaled));
      const s = scaled - span;
      const p0 = pts[closed ? span % n : span]!;
      const p1 = pts[closed ? (span + 1) % n : span + 1]!;
      const p2 = pts[closed ? (span + 2) % n : span + 2]!;
      const p3 = pts[closed ? (span + 3) % n : span + 3]!;
      return evalCatmullRom(p0, p1, p2, p3, s, optionalTarget);
    }

    // Default cubic uniform B-Spline (with optional rational weights)
    const numSpans = closed ? n : Math.max(1, n - 3);
    const scaled = u * numSpans;
    const span = Math.min(numSpans - 1, Math.floor(scaled));
    const s = scaled - span;
    const i0 = closed ? span % n : span;
    const i1 = closed ? (span + 1) % n : span + 1;
    const i2 = closed ? (span + 2) % n : span + 2;
    const i3 = closed ? (span + 3) % n : span + 3;
    return evalUniformBSpline(
      pts[i0]!,
      pts[i1]!,
      pts[i2]!,
      pts[i3]!,
      this.weights ? (this.weights[i0] ?? 1) : 1,
      this.weights ? (this.weights[i1] ?? 1) : 1,
      this.weights ? (this.weights[i2] ?? 1) : 1,
      this.weights ? (this.weights[i3] ?? 1) : 1,
      s,
      optionalTarget
    );
  }
}

function evalCubicBezier(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number,
  out: THREE.Vector3
): THREE.Vector3 {
  const it = 1 - t;
  const b0 = it * it * it;
  const b1 = 3 * it * it * t;
  const b2 = 3 * it * t * t;
  const b3 = t * t * t;
  return out.set(
    b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
    b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z
  );
}

function evalCatmullRom(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number,
  out: THREE.Vector3
): THREE.Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const c0 = -0.5 * t3 + t2 - 0.5 * t;
  const c1 = 1.5 * t3 - 2.5 * t2 + 1.0;
  const c2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
  const c3 = 0.5 * t3 - 0.5 * t2;
  return out.set(
    c0 * p0.x + c1 * p1.x + c2 * p2.x + c3 * p3.x,
    c0 * p0.y + c1 * p1.y + c2 * p2.y + c3 * p3.y,
    c0 * p0.z + c1 * p1.z + c2 * p2.z + c3 * p3.z
  );
}

function evalUniformBSpline(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  w0: number,
  w1: number,
  w2: number,
  w3: number,
  t: number,
  out: THREE.Vector3
): THREE.Vector3 {
  const it = 1 - t;
  const b0 = (it * it * it) / 6 * w0;
  const b1 = ((3 * t * t * t - 6 * t * t + 4) / 6) * w1;
  const b2 = ((-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6) * w2;
  const b3 = ((t * t * t) / 6) * w3;
  const wSum = b0 + b1 + b2 + b3;
  const invW = Math.abs(wSum) > 1e-12 ? 1 / wSum : 1;
  return out.set(
    (b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x) * invW,
    (b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y) * invW,
    (b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z) * invW
  );
}

export function extractABCCurvesFromSample(sample: CurvesSample): ABCCurve[] {
  const curves: ABCCurve[] = [];
  let vOffset = 0;
  const pos = sample.positions;
  const counts = sample.curvesNumVertices;

  for (let c = 0; c < counts.length; c++) {
    const count = counts[c]!;
    const strandPts: THREE.Vector3[] = [];
    for (let i = 0; i < count && (vOffset + i) * 3 + 2 < pos.length; i++) {
      const idx = (vOffset + i) * 3;
      strandPts.push(new THREE.Vector3(pos[idx]!, pos[idx + 1]!, pos[idx + 2]!));
    }
    const strandWeights = sample.positionWeights
      ? sample.positionWeights.slice(vOffset, vOffset + count)
      : null;
    curves.push(
      new ABCCurve(strandPts, {
        curveType: sample.type,
        wrap: sample.wrap,
        basis: sample.basis,
        weights: strandWeights,
      })
    );
    vOffset += count;
  }
  return curves;
}
