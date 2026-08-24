import {
  distance,
  jointAngle,
  midpointOf,
  tiltFromHorizontal,
  tiltFromVertical,
  toPixels,
  type Vec,
} from "./geom";
import type { SwingPhases } from "./phases";
import { LM } from "./pose";
import { imageAt, type SwingTrack } from "./track";

/**
 * The nine measurements, and what counts as out.
 *
 * Every number here is read at address, at the top, or at impact — the three
 * frames `phases.ts` finds — and every one of them is a plane-geometry fact
 * about where landmarks sat, converted to pixels first so the frame's aspect
 * ratio does not tilt the answer. See `geom.ts` on why that conversion is not
 * optional.
 *
 * ## On the thresholds
 *
 * These are not measured norms. There is no public dataset of BlazePose
 * landmarks on down-the-line swings with tour averages attached, and inventing
 * the precision of one would be worse than useless — it would put a red light
 * next to a number nobody has any business acting on.
 *
 * What they are: coaching consensus, converted into landmark terms and set
 * deliberately wide. Spine tilt of 30-40 degrees at address, a downswing that
 * holds it within a few degrees, a head that stays where it started, tempo
 * near 3:1 — these are things every teaching pro says, and the bands are
 * generous around them. Treat a green light as "nothing here is obviously
 * wrong", not as a certificate, and treat the bands as a starting point to be
 * tightened once there are real numbers from real sessions to tighten them
 * against.
 *
 * The one measurement with a hard physical limit is anything read at impact,
 * and that limit lives in `impactResolutionCm`.
 */

/**
 * Landmark confidence below which a measurement is refused rather than made.
 *
 * The overlay draws low-confidence bones dashed rather than hiding them,
 * because a strobing skeleton is worse than an uncertain one. A number is the
 * opposite case: there is no way to print "38 degrees" faintly enough that
 * someone will not act on it, so an unreliable landmark yields no reading.
 */
const MIN_VISIBILITY = 0.5;

export type Verdict = "good" | "watch" | "crit" | "unknown";

export interface Metric {
  id: string;
  /** Short name, for the left column of the log book. */
  name: string;
  /** Where in the swing it is read — the small print under the name. */
  where: string;
  /** Null when the landmarks it needs were not visible enough to use. */
  value: number | null;
  unit: string;
  /** Decimal places to print. */
  precision: number;
  /** Inside this, the light is green. */
  good: [number, number];
  /** Inside this but outside `good`, amber. Outside it, red. */
  watch: [number, number];
  /** Range the band strip is drawn across, so the value has somewhere to sit. */
  scale: [number, number];
  verdict: Verdict;
  /** Frame the reading was taken at, for tap-to-seek. */
  frame: number | null;
  /** What a reading outside the band means, in the language of a lesson. */
  fault: string;
  /** What this measurement cannot see. Shown when the light is not green. */
  caveat?: string;
}

function within(value: number, [lo, hi]: [number, number]): boolean {
  return value >= lo && value <= hi;
}

function judge(
  value: number | null,
  good: [number, number],
  watch: [number, number],
): Verdict {
  if (value === null || !Number.isFinite(value)) return "unknown";
  if (within(value, good)) return "good";
  if (within(value, watch)) return "watch";
  return "crit";
}

/** One landmark in pixels, or null if the model was not sure enough of it. */
function at(track: SwingTrack, frame: number, landmark: number): Vec | null {
  const point = imageAt(track, frame, landmark);
  if (!point || point.v < MIN_VISIBILITY) return null;
  return toPixels(point, track);
}

/** Midpoint of a left/right pair, null unless both were visible. */
function pair(
  track: SwingTrack,
  frame: number,
  left: number,
  right: number,
): Vec | null {
  const a = at(track, frame, left);
  const b = at(track, frame, right);
  return a && b ? midpointOf(a, b) : null;
}

/**
 * The length every displacement is reported as a percentage of.
 *
 * Pixels mean nothing across clips — the same sway is twice the pixels if the
 * golfer stood half as far from the phone. Shoulders-to-ankles is the longest
 * span reliably in frame on a down-the-line shot, and dividing by it makes
 * "3% of stature" comparable between sessions, cameras and golfers.
 *
 * Feet do get cropped, and the framing note in the intake asks for them but
 * does not get them every time. The fallback rebuilds the same span from the
 * torso: shoulders-to-hips is close to 40% of shoulders-to-ankles on adult
 * proportions, so scaling by 2.5 lands near enough for a denominator.
 */
function stature(track: SwingTrack, frame: number): number | null {
  const shoulders = pair(track, frame, LM.leftShoulder, LM.rightShoulder);
  if (!shoulders) return null;

  const ankles = pair(track, frame, LM.leftAnkle, LM.rightAnkle);
  if (ankles) return distance(shoulders, ankles);

  const hips = pair(track, frame, LM.leftHip, LM.rightHip);
  if (!hips) return null;
  return distance(shoulders, hips) * 2.5;
}

/** Hip-centre to shoulder-centre. The line every posture reading is taken from. */
function spine(track: SwingTrack, frame: number): [Vec, Vec] | null {
  const hips = pair(track, frame, LM.leftHip, LM.rightHip);
  const shoulders = pair(track, frame, LM.leftShoulder, LM.rightShoulder);
  return hips && shoulders ? [hips, shoulders] : null;
}

/** Wrist midpoint — the hands, as `phases.ts` defines them. */
function hands(track: SwingTrack, frame: number): Vec | null {
  return pair(track, frame, LM.leftWrist, LM.rightWrist);
}

/**
 * Knee angle at the more visible of the two legs.
 *
 * Down the line, the trail leg is partly behind the lead one and the model's
 * confidence in it collapses accordingly. Taking whichever leg it can see
 * best beats averaging a good reading with a guess.
 */
function kneeFlex(track: SwingTrack, frame: number): number | null {
  const sides: ReadonlyArray<readonly [number, number, number]> = [
    [LM.leftHip, LM.leftKnee, LM.leftAnkle],
    [LM.rightHip, LM.rightKnee, LM.rightAnkle],
  ];

  let best: number | null = null;
  let bestVisibility = -1;
  for (const [hip, knee, ankle] of sides) {
    const visibility = imageAt(track, frame, knee)?.v ?? 0;
    if (visibility <= bestVisibility) continue;
    const a = at(track, frame, hip);
    const b = at(track, frame, knee);
    const c = at(track, frame, ankle);
    if (!a || !b || !c) continue;
    bestVisibility = visibility;
    best = jointAngle(a, b, c);
  }
  return best;
}

/** Displacement between two frames as a percentage of stature. */
function travelPercent(
  from: Vec | null,
  to: Vec | null,
  scale: number | null,
  axis: "x" | "y" | "both",
): number | null {
  if (!from || !to || !scale || scale <= 0) return null;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const moved = axis === "x" ? dx : axis === "y" ? dy : Math.hypot(dx, dy);
  return (moved / scale) * 100;
}

/**
 * Reads all nine metrics off a track.
 *
 * Always returns nine rows, in a fixed order, whatever it could measure. A
 * row that could not be read comes back with a null value and an "unknown"
 * light rather than being dropped: a list that changes length depending on
 * what the model saw is one you cannot compare against last week's, and the
 * absence of a measurement is itself worth showing.
 */
export function computeMetrics(
  track: SwingTrack | null,
  phases: SwingPhases | null,
): Metric[] {
  const p1 = phases?.p1 ?? null;
  const p4 = phases?.p4 ?? null;
  const p7 = phases?.p7 ?? null;

  // Stature is fixed at address and reused: measuring it again at impact
  // would fold the golfer's own extension into the denominator, shrinking
  // every displacement it is supposed to be normalising.
  const scale = track && p1 !== null ? stature(track, p1) : null;

  const spineAddress = track && p1 !== null ? spine(track, p1) : null;
  const spineImpact = track && p7 !== null ? spine(track, p7) : null;

  const tiltAddress = spineAddress
    ? tiltFromVertical(spineAddress[0], spineAddress[1])
    : null;
  const tiltImpact = spineImpact
    ? tiltFromVertical(spineImpact[0], spineImpact[1])
    : null;
  const postureLoss =
    tiltAddress !== null && tiltImpact !== null
      ? Math.abs(tiltImpact - tiltAddress)
      : null;

  const hipsAddress = track && p1 !== null ? pair(track, p1, LM.leftHip, LM.rightHip) : null;
  const hipsImpact = track && p7 !== null ? pair(track, p7, LM.leftHip, LM.rightHip) : null;
  const noseAddress = track && p1 !== null ? at(track, p1, LM.nose) : null;
  const noseImpact = track && p7 !== null ? at(track, p7, LM.nose) : null;

  const handsAddress = track && p1 !== null ? hands(track, p1) : null;
  const handsTop = track && p4 !== null ? hands(track, p4) : null;
  const shouldersAddress =
    track && p1 !== null ? pair(track, p1, LM.leftShoulder, LM.rightShoulder) : null;

  const armHang =
    handsAddress && shouldersAddress && scale
      ? (Math.abs(handsAddress.x - shouldersAddress.x) / scale) * 100
      : null;

  const handPlane =
    handsAddress && handsTop ? tiltFromHorizontal(handsAddress, handsTop) : null;

  const tempo =
    p1 !== null && p4 !== null && p7 !== null && p7 - p4 > 0
      ? (p4 - p1) / (p7 - p4)
      : null;

  const rows: Array<Omit<Metric, "verdict">> = [
    {
      id: "spine-tilt",
      name: "Spine tilt",
      where: "at address",
      value: tiltAddress,
      unit: "°",
      precision: 0,
      good: [28, 42],
      watch: [22, 48],
      scale: [0, 60],
      frame: p1,
      fault:
        "Standing too tall crowds the arms and forces a flat, handsy takeaway; bending too far puts the weight on the toes and the swing loses its base.",
      caveat:
        "Hip-centre to shoulder-centre, which is the line of the torso rather than the curve of the spine. A rounded upper back reads as more bend than a teacher measuring off the shoulder blades would call it.",
    },
    {
      id: "posture-loss",
      name: "Posture loss",
      where: "address to impact",
      value: postureLoss,
      unit: "°",
      precision: 0,
      good: [0, 5],
      watch: [0, 9],
      scale: [0, 20],
      frame: p7,
      fault:
        "Standing up out of the shot through the downswing. It changes the low point of the arc, and the hands have to save it — usually with a flip.",
      caveat:
        "Reads the change in torso angle, which stand-up and a lateral slide both produce. Look at early extension alongside it to tell them apart.",
    },
    {
      id: "early-extension",
      name: "Early extension",
      where: "address to impact",
      value: travelPercent(hipsAddress, hipsImpact, scale, "x"),
      unit: "%",
      precision: 1,
      good: [0, 3.5],
      watch: [0, 7],
      scale: [0, 14],
      frame: p7,
      fault:
        "The hips have pushed toward the ball instead of turning, taking away the room the arms needed to swing through. The most common amateur fault this app can see.",
      caveat:
        "Horizontal hip travel in the picture, as a share of stature. A camera that was not square down the line converts some of the golfer's rotation into apparent travel, so a badly placed phone inflates this.",
    },
    {
      id: "head-sway",
      name: "Head sway",
      where: "address to impact",
      value: travelPercent(noseAddress, noseImpact, scale, "x"),
      unit: "%",
      precision: 1,
      good: [0, 3],
      watch: [0, 6],
      scale: [0, 12],
      frame: p7,
      fault:
        "The head has moved off the ball horizontally, which moves the bottom of the arc with it and makes strike depth a timing problem.",
      caveat:
        "The nose landmark, not the skull's centre. A head that rotates without moving still shifts the nose a little.",
    },
    {
      id: "head-lift",
      name: "Head lift",
      where: "address to impact",
      value: travelPercent(noseAddress, noseImpact, scale, "y"),
      unit: "%",
      precision: 1,
      good: [0, 3],
      watch: [0, 6],
      scale: [0, 12],
      frame: p7,
      fault:
        "Rising or dropping through impact. Usually the same move posture loss is showing, seen from the other end of the body.",
      caveat:
        "Vertical only, so a dip on the way down that has returned by impact reads as nothing. Scrub the contact sheet to see the shape rather than the endpoints.",
    },
    {
      id: "knee-flex",
      name: "Knee flex",
      where: "at address",
      value: track && p1 !== null ? kneeFlex(track, p1) : null,
      unit: "°",
      precision: 0,
      good: [152, 170],
      watch: [142, 177],
      scale: [130, 180],
      frame: p1,
      fault:
        "180 is a locked leg with nothing to turn against; under about 145 is a squat that the downswing has to stand up out of.",
      caveat:
        "Taken from whichever leg the model saw more clearly. Down the line the trail leg hides behind the lead one, so this is usually the lead knee.",
    },
    {
      id: "arm-hang",
      name: "Arm hang",
      where: "at address",
      value: armHang,
      unit: "%",
      precision: 1,
      good: [0, 6],
      watch: [0, 12],
      scale: [0, 20],
      frame: p1,
      fault:
        "The hands are not under the shoulders. Reaching pulls the swing flat and the strike toward the toe; hands too close jam the arms against the body on the way down.",
      caveat:
        "Horizontal distance between the wrist midpoint and the shoulder midpoint. Longer clubs legitimately sit further from the body, so a driver reads higher than a wedge and neither is wrong.",
    },
    {
      id: "hand-plane",
      name: "Hand plane",
      where: "address to top",
      value: handPlane,
      unit: "°",
      precision: 0,
      good: [40, 58],
      watch: [32, 66],
      scale: [20, 80],
      frame: p4,
      fault:
        "Below the band the hands have travelled around the body — flat, and it comes down from the inside. Above it they have gone up rather than round, which steepens the downswing and leaves it over the top.",
      caveat:
        "This is the hands' plane, not the shaft's. The club sits steeper than the hands do — typically ten to fifteen degrees — so do not compare this number to a shaft-plane reading from a system that tracks the club. v0.7 adds the clubhead.",
    },
    {
      id: "tempo",
      name: "Tempo",
      where: "back : down",
      value: tempo,
      unit: ":1",
      precision: 1,
      good: [2.6, 3.4],
      watch: [2.0, 4.2],
      scale: [1, 6],
      frame: p4,
      fault:
        "The 3:1 ratio holds across almost every good player at every speed — it is the proportion that matters, not how fast the swing is. Well under it is a rushed transition; well over it is a backswing the downswing never catches up with.",
      caveat:
        "Counted in frames, so it is immune to the slow-motion factor being wrong — the one measurement here that does not depend on getting capture settings right.",
    },
  ];

  return rows.map((row) => ({
    ...row,
    // Phases that phases.ts is not confident in describe some movement that
    // is not a swing. The geometry would still produce numbers, and they
    // would be numbers about the wrong three frames.
    verdict:
      phases?.confident === true
        ? judge(row.value, row.good, row.watch)
        : "unknown",
  }));
}

/** How many of the nine came back green, amber, red, and unread. */
export function tally(metrics: ReadonlyArray<Metric>): Record<Verdict, number> {
  const counts: Record<Verdict, number> = {
    good: 0,
    watch: 0,
    crit: 0,
    unknown: 0,
  };
  for (const metric of metrics) counts[metric.verdict]++;
  return counts;
}

/** Formats a value for the log book, or an em dash when there is none. */
export function formatMetric(metric: Metric): string {
  if (metric.value === null || !Number.isFinite(metric.value)) return "—";
  return metric.value.toFixed(metric.precision);
}
