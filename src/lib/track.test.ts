import { describe, expect, it } from "vitest";
import { LANDMARK_COUNT, LM } from "./pose";
import {
  coverage,
  hasFrame,
  imageAt,
  IMAGE_STRIDE,
  midpoint,
  trackIndex,
  worldAt,
  WORLD_STRIDE,
  type SwingTrack,
} from "./track";

/**
 * A track starting at frame 100, where landmark n of frame i sits at
 * x = i/1000, y = n/100 — so any indexing slip shows up as a wrong number
 * rather than as a plausible one.
 */
function makeTrack(count: number, missing: number[] = []): SwingTrack {
  const image = new Float32Array(count * IMAGE_STRIDE);
  const world = new Float32Array(count * WORLD_STRIDE);
  const found = new Uint8Array(count).fill(1);

  for (let i = 0; i < count; i++) {
    for (let n = 0; n < LANDMARK_COUNT; n++) {
      const at = i * IMAGE_STRIDE + n * 4;
      image[at] = i / 1000;
      image[at + 1] = n / 100;
      image[at + 2] = -0.5;
      image[at + 3] = n === LM.rightWrist ? 0.2 : 0.9;

      const wat = i * WORLD_STRIDE + n * 3;
      world[wat] = i;
      world[wat + 1] = n;
      world[wat + 2] = 0;
    }
  }
  for (const index of missing) found[index] = 0;

  return {
    fps: 240,
    startFrame: 100,
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
    elapsedMs: 1000,
    seekMs: 400,
    detectMs: 600,
    streamed: count,
    filled: 0,
    missed: 0,
  };
}

describe("track indexing", () => {
  const track = makeTrack(50);

  it("maps absolute video frames onto track offsets", () => {
    expect(trackIndex(track, 100)).toBe(0);
    expect(trackIndex(track, 149)).toBe(49);
  });

  it("rejects frames outside the analysed range", () => {
    expect(trackIndex(track, 99)).toBe(-1);
    expect(trackIndex(track, 150)).toBe(-1);
    expect(trackIndex(track, 0)).toBe(-1);
  });

  it("reads the landmark it was asked for, not its neighbour", () => {
    const point = imageAt(track, 110, LM.leftShoulder);
    expect(point).not.toBeNull();
    expect(point?.x).toBeCloseTo(0.01, 6);
    expect(point?.y).toBeCloseTo(LM.leftShoulder / 100, 6);
  });

  it("keeps image and world spaces separate", () => {
    expect(imageAt(track, 105, LM.leftHip)?.x).toBeCloseTo(0.005, 6);
    expect(worldAt(track, 105, LM.leftHip)?.x).toBe(5);
    expect(worldAt(track, 105, LM.leftHip)?.y).toBe(LM.leftHip);
  });

  it("carries per-landmark visibility through", () => {
    expect(imageAt(track, 120, LM.rightWrist)?.v).toBeCloseTo(0.2, 6);
    expect(imageAt(track, 120, LM.leftWrist)?.v).toBeCloseTo(0.9, 6);
  });
});

describe("missing detections", () => {
  const track = makeTrack(10, [3, 4]);

  it("reports gaps rather than returning zeroed landmarks", () => {
    // Silently handing back (0, 0) would put a joint in the top-left corner
    // and quietly drag every average that reads it.
    expect(imageAt(track, 103, LM.nose)).toBeNull();
    expect(worldAt(track, 104, LM.nose)).toBeNull();
    expect(hasFrame(track, 103)).toBe(false);
    expect(hasFrame(track, 102)).toBe(true);
  });

  it("measures coverage over the analysed range", () => {
    expect(coverage(track)).toBeCloseTo(0.8, 6);
    expect(coverage(makeTrack(10))).toBe(1);
  });
});

describe("midpoint", () => {
  const track = makeTrack(5);

  it("averages two landmarks", () => {
    const centre = midpoint(
      imageAt(track, 102, LM.leftHip),
      imageAt(track, 102, LM.rightHip),
    );
    expect(centre?.y).toBeCloseTo((LM.leftHip + LM.rightHip) / 200, 6);
  });

  it("takes the worse of the two confidences", () => {
    const hands = midpoint(
      imageAt(track, 102, LM.leftWrist),
      imageAt(track, 102, LM.rightWrist),
    );
    expect(hands?.v).toBeCloseTo(0.2, 6);
  });

  it("propagates a missing endpoint instead of guessing", () => {
    expect(midpoint(imageAt(track, 102, LM.nose), null)).toBeNull();
    expect(midpoint(null, null)).toBeNull();
  });
});
