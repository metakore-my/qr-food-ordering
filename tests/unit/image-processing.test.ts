import { describe, it, expect } from "vitest";
import { fitWithinMaxEdge, outputDimsForCrop } from "@/lib/image-processing";

describe("fitWithinMaxEdge", () => {
  it("scales the longer edge down to maxEdge, preserving ratio", () => {
    expect(fitWithinMaxEdge(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });
  it("scales when height is the longer edge", () => {
    expect(fitWithinMaxEdge(1000, 2000, 1600)).toEqual({ width: 800, height: 1600 });
  });
  it("never upscales — returns source dims when already within cap", () => {
    expect(fitWithinMaxEdge(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
  it("rounds to integer pixels", () => {
    const out = fitWithinMaxEdge(1333, 1000, 1600);
    expect(Number.isInteger(out.width)).toBe(true);
    expect(Number.isInteger(out.height)).toBe(true);
  });
});

describe("outputDimsForCrop", () => {
  it("caps a large 4:3 crop at the max edge", () => {
    expect(outputDimsForCrop(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
  });
  it("keeps a small crop as-is (no upscale)", () => {
    expect(outputDimsForCrop(900, 675, 1600)).toEqual({ width: 900, height: 675 });
  });
});
