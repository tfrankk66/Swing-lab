import type { Point, SwingTrack } from "./track";

/**
 * Plane geometry for the measurements.
 *
 * Everything here works in *pixels*, not the normalised 0..1 coordinates the
 * track stores, and that distinction is the whole reason this file exists.
 * Normalised coordinates divide x by the frame width and y by its height, so
 * on a 16:9 clip one unit of x is 1.78 times longer than one unit of y. Any
 * angle taken from them is wrong — a true 45 degrees reads as 60.7 — and it
 * is wrong by a different amount on a phone shot in portrait. Converting to
 * pixels first restores the aspect ratio, which is what `videoWidth` and
 * `videoHeight` are kept on the track for.
 *
 * Image convention throughout: y grows downward. Angles are reported the way
 * a person would describe them, so "20 degrees from vertical" is 20 either
 * side of straight up, never 340.
 */

export interface Vec {
  x: number;
  y: number;
}

/** Normalised track coordinates to pixels of the source video. */
export function toPixels(point: Point, track: SwingTrack): Vec {
  return { x: point.x * track.videoWidth, y: point.y * track.videoHeight };
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

const DEGREES = 180 / Math.PI;

/**
 * Tilt of the segment a→b away from straight up, in degrees, 0..180.
 *
 * Unsigned on purpose. A signed answer would need to know which way the
 * golfer faces, and the app deliberately never asks: see `phases.ts` on why
 * handedness is something to design around rather than detect.
 */
export function tiltFromVertical(a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return 0;
  // Straight up in image space is (0, -1).
  return Math.abs(Math.atan2(dx, -dy)) * DEGREES;
}

/** Tilt of the segment a→b away from horizontal, in degrees, 0..90. */
export function tiltFromHorizontal(a: Vec, b: Vec): number {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(dy, dx) * DEGREES;
}

/**
 * Interior angle at `b` in the path a→b→c, in degrees, 0..180.
 *
 * This is the joint-angle form: hip, knee, ankle gives knee flex, where 180
 * is a locked leg and smaller numbers are more bend.
 */
export function jointAngle(a: Vec, b: Vec, c: Vec): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (lengths === 0) return 0;
  const cosine = (ux * vx + uy * vy) / lengths;
  // Floating point drift puts this a hair outside [-1, 1] on straight limbs,
  // where acos returns NaN — and a NaN knee angle silently poisons a verdict.
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * DEGREES;
}

export function midpointOf(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Where the line through a and b crosses the box's left and right edges.
 *
 * Reference lines are only useful drawn all the way across the picture — a
 * plane line that stops at the two hand positions it was fitted through shows
 * the golfer nothing about where the rest of the swing sat relative to it.
 * Returns null for a vertical line, which has no such crossing; callers draw
 * those top-to-bottom instead.
 */
export function extendAcross(
  a: Vec,
  b: Vec,
  width: number,
): [Vec, Vec] | null {
  const dx = b.x - a.x;
  if (dx === 0) return null;
  const slope = (b.y - a.y) / dx;
  return [
    { x: 0, y: a.y + (0 - a.x) * slope },
    { x: width, y: a.y + (width - a.x) * slope },
  ];
}
