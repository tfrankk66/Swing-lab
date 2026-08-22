import { LANDMARK_COUNT } from "./pose";
import type { ModelQuality } from "./pose";

/**
 * Landmark storage for an analysed range.
 *
 * Flat typed arrays rather than the array-of-objects MediaPipe hands back:
 * later phases sweep the same landmark across every frame (wrist speed to find
 * the top of the swing, hip travel to find early extension), and a strided
 * read over a Float32Array is the shape that work wants.
 *
 * A 500-frame swing costs about 330KB for both arrays, so nothing here needs
 * to be clever about size.
 */

export interface Point {
  /** Normalised 0..1 across the video frame. */
  x: number;
  y: number;
  /** Relative depth. Weak — treat as a hint, never as a measurement. */
  z: number;
  /** Model confidence for this landmark, 0..1. */
  v: number;
}

export interface SwingTrack {
  fps: number;
  /** Absolute video frame the analysis started at. */
  startFrame: number;
  /** Number of consecutive frames analysed. */
  count: number;
  /** Source video pixel dimensions, for aspect-correct angle maths. */
  videoWidth: number;
  videoHeight: number;
  /** Dimensions actually fed to the model after downscaling. */
  analyzedWidth: number;
  analyzedHeight: number;
  /** count * 33 * 4 — x, y, z, visibility. Normalised image space. */
  image: Float32Array;
  /** count * 33 * 3 — metres, origin at the hip midpoint. */
  world: Float32Array;
  /** 1 where a pose was detected, 0 where the frame came back empty. */
  found: Uint8Array;
  quality: ModelQuality;
  delegate: "GPU" | "CPU";
  /** Wall-clock milliseconds the pass took, for the "next time" estimate. */
  elapsedMs: number;
  /** Time spent waiting on the decoder to land on each frame. */
  seekMs: number;
  /** Time spent downscaling and running the model. */
  detectMs: number;
  /** Frames the streaming pass detected without seeking. */
  streamed: number;
  /** Frames the streaming pass skipped, recovered afterwards by seeking. */
  filled: number;
  /** Frames the streaming pass skipped over, counted as it went. Drives the
   *  playback-rate backoff; `filled` is the authoritative count. */
  missed: number;
}

export const IMAGE_STRIDE = LANDMARK_COUNT * 4;
export const WORLD_STRIDE = LANDMARK_COUNT * 3;

/** Index of an absolute video frame within the track, or -1 if outside it. */
export function trackIndex(track: SwingTrack, frame: number): number {
  const index = frame - track.startFrame;
  return index >= 0 && index < track.count ? index : -1;
}

export function hasFrame(track: SwingTrack, frame: number): boolean {
  const index = trackIndex(track, frame);
  return index >= 0 && track.found[index] === 1;
}

/** Reads one landmark in normalised image space. Null when unavailable. */
export function imageAt(
  track: SwingTrack,
  frame: number,
  landmark: number,
): Point | null {
  const index = trackIndex(track, frame);
  if (index < 0 || track.found[index] !== 1) return null;
  const at = index * IMAGE_STRIDE + landmark * 4;
  return {
    x: track.image[at] ?? 0,
    y: track.image[at + 1] ?? 0,
    z: track.image[at + 2] ?? 0,
    v: track.image[at + 3] ?? 0,
  };
}

/** Reads one landmark in world space (metres, hip-centred). */
export function worldAt(
  track: SwingTrack,
  frame: number,
  landmark: number,
): Point | null {
  const index = trackIndex(track, frame);
  if (index < 0 || track.found[index] !== 1) return null;
  const at = index * WORLD_STRIDE + landmark * 3;
  return {
    x: track.world[at] ?? 0,
    y: track.world[at + 1] ?? 0,
    z: track.world[at + 2] ?? 0,
    v: 1,
  };
}

/** Midpoint of two landmarks — hip centre, shoulder centre, and so on. */
export function midpoint(a: Point | null, b: Point | null): Point | null {
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    v: Math.min(a.v, b.v),
  };
}

export function coverage(track: SwingTrack): number {
  let found = 0;
  for (let i = 0; i < track.count; i++) if (track.found[i] === 1) found++;
  return track.count === 0 ? 0 : found / track.count;
}
