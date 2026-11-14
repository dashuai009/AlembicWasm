import type { RawTimeSamplingInfo } from "../wasm/bindings.js";
import { AlembicError } from "./errors.js";

export enum SelectorMode {
  Index = 0,
  FloorTime = 1,
  CeilTime = 2,
  NearTime = 3,
}

export class SampleSelector {
  readonly mode: SelectorMode;
  readonly value: number;

  constructor(mode: SelectorMode = SelectorMode.Index, value = 0) {
    this.mode = mode;
    this.value = value;
  }

  static index(sampleIndex = 0): SampleSelector {
    return new SampleSelector(SelectorMode.Index, Math.max(0, Math.trunc(sampleIndex)));
  }

  static floor(timeSeconds: number): SampleSelector {
    return new SampleSelector(SelectorMode.FloorTime, timeSeconds);
  }

  static ceil(timeSeconds: number): SampleSelector {
    return new SampleSelector(SelectorMode.CeilTime, timeSeconds);
  }

  static near(timeSeconds: number): SampleSelector {
    return new SampleSelector(SelectorMode.NearTime, timeSeconds);
  }
}

export type SampleSelectorInput =
  | number
  | SampleSelector
  | { index: number }
  | { floorTime: number }
  | { ceilTime: number }
  | { nearTime: number }
  | undefined;

export function resolveSampleSelector(input?: SampleSelectorInput): { mode: SelectorMode; value: number } {
  if (input === undefined) {
    return { mode: SelectorMode.Index, value: 0 };
  }
  if (typeof input === "number") {
    return { mode: SelectorMode.Index, value: Math.max(0, Math.trunc(input)) };
  }
  if (input instanceof SampleSelector) {
    return { mode: input.mode, value: input.value };
  }
  if ("index" in input) {
    return { mode: SelectorMode.Index, value: Math.max(0, Math.trunc(input.index)) };
  }
  if ("floorTime" in input) {
    return { mode: SelectorMode.FloorTime, value: input.floorTime };
  }
  if ("ceilTime" in input) {
    return { mode: SelectorMode.CeilTime, value: input.ceilTime };
  }
  if ("nearTime" in input) {
    return { mode: SelectorMode.NearTime, value: input.nearTime };
  }
  return { mode: SelectorMode.Index, value: 0 };
}

export type TimeSamplingKind = "uniform" | "cyclic" | "acyclic";

export interface BracketingTimeSamples {
  index0: number;
  index1: number;
  alpha: number;
  time0: number;
  time1: number;
  /** Offset `timeSeconds - time0` (useful for `.velocities` sub-frame advection). */
  dtFromFloor: number;
}

export class TimeSampling {
  readonly kind: TimeSamplingKind;
  readonly timePerCycle: number;
  readonly numSamplesPerCycle: number;
  readonly storedTimes: readonly number[];
  readonly maxNumSamples: number;

  constructor(params: {
    kind: TimeSamplingKind;
    timePerCycle: number;
    numSamplesPerCycle: number;
    storedTimes: readonly number[];
    maxNumSamples?: number;
  }) {
    this.kind = params.kind;
    this.timePerCycle = params.timePerCycle;
    this.numSamplesPerCycle = params.numSamplesPerCycle;
    this.storedTimes = [...params.storedTimes];
    this.maxNumSamples = params.maxNumSamples ?? 0;
  }

  static fromRaw(raw: RawTimeSamplingInfo): TimeSampling {
    const kind: TimeSamplingKind = raw.isAcyclic
      ? "acyclic"
      : raw.isCyclic
        ? "cyclic"
        : "uniform";
    return new TimeSampling({
      kind,
      timePerCycle: raw.timePerCycle,
      numSamplesPerCycle: raw.numSamplesPerCycle,
      storedTimes: raw.storedTimes,
      maxNumSamples: raw.maxNumSamples,
    });
  }

  static uniform(timePerCycle = 1 / 24, startTime = 0): TimeSampling {
    if (timePerCycle <= 0 || !Number.isFinite(timePerCycle)) {
      throw new AlembicError("Uniform TimeSampling requires positive finite timePerCycle.");
    }
    return new TimeSampling({
      kind: "uniform",
      timePerCycle,
      numSamplesPerCycle: 1,
      storedTimes: [startTime],
    });
  }

  static cyclic(timePerCycle: number, cycleTimes: readonly number[]): TimeSampling {
    if (timePerCycle <= 0 || cycleTimes.length === 0) {
      throw new AlembicError("Cyclic TimeSampling requires positive timePerCycle and non-empty cycleTimes.");
    }
    return new TimeSampling({
      kind: "cyclic",
      timePerCycle,
      numSamplesPerCycle: cycleTimes.length,
      storedTimes: cycleTimes,
    });
  }

  static acyclic(sampleTimes: readonly number[]): TimeSampling {
    if (sampleTimes.length === 0) {
      throw new AlembicError("Acyclic TimeSampling requires at least one timestamp.");
    }
    return new TimeSampling({
      kind: "acyclic",
      timePerCycle: Number.POSITIVE_INFINITY,
      numSamplesPerCycle: sampleTimes.length,
      storedTimes: sampleTimes,
    });
  }

  get isUniform(): boolean {
    return this.kind === "uniform";
  }

  get isCyclic(): boolean {
    return this.kind === "cyclic";
  }

  get isAcyclic(): boolean {
    return this.kind === "acyclic";
  }

  get fps(): number {
    if (this.kind === "uniform" && this.timePerCycle > 0) {
      return 1 / this.timePerCycle;
    }
    if (this.kind === "cyclic" && this.timePerCycle > 0 && this.numSamplesPerCycle > 0) {
      return this.numSamplesPerCycle / this.timePerCycle;
    }
    if (this.storedTimes.length >= 2) {
      const span = this.storedTimes[this.storedTimes.length - 1] - this.storedTimes[0];
      if (span > 0) {
        return (this.storedTimes.length - 1) / span;
      }
    }
    return 24;
  }

  getSampleTime(index: number): number {
    const idx = Math.max(0, Math.trunc(index));
    if (this.kind === "uniform") {
      const start = this.storedTimes[0] ?? 0;
      return start + idx * this.timePerCycle;
    }
    if (this.kind === "cyclic") {
      const spc = Math.max(1, this.storedTimes.length);
      const cycle = Math.floor(idx / spc);
      const rem = idx % spc;
      return cycle * this.timePerCycle + (this.storedTimes[rem] ?? 0);
    }
    if (this.storedTimes.length === 0) {
      return 0;
    }
    const clamped = Math.min(idx, this.storedTimes.length - 1);
    return this.storedTimes[clamped];
  }

  getTimeRange(numSamples = this.maxNumSamples): { startTime: number; endTime: number } {
    if (numSamples <= 0) {
      const t0 = this.storedTimes[0] ?? 0;
      return { startTime: t0, endTime: t0 };
    }
    return {
      startTime: this.getSampleTime(0),
      endTime: this.getSampleTime(numSamples - 1),
    };
  }

  getFloorIndex(timeSeconds: number, numSamples: number): { index: number; sampleTime: number } {
    const count = Math.max(1, Math.trunc(numSamples));
    if (count === 1) {
      return { index: 0, sampleTime: this.getSampleTime(0) };
    }
    const tFirst = this.getSampleTime(0);
    if (timeSeconds <= tFirst) {
      return { index: 0, sampleTime: tFirst };
    }
    const tLast = this.getSampleTime(count - 1);
    if (timeSeconds >= tLast) {
      return { index: count - 1, sampleTime: tLast };
    }

    if (this.kind === "uniform" && this.timePerCycle > 0) {
      const rawIdx = Math.floor((timeSeconds - tFirst) / this.timePerCycle + 1e-9);
      const idx = Math.max(0, Math.min(count - 1, rawIdx));
      return { index: idx, sampleTime: this.getSampleTime(idx) };
    }

    // Binary search over [0, count - 1]
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.getSampleTime(mid) <= timeSeconds + 1e-12) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { index: lo, sampleTime: this.getSampleTime(lo) };
  }

  getCeilIndex(timeSeconds: number, numSamples: number): { index: number; sampleTime: number } {
    const count = Math.max(1, Math.trunc(numSamples));
    const floor = this.getFloorIndex(timeSeconds, count);
    if (Math.abs(floor.sampleTime - timeSeconds) <= 1e-12 || floor.index >= count - 1) {
      return floor;
    }
    const nextIdx = floor.index + 1;
    return { index: nextIdx, sampleTime: this.getSampleTime(nextIdx) };
  }

  getNearIndex(timeSeconds: number, numSamples: number): { index: number; sampleTime: number } {
    const floor = this.getFloorIndex(timeSeconds, numSamples);
    const ceil = this.getCeilIndex(timeSeconds, numSamples);
    if (Math.abs(timeSeconds - floor.sampleTime) <= Math.abs(ceil.sampleTime - timeSeconds)) {
      return floor;
    }
    return ceil;
  }

  getBracketingSamples(timeSeconds: number, numSamples: number): BracketingTimeSamples {
    const count = Math.max(1, Math.trunc(numSamples));
    if (count <= 1) {
      const t0 = this.getSampleTime(0);
      return {
        index0: 0,
        index1: 0,
        alpha: 0,
        time0: t0,
        time1: t0,
        dtFromFloor: 0,
      };
    }

    const floor = this.getFloorIndex(timeSeconds, count);
    const index0 = floor.index;
    const index1 = Math.min(count - 1, index0 + 1);
    const time0 = floor.sampleTime;
    const time1 = this.getSampleTime(index1);
    const span = time1 - time0;
    const clampedT = Math.max(this.getSampleTime(0), Math.min(this.getSampleTime(count - 1), timeSeconds));
    const alpha = span > 1e-12 ? Math.max(0, Math.min(1, (clampedT - time0) / span)) : 0;

    return {
      index0,
      index1,
      alpha,
      time0,
      time1,
      dtFromFloor: clampedT - time0,
    };
  }
}
