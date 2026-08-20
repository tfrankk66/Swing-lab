import { describe, expect, it } from "vitest";
import {
  clampFrame,
  effectiveFps,
  formatClock,
  frameCount,
  frameToTime,
  impactResolutionCm,
  timeToFrame,
} from "./frames";
import { snapToCommonRate } from "./fps";

describe("frame <-> time", () => {
  it("round-trips every frame at 240fps", () => {
    // The whole point of targeting frame centres: seek to a frame, read the
    // time back, and land on the frame you asked for. Boundary-targeting
    // fails this on roughly half the frames.
    for (let frame = 0; frame < 480; frame++) {
      expect(timeToFrame(frameToTime(frame, 240), 240)).toBe(frame);
    }
  });

  it("round-trips at awkward broadcast rates", () => {
    for (const fps of [23.976, 29.97, 59.94, 119.88]) {
      for (let frame = 0; frame < 200; frame++) {
        expect(timeToFrame(frameToTime(frame, fps), fps)).toBe(frame);
      }
    }
  });

  it("counts frames without inventing a partial one", () => {
    expect(frameCount(2, 240)).toBe(480);
    expect(frameCount(0.5, 30)).toBe(15);
    expect(frameCount(0, 240)).toBe(0);
    expect(frameCount(Infinity, 240)).toBe(0);
    expect(frameCount(2, 0)).toBe(0);
  });

  it("clamps into range", () => {
    expect(clampFrame(-5, 100)).toBe(0);
    expect(clampFrame(500, 100)).toBe(99);
    expect(clampFrame(50, 100)).toBe(50);
    expect(clampFrame(5, 0)).toBe(0);
  });
});

describe("slow motion and impact resolution", () => {
  it("multiplies container rate by the baked-in slowdown", () => {
    // A 30fps container holding 8x-slowed footage samples the real world
    // 240 times a second, which is what actually matters.
    expect(effectiveFps(30, 8)).toBe(240);
    expect(effectiveFps(240, 1)).toBe(240);
  });

  it("puts real numbers on why 30fps cannot see impact", () => {
    // 100mph is 44.7 m/s. One 30fps frame is 149cm of clubhead travel.
    expect(impactResolutionCm(30)).toBeCloseTo(149, 0);
    expect(impactResolutionCm(240)).toBeCloseTo(18.6, 1);
    expect(impactResolutionCm(0)).toBe(Infinity);
  });
});

describe("frame rate snapping", () => {
  it("pulls noisy measurements onto real camera rates", () => {
    expect(snapToCommonRate(239.4)).toBe(240);
    expect(snapToCommonRate(60.2)).toBe(60);
    expect(snapToCommonRate(30.4)).toBe(30);
  });

  it("prefers a whole rate over the NTSC one beside it", () => {
    // 239.4 sits nearer 239.76, but a phone that shot 240 should read 240.
    // The 0.1% cost is a sixteenth of a frame across a two-second swing.
    expect(snapToCommonRate(29.9)).toBe(30);
    expect(snapToCommonRate(119.5)).toBe(120);
    expect(snapToCommonRate(59.95)).toBe(60);
  });

  it("keeps 100 and 120 apart rather than merging them", () => {
    expect(snapToCommonRate(100.3)).toBe(100);
    expect(snapToCommonRate(118)).toBe(120);
  });

  it("leaves genuinely odd rates alone instead of forcing a match", () => {
    expect(snapToCommonRate(75)).toBe(75);
    expect(snapToCommonRate(12.5)).toBe(12.5);
  });
});

describe("clock", () => {
  it("formats to hundredths", () => {
    expect(formatClock(0)).toBe("0:00.00");
    expect(formatClock(64.283)).toBe("1:04.28");
    expect(formatClock(9.5)).toBe("0:09.50");
  });

  it("does not render nonsense for bad input", () => {
    expect(formatClock(NaN)).toBe("0:00.00");
    expect(formatClock(-3)).toBe("0:00.00");
  });
});
