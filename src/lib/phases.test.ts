import { describe, expect, it } from "vitest";
import { detectPhases, handPath } from "./phases";
import { LM } from "./pose";
import { IMAGE_STRIDE, WORLD_STRIDE, type SwingTrack } from "./track";

/**
 * A synthetic down-the-line swing, in normalised image space.
 *
 * Address at hand height, hands rise to the top over a long backswing, drop
 * fast through impact back to address height, then rise again into a finish
 * that ends *higher than the top* — which is how a real swing looks and the
 * reason "hands highest" cannot find the top on its own.
 */
function swingHands(): { x: number; y: number }[] {
  const path: { x: number; y: number }[] = [];
  const addressY = 0.62;
  const topY = 0.30;
  const finishY = 0.18;

  // Address: eight still frames.
  for (let i = 0; i < 8; i++) path.push({ x: 0.5, y: addressY });
  // Backswing: 24 frames rising to the top, decelerating into it.
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const eased = Math.sin((t * Math.PI) / 2);
    path.push({ x: 0.5 - 0.10 * eased, y: addressY - (addressY - topY) * eased });
  }
  // Pause at the top.
  for (let i = 0; i < 3; i++) path.push({ x: 0.40, y: topY });
  // Downswing: 8 frames, much faster, back through address height.
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    path.push({ x: 0.40 + 0.12 * t, y: topY + (addressY - topY) * t });
  }
  // Follow-through: rises past the top to a high finish.
  for (let i = 1; i <= 18; i++) {
    const t = i / 18;
    path.push({ x: 0.52 + 0.10 * t, y: addressY - (addressY - finishY) * t });
  }
  return path;
}

function trackFrom(
  path: { x: number; y: number }[],
  missing: number[] = [],
): SwingTrack {
  const count = path.length;
  const image = new Float32Array(count * IMAGE_STRIDE);
  const world = new Float32Array(count * WORLD_STRIDE);
  const found = new Uint8Array(count).fill(1);

  for (let i = 0; i < count; i++) {
    const p = path[i] ?? { x: 0, y: 0 };
    for (const id of [LM.leftWrist, LM.rightWrist]) {
      const at = i * IMAGE_STRIDE + id * 4;
      // Both wrists on the same point: the midpoint is what is read.
      image[at] = p.x;
      image[at + 1] = p.y;
      image[at + 2] = 0;
      image[at + 3] = 0.9;
    }
  }
  for (const i of missing) found[i] = 0;

  return {
    fps: 240,
    startFrame: 1000,
    count,
    videoWidth: 1080,
    videoHeight: 1920,
    analyzedWidth: 405,
    analyzedHeight: 720,
    image,
    world,
    found,
    quality: "full",
    delegate: "GPU",
    elapsedMs: 0,
    seekMs: 0,
    detectMs: 0,
  };
}

describe("handPath", () => {
  it("reads the midpoint of the two wrists", () => {
    const count = 4;
    const image = new Float32Array(count * IMAGE_STRIDE);
    const found = new Uint8Array(count).fill(1);
    for (let i = 0; i < count; i++) {
      const base = i * IMAGE_STRIDE;
      image[base + LM.leftWrist * 4] = 0.2;
      image[base + LM.leftWrist * 4 + 1] = 0.4;
      image[base + LM.rightWrist * 4] = 0.6;
      image[base + LM.rightWrist * 4 + 1] = 0.8;
    }
    const track = { ...trackFrom([]), count, image, found } as SwingTrack;
    const hands = handPath(track);
    expect(hands.x[0]).toBeCloseTo(0.4, 6);
    expect(hands.y[0]).toBeCloseTo(0.6, 6);
  });

  it("marks frames with no pose as absent", () => {
    const track = trackFrom(swingHands(), [5, 6]);
    const hands = handPath(track);
    expect(hands.present[5]).toBe(false);
    expect(hands.present[7]).toBe(true);
  });
});

describe("detectPhases", () => {
  const path = swingHands();
  // Frame numbers within the track, before startFrame is added.
  const TOP = 8 + 24; // first frame of the pause at the top
  const IMPACT = 8 + 24 + 3 + 8; // back at address height

  it("is not thrown by a cold first detection", () => {
    // The first frame of a run is detected with no tracking behind it and
    // reaches phase detection unsmoothed. Put it well off the address, so the
    // jump to frame two is faster than the downswing. It used to become
    // "the fastest frame", and every phase collapsed onto the first two.
    const glitched = [{ x: 0.2, y: 0.95 }, ...path.slice(1)];
    const phases = detectPhases(trackFrom(glitched));
    expect(phases?.confident).toBe(true);
    expect(phases!.p4 - 1000).toBeGreaterThanOrEqual(TOP - 1);
    expect(phases!.p4 - 1000).toBeLessThanOrEqual(TOP + 3);
    expect(Math.abs(phases!.p7 - 1000 - IMPACT)).toBeLessThanOrEqual(1);
  });

  it("finds the three phases in order", () => {
    const phases = detectPhases(trackFrom(path));
    expect(phases).not.toBeNull();
    const { p1, p4, p7 } = phases!;
    expect(p1).toBeLessThan(p4);
    expect(p4).toBeLessThan(p7);
  });

  it("reports absolute video frames, not track offsets", () => {
    const phases = detectPhases(trackFrom(path))!;
    // startFrame is 1000, and address is in the first eight frames.
    expect(phases.p1).toBeGreaterThanOrEqual(1000);
    expect(phases.p1).toBeLessThan(1010);
  });

  it("puts address at the end of the still frames, not the first frame", () => {
    const phases = detectPhases(trackFrom(path))!;
    expect(phases.p1 - 1000).toBeGreaterThanOrEqual(6);
    expect(phases.p1 - 1000).toBeLessThanOrEqual(9);
  });

  it("finds the top rather than the higher finish", () => {
    // The whole trap: the finish is at y=0.18 and the top only at y=0.30, so
    // "hands highest" over the clip would answer with the finish.
    const phases = detectPhases(trackFrom(path))!;
    expect(Math.abs(phases.p4 - 1000 - TOP)).toBeLessThanOrEqual(3);
  });

  it("finds impact where the hands come back to address height", () => {
    const phases = detectPhases(trackFrom(path))!;
    expect(Math.abs(phases.p7 - 1000 - IMPACT)).toBeLessThanOrEqual(2);
  });

  it("is confident about a swing that looks like a swing", () => {
    expect(detectPhases(trackFrom(path))!.confident).toBe(true);
  });

  it("survives dropouts through the downswing", () => {
    // Exactly where the model actually loses the arms.
    const phases = detectPhases(trackFrom(path, [36, 37, 38]))!;
    expect(Math.abs(phases.p4 - 1000 - TOP)).toBeLessThanOrEqual(3);
    expect(phases.p4).toBeLessThan(phases.p7);
  });

  it("returns null for a track too short to hold a swing", () => {
    expect(detectPhases(trackFrom(path.slice(0, 3)))).toBeNull();
  });

  it("is not confident about a clip of someone standing still", () => {
    const still = new Array(40).fill({ x: 0.5, y: 0.6 });
    const phases = detectPhases(trackFrom(still));
    if (phases) expect(phases.confident).toBe(false);
  });

  it("is not confident when the backswing is not slower than the downswing", () => {
    // A clip trimmed to start at the top has no backswing to speak of.
    const fromTop = path.slice(TOP - 1);
    const phases = detectPhases(trackFrom(fromTop));
    if (phases) expect(phases.confident).toBe(false);
  });
});
