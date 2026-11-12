import type { Metric, Verdict } from "./metrics";

/**
 * The curated drill library, and the rules that pick from it.
 *
 * This is the half of coaching that works with no signal. It is plain data
 * plus a ranking, so it runs at the range on a phone in airplane mode, and it
 * is what the Claude coach is constrained to choose from: Claude explains and
 * prioritises, but it can only prescribe drills that are written down here.
 * That keeps the advice to things a person has actually checked, instead of
 * whatever a language model can describe convincingly.
 *
 * ## Direction matters
 *
 * A red spine-tilt light means nothing until you know which side of the band
 * it fell on — too tall and too bent are opposite lessons with opposite
 * drills. So every drill names the metric **and the direction** it fixes. The
 * one-sided bands (`good: [0, x]`) can only be off high, and say so.
 */

/** Which side of the good band a reading fell on. */
export type Direction = "high" | "low";

export interface Drill {
  id: string;
  name: string;
  /** The faults this drill addresses, by metric id and direction. */
  fixes: ReadonlyArray<{ metric: string; direction: Direction }>;
  /** What you need, in one line. */
  kit: string;
  steps: readonly string[];
  /** What it should feel like when it is right — the part people remember. */
  feel: string;
  reps: string;
}

/**
 * What each metric's fault is called, per direction.
 *
 * Only directions a metric can actually be off appear. A one-sided band
 * (good starting at 0) has no "low".
 */
export const FAULT_LABEL: Record<string, Partial<Record<Direction, string>>> = {
  "spine-tilt": { high: "Bent over too far", low: "Standing too tall" },
  "posture-loss": { high: "Standing up through the ball" },
  "early-extension": { high: "Hips pushing toward the ball" },
  "head-sway": { high: "Head sliding off the ball" },
  "head-lift": { high: "Head rising or dipping" },
  "knee-flex": { high: "Legs too straight", low: "Squatting too deep" },
  "arm-hang": { high: "Hands not under the shoulders" },
  "hand-plane": { high: "Backswing too upright", low: "Backswing too flat" },
  tempo: { high: "Backswing too long for the downswing", low: "Rushed transition" },
};

export const DRILLS: readonly Drill[] = [
  {
    id: "spine-club-hinge",
    name: "Club down the spine",
    fixes: [
      { metric: "spine-tilt", direction: "high" },
      { metric: "spine-tilt", direction: "low" },
    ],
    kit: "One club, no ball",
    steps: [
      "Stand tall and hold a club flat against your back, touching the back of your head, between your shoulder blades and your tailbone.",
      "Push your hips back and tip forward from the hip joints until your arms would hang freely, keeping all three contact points on the club.",
      "If the club leaves your head you are rounding; if it leaves your tailbone you are squatting rather than hinging.",
      "Take the club away, keep the shape, and let your arms hang.",
    ],
    feel: "Weight in the middle of the feet, chest over the balls of the feet, back flat rather than curled.",
    reps: "Ten setups before every session, then one before the first ball of each set.",
  },
  {
    id: "hands-hang",
    name: "Let the arms hang",
    fixes: [{ metric: "arm-hang", direction: "high" }],
    kit: "One club",
    steps: [
      "Hinge into your posture with the club resting against your leg, arms completely relaxed.",
      "Let both arms hang straight down from the shoulders. Wherever they fall is where the grip goes.",
      "Take your grip there, then set the club behind the ball without reaching for it — move your feet, not your hands.",
    ],
    feel: "Hands roughly a fist to a hand-width from the thighs with an iron; nothing stretched, nothing jammed.",
    reps: "Every setup for a week, until it stops feeling like a drill.",
  },
  {
    id: "athletic-knees",
    name: "Hop and land",
    fixes: [
      { metric: "knee-flex", direction: "high" },
      { metric: "knee-flex", direction: "low" },
    ],
    kit: "Nothing",
    steps: [
      "Stand in your stance width and do a small hop, a couple of centimetres off the ground.",
      "Land softly and freeze. The knee bend you land in is about the right amount for address.",
      "Hinge forward from the hips from there without bending the knees any further.",
    ],
    feel: "Ready to move side to side, like a defender — not sitting, not locked.",
    reps: "Three hops before each set until the setup finds it on its own.",
  },
  {
    id: "chair-drill",
    name: "Backside on the chair",
    fixes: [
      { metric: "early-extension", direction: "high" },
      { metric: "posture-loss", direction: "high" },
    ],
    kit: "A chair, a bag or an alignment stick in the ground behind you",
    steps: [
      "Set up so your backside just touches the chair back (or the top of the bag) behind you.",
      "Make slow half swings. At the top, the trail side of your backside should still be touching it.",
      "Through impact, the lead side of your backside should move back onto it — not away from it toward the ball.",
      "Build up to three-quarter speed, keeping contact on the way through.",
    ],
    feel: "The hips turn and move back as you swing through; the belt buckle does not push toward the ball.",
    reps: "Twenty slow swings, then hit five balls feeling the same thing.",
  },
  {
    id: "crossed-arms-turn",
    name: "Crossed-arm turns",
    fixes: [
      { metric: "posture-loss", direction: "high" },
      { metric: "early-extension", direction: "high" },
      { metric: "head-lift", direction: "high" },
    ],
    kit: "One club across your chest",
    steps: [
      "Take your posture and hold a club across your chest with both arms crossed over it.",
      "Turn back until the club points at the ball, keeping your spine angle.",
      "Turn through until the club points at the target. At the point where impact would be, your chest should still be facing down at the ground.",
      "Hold the finish and check that you have not stood up.",
    ],
    feel: "You turn around your spine like a door on a hinge, rather than lifting out of it.",
    reps: "Fifteen turns, slow, then a set of ten at swing speed.",
  },
  {
    id: "wall-head",
    name: "Head on the wall",
    fixes: [
      { metric: "head-sway", direction: "high" },
      { metric: "head-lift", direction: "high" },
    ],
    kit: "A wall and a folded towel or cushion",
    steps: [
      "Face a wall in your posture with no club and rest your forehead on a folded towel against it.",
      "Cross your arms over your chest and make backswing and through-swing turns.",
      "The towel should stay pressed the same amount the whole time: no sliding along the wall, no pushing in or lifting off.",
    ],
    feel: "The body turns underneath a head that stays put.",
    reps: "Twenty turns in each direction.",
  },
  {
    id: "feet-together",
    name: "Feet together",
    fixes: [
      { metric: "head-sway", direction: "high" },
      { metric: "tempo", direction: "low" },
      { metric: "early-extension", direction: "high" },
    ],
    kit: "A short iron and a few balls",
    steps: [
      "Set up with your feet touching.",
      "Hit balls with smooth, three-quarter swings.",
      "Any sway or lunge will throw you off balance, so the only way to stay standing is to turn in place at an even pace.",
    ],
    feel: "Balanced in the finish for a count of three, with nothing rushed.",
    reps: "Ten balls at the start of a session.",
  },
  {
    id: "plane-stick",
    name: "Plane stick",
    fixes: [
      { metric: "hand-plane", direction: "high" },
      { metric: "hand-plane", direction: "low" },
    ],
    kit: "An alignment stick or a spare club",
    steps: [
      "Push an alignment stick into the ground just outside the ball, angled back toward you so it runs up along your shaft line at address.",
      "Make slow backswings. Your hands should travel up just under the stick and stay on that side of it.",
      "If the hands go above the stick you are going up rather than round; if they drop well below it and behind you, you are too flat.",
    ],
    feel: "Hands going up and around at the same time, finishing above the trail shoulder.",
    reps: "Ten slow backswings, then five swings with a ball.",
  },
  {
    id: "wall-takeaway",
    name: "Wall behind",
    fixes: [{ metric: "hand-plane", direction: "low" }],
    kit: "A wall, and a club held at the shaft",
    steps: [
      "Set up with your backside about a forearm's length from a wall behind you.",
      "Take the club back to hip height. It must not touch the wall.",
      "Carry on to the top without the club head clattering into the wall behind you.",
    ],
    feel: "The club working up rather than whipping round behind you.",
    reps: "Fifteen slow takeaways.",
  },
  {
    id: "trail-elbow-down",
    name: "Trail elbow points down",
    fixes: [{ metric: "hand-plane", direction: "high" }],
    kit: "One club",
    steps: [
      "Take the club to the top and stop.",
      "Check the trail elbow: it should point roughly at the ground, not out behind you like a chicken wing.",
      "Make the backswing again with the feeling that the trail arm folds down and the hands go round as much as up.",
    ],
    feel: "Hands over the trail shoulder, not above the head.",
    reps: "Ten backswings with a pause at the top.",
  },
  {
    id: "pause-at-top",
    name: "Pause at the top",
    fixes: [{ metric: "tempo", direction: "low" }],
    kit: "A mid iron and some balls",
    steps: [
      "Make a full backswing and stop at the top for a silent count of one.",
      "Start the downswing from the ground up: lead foot pressure, then hips, then arms.",
      "Hit the ball from the pause. It will feel slow; it is not.",
    ],
    feel: "A complete backswing before anything starts down.",
    reps: "Ten balls, then ten without the pause trying to keep the same feel.",
  },
  {
    id: "count-tempo",
    name: "Count it out",
    fixes: [
      { metric: "tempo", direction: "low" },
      { metric: "tempo", direction: "high" },
    ],
    kit: "Nothing, or a metronome app",
    steps: [
      "Say 'one, two, three' through the backswing, arriving at the top on three.",
      "Say 'four' at impact. The downswing gets one count to the backswing's three.",
      "With a metronome, set three beats back and one down at whatever pace is comfortable; the ratio matters, not the speed.",
    ],
    feel: "An even backswing and a downswing that happens on its own count.",
    reps: "A full session with one ball in three swung to the count.",
  },
  {
    id: "continuous-swings",
    name: "Continuous swings",
    fixes: [{ metric: "tempo", direction: "high" }],
    kit: "One club, no ball",
    steps: [
      "Swing back and through continuously without stopping at either end, like a pendulum.",
      "Let the club's weight set the rhythm. Do not hold it at the top.",
      "After five, stop at address and hit a ball with the same rhythm.",
    ],
    feel: "The backswing flows into the downswing with no hang time.",
    reps: "Three sets of five, each followed by a ball.",
  },
];

const BY_ID = new Map(DRILLS.map((drill) => [drill.id, drill]));

export function drillById(id: string): Drill | undefined {
  return BY_ID.get(id);
}

/** Which side of the good band a reading fell on, or null if inside it. */
export function directionOf(metric: Metric): Direction | null {
  if (metric.value === null || !Number.isFinite(metric.value)) return null;
  if (metric.value > metric.good[1]) return "high";
  if (metric.value < metric.good[0]) return "low";
  return null;
}

/**
 * How far outside the good band, measured against the amber zone on that side.
 *
 * 1.0 is the edge of amber, so anything past 1 is red. Comparing raw degrees
 * against percentages against tempo ratios would be meaningless; this puts
 * every metric on the same scale so they can be ranked against each other.
 */
export function severity(metric: Metric): number {
  const direction = directionOf(metric);
  if (direction === null || metric.value === null) return 0;
  if (direction === "high") {
    const zone = metric.watch[1] - metric.good[1] || 1;
    return (metric.value - metric.good[1]) / zone;
  }
  const zone = metric.good[0] - metric.watch[0] || 1;
  return (metric.good[0] - metric.value) / zone;
}

export interface Prescription {
  metric: Metric;
  direction: Direction;
  label: string;
  verdict: Verdict;
  drills: Drill[];
}

/** The most faults worth working on at once. More than this is a list, not a plan. */
export const MAX_PRIORITIES = 3;

/** Drills offered per fault. */
const DRILLS_PER_FAULT = 2;

/**
 * Picks what to work on from the nine readings.
 *
 * Only amber and red readings count, and an unread one never does — there is
 * nothing to prescribe for a number that was not measured. Faults are ranked
 * by severity, so a red outranks an amber and a reading far outside its band
 * outranks one just over the line. A drill already given for a higher fault
 * is not repeated lower down; a later fault gets its next-best drill instead,
 * which is how a chair drill for early extension does not also become the
 * whole answer for posture loss.
 */
export function prescribe(metrics: ReadonlyArray<Metric>): Prescription[] {
  const faults = metrics
    .filter((m) => m.verdict === "watch" || m.verdict === "crit")
    .map((metric) => ({ metric, direction: directionOf(metric) }))
    .filter(
      (f): f is { metric: Metric; direction: Direction } => f.direction !== null,
    )
    .sort((a, b) => severity(b.metric) - severity(a.metric))
    .slice(0, MAX_PRIORITIES);

  const used = new Set<string>();
  return faults.map(({ metric, direction }) => {
    const matching = DRILLS.filter((drill) =>
      drill.fixes.some((f) => f.metric === metric.id && f.direction === direction),
    );
    const fresh = matching.filter((d) => !used.has(d.id));
    const chosen = (fresh.length > 0 ? fresh : matching).slice(0, DRILLS_PER_FAULT);
    for (const drill of chosen) used.add(drill.id);
    return {
      metric,
      direction,
      label: FAULT_LABEL[metric.id]?.[direction] ?? metric.name,
      verdict: metric.verdict,
      drills: chosen,
    };
  });
}
