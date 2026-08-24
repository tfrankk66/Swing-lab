/** Frame <-> time conversion, and seeking that lands on the frame you asked for. */

export function frameCount(duration: number, fps: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || fps <= 0) return 0;
  return Math.max(1, Math.floor(duration * fps));
}

export function timeToFrame(time: number, fps: number): number {
  return Math.floor(time * fps + 1e-6);
}

/**
 * Aims at the middle of the frame rather than its leading edge. Seeking to an
 * exact boundary lands on either side depending on rounding inside the
 * decoder, which makes frame-stepping drift by one.
 */
export function frameToTime(frame: number, fps: number): number {
  return (frame + 0.5) / fps;
}

export function clampFrame(frame: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, frame));
}

export function seekToFrame(
  video: HTMLVideoElement,
  frame: number,
  fps: number,
  total: number,
): void {
  const target = frameToTime(clampFrame(frame, total), fps);
  if (Number.isFinite(target)) video.currentTime = target;
}

/**
 * A window of `span` frames centred on `centre`, slid to fit inside the clip.
 *
 * Centred rather than starting at the playhead because you park on impact —
 * the moment you can actually recognise scrubbing past — and the swing runs
 * both ways from there. Near either end the window slides instead of
 * shrinking, so a short clip still gets the full span it asked for.
 */
export function windowAround(
  centre: number,
  span: number,
  total: number,
): { in: number; out: number } {
  if (total <= 0 || span <= 0) return { in: 0, out: 0 };
  const width = Math.min(span, total);
  let start = Math.round(centre - (width - 1) / 2);
  start = Math.min(start, total - width);
  start = Math.max(0, start);
  return { in: start, out: start + width - 1 };
}

/** `1:04.28` — minutes, seconds, hundredths. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.00";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

/**
 * Real-world duration of a span, accounting for slow-motion capture.
 *
 * A 240fps clip written into a 30fps container plays back 8x slowed, so
 * on-screen seconds are not wall-clock seconds. `slowdown` is that factor
 * (1 = real time). Since v0.4 it is inferred from the detected downswing
 * rather than guessed at — see `slowmo.ts` — unless the user has set one.
 */
export function realSeconds(mediaSeconds: number, slowdown: number): number {
  return slowdown > 0 ? mediaSeconds / slowdown : mediaSeconds;
}

/** Frames per real-world second — the number that decides impact accuracy. */
export function effectiveFps(fps: number, slowdown: number): number {
  return fps * (slowdown > 0 ? slowdown : 1);
}

/**
 * How far a 100mph clubhead travels between frames, in centimetres. This is
 * the honest limit on any impact-position measurement.
 */
export function impactResolutionCm(effective: number): number {
  const CLUBHEAD_METRES_PER_SECOND = 44.7; // 100 mph
  if (effective <= 0) return Infinity;
  return (CLUBHEAD_METRES_PER_SECOND / effective) * 100;
}
