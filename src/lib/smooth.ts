import { LANDMARK_COUNT } from "./pose";
import { IMAGE_STRIDE, WORLD_STRIDE, type SwingTrack } from "./track";

/**
 * Trajectory smoothing.
 *
 * Every frame is detected on its own, with nothing tying it to the frames
 * either side, so a landmark that the model is unsure about wanders by a few
 * pixels a frame. On screen that reads as a skeleton that will not sit still.
 * It matters more than it looks: phase detection works by finding where a
 * trajectory reverses or peaks, and single-frame noise invents reversals that
 * were never in the swing.
 *
 * A median rather than an average, because the failure being corrected is a
 * spike — one frame where an elbow is somewhere else entirely — and an average
 * drags the whole neighbourhood towards the bad value instead of ignoring it.
 * A median also leaves a genuine peak where it is, which matters when the peak
 * is the top of the backswing and we are about to go looking for it.
 *
 * Centred, not trailing: this runs on a finished track, so there is no reason
 * to accept the half-window of lag a causal filter would cost.
 */

/** Frames either side of the centre. 2 gives a five-frame window. */
export const DEFAULT_RADIUS = 2;

/**
 * Median of the present values within `radius` of each index.
 *
 * Absent frames contribute nothing and are left absent — a gap in the track is
 * a frame where no pose was found, and inventing a position for it would put a
 * skeleton on screen that the model never saw.
 */
export function smoothSeries(
  values: readonly number[],
  present: readonly boolean[],
  radius: number = DEFAULT_RADIUS,
): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  const window: number[] = [];

  for (let i = 0; i < n; i++) {
    if (!present[i]) {
      out[i] = values[i] ?? 0;
      continue;
    }
    window.length = 0;
    // Shrink the window at the ends rather than letting it go one-sided. A
    // truncated window is an off-centre one, and an off-centre median drags a
    // rising trajectory towards whichever side has more samples — which at
    // frame zero is exactly the address position phase detection reads.
    const reach = Math.min(radius, i, n - 1 - i);
    const from = i - reach;
    const to = i + reach;
    for (let j = from; j <= to; j++) {
      if (present[j]) window.push(values[j] ?? 0);
    }
    if (window.length === 0) {
      out[i] = values[i] ?? 0;
      continue;
    }
    window.sort((a, b) => a - b);
    const mid = window.length >> 1;
    out[i] =
      window.length % 2 === 1
        ? (window[mid] ?? 0)
        : ((window[mid - 1] ?? 0) + (window[mid] ?? 0)) / 2;
  }
  return out;
}

/**
 * A copy of the track with every landmark trajectory smoothed.
 *
 * Visibility is smoothed along with position. It is the model's own confidence
 * and it flickers for the same reason the coordinates do, and the overlay
 * decides whether to dash a bone from it.
 */
export function smoothTrack(
  track: SwingTrack,
  radius: number = DEFAULT_RADIUS,
): SwingTrack {
  if (track.count < 3 || radius < 1) return track;

  const image = new Float32Array(track.image);
  const world = new Float32Array(track.world);
  const present: boolean[] = new Array(track.count);
  for (let i = 0; i < track.count; i++) present[i] = track.found[i] === 1;

  const series = new Array<number>(track.count);

  for (let id = 0; id < LANDMARK_COUNT; id++) {
    // x, y, z and visibility in image space.
    for (let axis = 0; axis < 4; axis++) {
      for (let i = 0; i < track.count; i++) {
        series[i] = image[i * IMAGE_STRIDE + id * 4 + axis] ?? 0;
      }
      const smoothed = smoothSeries(series, present, radius);
      for (let i = 0; i < track.count; i++) {
        image[i * IMAGE_STRIDE + id * 4 + axis] = smoothed[i] ?? 0;
      }
    }
    // x, y and z in world space.
    for (let axis = 0; axis < 3; axis++) {
      for (let i = 0; i < track.count; i++) {
        series[i] = world[i * WORLD_STRIDE + id * 3 + axis] ?? 0;
      }
      const smoothed = smoothSeries(series, present, radius);
      for (let i = 0; i < track.count; i++) {
        world[i * WORLD_STRIDE + id * 3 + axis] = smoothed[i] ?? 0;
      }
    }
  }

  return { ...track, image, world };
}
