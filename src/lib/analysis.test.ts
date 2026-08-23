import { describe, expect, it } from "vitest";
import { MAX_ANALYSIS_SECONDS, maxAnalysisFrames } from "./analysis";

/**
 * The cap is expressed in seconds of clip but enforced in frames, because the
 * trim is measured in frames and the cost is per frame. The conversion is the
 * only place those two units meet.
 */
describe("maxAnalysisFrames", () => {
  it("converts the cap into frames at the clip's rate", () => {
    expect(maxAnalysisFrames(30)).toBe(30 * MAX_ANALYSIS_SECONDS);
    expect(maxAnalysisFrames(60)).toBe(60 * MAX_ANALYSIS_SECONDS);
    expect(maxAnalysisFrames(240)).toBe(240 * MAX_ANALYSIS_SECONDS);
  });

  it("rounds a fractional broadcast rate to whole frames", () => {
    expect(maxAnalysisFrames(29.97)).toBe(450);
    expect(Number.isInteger(maxAnalysisFrames(23.976))).toBe(true);
  });

  it("returns nothing analysable for a rate that makes no sense", () => {
    // frameCount returns 0 for these too, so the panel shows a cap of zero
    // rather than an infinite or negative window.
    expect(maxAnalysisFrames(0)).toBe(0);
    expect(maxAnalysisFrames(-30)).toBe(0);
    expect(maxAnalysisFrames(Number.NaN)).toBe(0);
    expect(maxAnalysisFrames(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
