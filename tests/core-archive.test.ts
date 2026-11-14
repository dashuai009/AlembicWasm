import { describe, expect, it } from "vitest";
import {
  AlembicError,
  ArchiveClosedError,
  SampleSelector,
  TimeSampling,
  createArchive,
  getLibraryVersion,
  getLibraryVersionShort,
  initAlembic,
  openArchive,
} from "../src/index.js";

describe("Core Archive, TimeSampling, and Lifecycle", () => {
  it("initializes WASM and reports Alembic 1.8.x library version", async () => {
    await initAlembic();
    const shortVer = getLibraryVersionShort();
    const fullVer = getLibraryVersion();
    expect(shortVer).toMatch(/^1\.8\./);
    expect(fullVer).toContain("Alembic");
  });

  it("round-trips ArchiveInfo, ArchiveBounds, and echo() in memory", async () => {
    const writer = await createArchive({
      appName: "vitest-suite",
      userDescription: "In-memory Ogawa test archive",
      dccFps: 30,
    });

    writer.setArchiveBounds({
      min: [-2, -1, -3],
      max: [4, 5, 6],
    });

    const child = writer.top.addChild("emptyNode", { customTag: "hello" });
    child.dispose();

    const bytes = writer.finalize();
    expect(bytes.byteLength).toBeGreaterThan(64);
    expect(writer.isFinalized).toBe(true);
    expect(() => writer.top).toThrow(ArchiveClosedError);

    const reader = await openArchive(bytes);
    try {
      expect(reader.coreType).toBe("Ogawa");
      expect(reader.info.appName).toBe("vitest-suite");
      expect(reader.info.userDescription).toBe("In-memory Ogawa test archive");
      expect(reader.info.dccFps).toBeCloseTo(30, 5);

      const bounds = reader.getArchiveBounds(0);
      expect(bounds).not.toBeNull();
      expect(bounds!.min).toEqual([-2, -1, -3]);
      expect(bounds!.max).toEqual([4, 5, 6]);

      const found = reader.findObject("/emptyNode");
      expect(found).not.toBeNull();
      expect(found!.metaData.customTag).toBe("hello");
      found!.dispose();

      const dump = reader.echo();
      expect(dump).toContain("emptyNode");
    } finally {
      reader.close();
    }

    expect(reader.isClosed).toBe(true);
    expect(() => reader.info).toThrow(ArchiveClosedError);
  });

  it("supports Uniform, Cyclic, and Acyclic TimeSamplings and bracketing interpolation", async () => {
    const writer = await createArchive({ appName: "ts-test", dccFps: 24 });
    const uniformIdx = writer.addTimeSampling(TimeSampling.uniform(0.1, 1.0));
    const cyclicIdx = writer.addTimeSampling(TimeSampling.cyclic(1.0, [0.0, 0.25, 0.75]));
    const acyclicIdx = writer.addTimeSampling(TimeSampling.acyclic([0.0, 0.1, 0.45, 1.2]));

    // Author samples so maxNumSamples is populated in archive
    const top = writer.top;
    const xU = top.addXform("u", { timeSamplingIndex: uniformIdx });
    const xC = top.addXform("c", { timeSamplingIndex: cyclicIdx });
    const xA = top.addXform("a", { timeSamplingIndex: acyclicIdx });

    const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let i = 0; i < 5; i++) xU.setMatrixSample(ident);
    for (let i = 0; i < 6; i++) xC.setMatrixSample(ident);
    for (let i = 0; i < 4; i++) xA.setMatrixSample(ident);

    xA.dispose();
    xC.dispose();
    xU.dispose();

    const bytes = writer.finalize();
    const reader = await openArchive(bytes);
    try {
      const tsU = reader.getTimeSampling(uniformIdx);
      expect(tsU.kind).toBe("uniform");
      expect(tsU.getSampleTime(0)).toBeCloseTo(1.0, 6);
      expect(tsU.getSampleTime(3)).toBeCloseTo(1.3, 6);
      const brU = tsU.getBracketingSamples(1.15, 5);
      expect(brU.index0).toBe(1);
      expect(brU.index1).toBe(2);
      expect(brU.alpha).toBeCloseTo(0.5, 5);

      const tsC = reader.getTimeSampling(cyclicIdx);
      expect(tsC.kind).toBe("cyclic");
      expect(tsC.numSamplesPerCycle).toBe(3);
      expect(tsC.getSampleTime(4)).toBeCloseTo(1.25, 6);

      const tsA = reader.getTimeSampling(acyclicIdx);
      expect(tsA.kind).toBe("acyclic");
      expect(tsA.getFloorIndex(0.5, 4).index).toBe(2);
      expect(tsA.getCeilIndex(0.5, 4).index).toBe(3);
      expect(tsA.getNearIndex(0.42, 4).index).toBe(2);

      // Verify SampleSelector helpers
      expect(SampleSelector.index(2).value).toBe(2);
      expect(SampleSelector.floor(0.5).value).toBeCloseTo(0.5);
      expect(SampleSelector.ceil(0.5).value).toBeCloseTo(0.5);
      expect(SampleSelector.near(0.5).value).toBeCloseTo(0.5);
    } finally {
      reader.close();
    }
  });

  it("throws a descriptive AlembicError on invalid archive bytes", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await expect(openArchive(garbage)).rejects.toThrow(AlembicError);
  });
});
