import type { SwingPhases } from "./phases";

/**
 * Inferring the slow-motion factor from the swing itself.
 *
 * The problem this solves is stated in `fps.ts` and `CaptureSheet.tsx`: a
 * phone that shoots 240fps writes a 60fps container with the slowdown already
 * rendered into it, and that file is byte-for-byte indistinguishable from
 * genuine 60fps footage as far as the browser is concerned. No API reports
 * the factor. Until now the user set it by hand, and every measurement
 * downstream inherited whatever they guessed.
 *
 * But the swing is a clock. A golf downswing — top of the backswing to
 * impact — takes about a quarter of a second, and it takes about a quarter of
 * a second for everybody. Tour players sit near 0.25s, amateurs nearer 0.30s,
 * and the spread across the whole population is far narrower than the 2x
 * steps between the slow-motion factors we have to choose between. Backswing
 * tempo, by contrast, varies enormously between golfers, which is why the
 * downswing is the interval this reads and not the whole swing.
 *
 * So: measure the downswing in container seconds, divide by what a downswing
 * actually takes, and the quotient is the factor. A 60fps clip whose P4-to-P7
 * spans 67 frames is showing 1.1 seconds of a movement that takes 0.28, and
 * the only sane reading of that is 4x slow motion.
 *
 * A note on why this is allowed to be approximate. The supported factors are
 * 1, 2, 4 and 8 — each twice the last — so landing on the right one needs the
 * estimate to be within about 40% of the truth, and a downswing that varied
 * that much between two golfers would be a different sport. The inference
 * fails safe: when the numbers do not look like a swing it declines rather
 * than guessing, and the manual override stays exactly where it was.
 */

/** Factors the capture sheet offers. The inference has to land on one of these. */
export const SUPPORTED_FACTORS: readonly number[] = [1, 2, 4, 8];

/**
 * Real-world seconds from the top of the backswing to impact.
 *
 * 0.28 rather than the 0.25 usually quoted for tour players: this app is
 * pointed at range sessions, and sitting the constant between the tour and
 * amateur figures keeps both populations inside the same snap window.
 */
export const TYPICAL_DOWNSWING_SECONDS = 0.28;

/**
 * How long a downswing is allowed to be, in real seconds, for the answer to
 * be believed. Generous on both sides — the point is to reject clips where
 * the phase detection found something that is not a swing at all, not to
 * police tempo.
 */
const DOWNSWING_MIN_SECONDS = 0.16;
const DOWNSWING_MAX_SECONDS = 0.55;

/**
 * Backswing-to-downswing ratio a real swing falls inside. The coaching
 * shorthand is 3:1; the bounds here admit everything from a hurried 1.6:1 to
 * a very slow 5.5:1 and reject the rest, which catches tracks where P1 landed
 * in the middle of a waggle.
 */
const TEMPO_MIN = 1.6;
const TEMPO_MAX = 5.5;

export interface SlowdownEstimate {
  /** Best factor from `SUPPORTED_FACTORS`. */
  factor: number;
  /** The unsnapped quotient, before rounding to a supported factor. */
  raw: number;
  /** Downswing length as the container tells it. */
  downswingMediaSeconds: number;
  /** Downswing length in real seconds, once `factor` is applied. */
  downswingRealSeconds: number;
  /** Backswing / downswing, in frames. The 3:1 the coaching books quote. */
  tempo: number;
  /**
   * How far the snapped factor sits from the raw quotient, in octaves — 0 is
   * an exact hit, 0.5 is halfway to the neighbouring factor. Past about 0.5
   * the two candidates are equally good and the answer is a coin toss, which
   * is worth saying out loud rather than hiding behind a confident number.
   */
  drift: number;
  /**
   * False when this does not look like a swing being filmed. The estimate is
   * still returned so the panel can show its working, but nothing should be
   * applied from it.
   */
  confident: boolean;
}

/** Nearest supported factor in log space, since the factors step by doubling. */
function snap(raw: number): number {
  let best = SUPPORTED_FACTORS[0] ?? 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const factor of SUPPORTED_FACTORS) {
    const distance = Math.abs(Math.log2(raw / factor));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = factor;
    }
  }
  return best;
}

/**
 * Estimates the baked-in slow-motion factor from detected phases.
 *
 * Returns null only when the inputs are unusable — no phases, no frame rate,
 * a downswing of zero frames. A clip that simply does not look like a swing
 * comes back with `confident: false` and the numbers that led there.
 */
export function inferSlowdown(
  phases: SwingPhases | null,
  fps: number,
): SlowdownEstimate | null {
  if (!phases || !Number.isFinite(fps) || fps <= 0) return null;

  const downswingFrames = phases.p7 - phases.p4;
  const backswingFrames = phases.p4 - phases.p1;
  if (downswingFrames <= 0) return null;

  const downswingMediaSeconds = downswingFrames / fps;
  const raw = downswingMediaSeconds / TYPICAL_DOWNSWING_SECONDS;
  const factor = snap(raw);
  const downswingRealSeconds = downswingMediaSeconds / factor;
  const tempo = backswingFrames / downswingFrames;
  const drift = Math.abs(Math.log2(raw / factor));

  const confident =
    phases.confident &&
    downswingRealSeconds >= DOWNSWING_MIN_SECONDS &&
    downswingRealSeconds <= DOWNSWING_MAX_SECONDS &&
    tempo >= TEMPO_MIN &&
    tempo <= TEMPO_MAX &&
    // Four frames of downswing is 15 real milliseconds a frame at 4x. Below
    // that a single frame of P7 error moves the estimate by a quarter, and
    // the snap stops being safely inside its window.
    downswingFrames >= 4;

  return {
    factor,
    raw,
    downswingMediaSeconds,
    downswingRealSeconds,
    tempo,
    drift,
    confident,
  };
}

/** One line of plain English for the panel, explaining what it concluded. */
export function describeSlowdown(estimate: SlowdownEstimate): string {
  const media = estimate.downswingMediaSeconds.toFixed(2);
  const real = estimate.downswingRealSeconds.toFixed(2);
  if (!estimate.confident) {
    return `Downswing reads ${media}s on screen, which is not a shape this can infer a factor from. Set it by hand.`;
  }
  return `Downswing runs ${media}s on screen and ${real}s for real at ${estimate.factor}x — tempo ${estimate.tempo.toFixed(1)}:1.`;
}
