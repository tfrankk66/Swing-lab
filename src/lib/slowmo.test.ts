import { describe, expect, it } from "vitest";
import type { SwingPhases } from "./phases";
import {
  SUPPORTED_FACTORS,
  TYPICAL_DOWNSWING_SECONDS,
  inferSlowdown,
} from "./slowmo";

/**
 * Builds phases for a swing of a given real tempo, as a clip at `fps` with
 * `factor` of slow motion baked in would have recorded it.
 *
 * Going through real seconds rather than writing frame numbers by hand is the
 * point: the test then states the swing it means and lets the arithmetic that
 * the app has to invert run forwards.
 */
function swing({
  fps,
  factor,
  downswing = TYPICAL_DOWNSWING_SECONDS,
  tempo = 3,
  confident = true,
}: {
  fps: number;
  factor: number;
  downswing?: number;
  tempo?: number;
  confident?: boolean;
}): SwingPhases {
  const downswingFrames = Math.round(downswing * factor * fps);
  const backswingFrames = Math.round(downswingFrames * tempo);
  const p1 = 10;
  const p4 = p1 + backswingFrames;
  return { p1, p4, p7: p4 + downswingFrames, confident };
}

describe("inferSlowdown", () => {
  it("recovers the factor a clip was shot with", () => {
    // The round trip that matters: build a clip at a known factor, and the
    // inference has to name that factor back.
    for (const fps of [30, 60, 120]) {
      for (const factor of SUPPORTED_FACTORS) {
        const estimate = inferSlowdown(swing({ fps, factor }), fps);
        expect(estimate?.factor, `${fps}fps at ${factor}x`).toBe(factor);
        expect(estimate?.confident).toBe(true);
      }
    }
  });

  it("holds across the tempo range real golfers swing at", () => {
    // A quick downswing and a slow one must still snap to the same factor, or
    // the inference is measuring the golfer instead of the camera.
    for (const downswing of [0.22, 0.25, 0.28, 0.32, 0.36]) {
      const estimate = inferSlowdown(
        swing({ fps: 60, factor: 4, downswing }),
        60,
      );
      expect(estimate?.factor, `${downswing}s downswing`).toBe(4);
    }
  });

  it("reports drift so a coin-toss reading can say so", () => {
    const exact = inferSlowdown(swing({ fps: 60, factor: 4 }), 60);
    expect(exact?.drift).toBeLessThan(0.1);

    // Halfway between 4x and 8x in log space: the answer is arbitrary, and
    // the drift has to admit it rather than reporting a clean 4.
    const between = inferSlowdown(
      swing({ fps: 60, factor: 4, downswing: TYPICAL_DOWNSWING_SECONDS * 1.41 }),
      60,
    );
    expect(between?.drift).toBeGreaterThan(0.4);
  });

  it("declines when the phases were not confident", () => {
    const estimate = inferSlowdown(
      swing({ fps: 60, factor: 4, confident: false }),
      60,
    );
    expect(estimate?.confident).toBe(false);
  });

  it("declines on a tempo no swing has", () => {
    // Backswing faster than the downswing is the case phases.ts already flags;
    // this is the milder one it lets through — a 12:1 crawl into the ball.
    const estimate = inferSlowdown(
      swing({ fps: 60, factor: 4, tempo: 12 }),
      60,
    );
    expect(estimate?.confident).toBe(false);
  });

  it("declines when the downswing is too few frames to divide", () => {
    // 30fps real time: the whole downswing is eight frames, and at 1x that is
    // fine, but the two-frame version below cannot survive one frame of error.
    const estimate = inferSlowdown(
      { p1: 0, p4: 30, p7: 32, confident: true },
      30,
    );
    expect(estimate?.confident).toBe(false);
  });

  it("returns null rather than guessing on unusable input", () => {
    expect(inferSlowdown(null, 60)).toBeNull();
    expect(inferSlowdown(swing({ fps: 60, factor: 4 }), 0)).toBeNull();
    // P7 at or before P4 is not a downswing.
    expect(inferSlowdown({ p1: 0, p4: 50, p7: 50, confident: true }, 60)).toBeNull();
  });

  it("keeps real-time footage at 1x", () => {
    // The case the 4x default gets wrong, and the reason this exists.
    const estimate = inferSlowdown(swing({ fps: 240, factor: 1 }), 240);
    expect(estimate?.factor).toBe(1);
    expect(estimate?.confident).toBe(true);
  });
});
