import { describe, expect, it } from "vitest";
import {
  distance,
  extendAcross,
  jointAngle,
  midpointOf,
  tiltFromHorizontal,
  tiltFromVertical,
  toPixels,
  type Vec,
} from "./geom";
import type { Point, SwingTrack } from "./track";

const v = (x: number, y: number): Vec => ({ x, y });
const p = (x: number, y: number): Point => ({ x, y, z: 0, v: 1 });

describe("toPixels", () => {
  it("undoes the per-axis normalisation", () => {
    const track = { videoWidth: 1920, videoHeight: 1080 } as SwingTrack;
    // A line that really is 45 degrees: 480 pixels across, 480 pixels down.
    // In normalised coordinates that is 0.25 of the width against 0.444 of
    // the height, because the two axes are divided by different numbers.
    const from = p(0.25, 0.25);
    const to = p(0.5, 0.25 + 480 / 1080);

    expect(tiltFromHorizontal(toPixels(from, track), toPixels(to, track))).toBeCloseTo(45, 6);

    // And the trap this guards, stated: measuring the same line without
    // converting reads 60.6 degrees, because one unit of x is 1.78 units of y.
    const rawAngle = tiltFromHorizontal(
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
    );
    expect(rawAngle).toBeGreaterThan(60);
  });
});

describe("tiltFromVertical", () => {
  it("is zero for straight up and straight down", () => {
    expect(tiltFromVertical(v(0, 0), v(0, -10))).toBeCloseTo(0);
    expect(tiltFromVertical(v(0, -10), v(0, 0))).toBeCloseTo(180);
  });

  it("reads a forward bend the way a person would say it", () => {
    // Hips at the origin, shoulders up and 30 degrees over the ball.
    const lean = tiltFromVertical(v(0, 0), v(Math.sin(Math.PI / 6) * 100, -Math.cos(Math.PI / 6) * 100));
    expect(lean).toBeCloseTo(30, 6);
  });

  it("is unsigned, so handedness never enters into it", () => {
    const right = tiltFromVertical(v(0, 0), v(40, -100));
    const left = tiltFromVertical(v(0, 0), v(-40, -100));
    expect(right).toBeCloseTo(left, 10);
  });

  it("returns zero rather than NaN for a zero-length segment", () => {
    expect(tiltFromVertical(v(5, 5), v(5, 5))).toBe(0);
  });
});

describe("tiltFromHorizontal", () => {
  it("measures the plane a line sits on", () => {
    expect(tiltFromHorizontal(v(0, 0), v(100, 0))).toBeCloseTo(0);
    expect(tiltFromHorizontal(v(0, 0), v(100, -100))).toBeCloseTo(45);
    expect(tiltFromHorizontal(v(0, 0), v(0, -100))).toBeCloseTo(90);
  });

  it("does not care which end you start from", () => {
    expect(tiltFromHorizontal(v(10, 90), v(60, 20))).toBeCloseTo(
      tiltFromHorizontal(v(60, 20), v(10, 90)),
    );
  });
});

describe("jointAngle", () => {
  it("reads 180 for a straight limb and 90 for a right angle", () => {
    expect(jointAngle(v(0, -10), v(0, 0), v(0, 10))).toBeCloseTo(180);
    expect(jointAngle(v(-10, 0), v(0, 0), v(0, 10))).toBeCloseTo(90);
  });

  it("survives a perfectly straight limb without going NaN", () => {
    // acos of a cosine that floating point put at 1.0000000000000002.
    for (let i = 0; i < 200; i++) {
      const angle = jointAngle(
        v(i * 0.01, i * 0.03),
        v(0, 0),
        v(-i * 0.01, -i * 0.03),
      );
      expect(Number.isNaN(angle)).toBe(false);
    }
  });

  it("returns zero on a degenerate triangle rather than NaN", () => {
    expect(jointAngle(v(0, 0), v(0, 0), v(1, 1))).toBe(0);
  });
});

describe("extendAcross", () => {
  it("carries the line to both edges of the picture", () => {
    const ends = extendAcross(v(100, 100), v(200, 0), 400);
    expect(ends).not.toBeNull();
    expect(ends?.[0]).toEqual({ x: 0, y: 200 });
    expect(ends?.[1]).toEqual({ x: 400, y: -200 });
  });

  it("declines a vertical line, which has no crossing to find", () => {
    expect(extendAcross(v(50, 0), v(50, 300), 400)).toBeNull();
  });
});

describe("distance and midpointOf", () => {
  it("do the obvious thing", () => {
    expect(distance(v(0, 0), v(3, 4))).toBe(5);
    expect(midpointOf(v(0, 0), v(10, 20))).toEqual({ x: 5, y: 10 });
  });
});
