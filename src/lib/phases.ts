import { LM } from "./pose";
import { DEFAULT_RADIUS } from "./smooth";
import { IMAGE_STRIDE, type SwingTrack } from "./track";

/**
 * Swing phase detection: address, top, impact.
 *
 * Coaching numbers the swing P1 to P10. Three of those carry almost all the
 * measurement: P1 address, P4 top of the backswing, P7 impact. Everything in
 * v0.4 is an angle or a distance read at one of them.
 *
 * All three are found from the hands — the midpoint of the two wrists — rather
 * than from a single lead wrist. Which wrist leads depends on whether the
 * golfer is right or left handed, and down the line the trail hand is the one
 * the model loses first when the arms blur. The midpoint survives both.
 *
 * Image space, so y grows downward: hands high at the top means y at its
 * smallest. Coordinates are normalised to the frame, which makes every
 * threshold here a fraction of frame height rather than a pixel count, and so
 * independent of how the clip was shot.
 */

export interface SwingPhases {
  /** Absolute video frame of address, the last still frame before takeaway. */
  p1: number;
  /** Absolute video frame of the top of the backswing. */
  p4: number;
  /** Absolute video frame of impact. */
  p7: number;
  /**
   * False when the swing does not look like a swing — the phases are still
   * returned, in order, but they are the best of a bad clip rather than
   * something to measure against.
   */
  confident: boolean;
}

/** Hand travel, as a fraction of frame height, that counts as the swing starting. */
const TAKEAWAY_TRAVEL = 0.02;

/** A swing needs at least this many frames of backswing to be believable. */
const MIN_BACKSWING_FRAMES = 3;

interface Hands {
  x: number[];
  y: number[];
  present: boolean[];
}

/** Wrist midpoint per frame, in normalised image space. */
export function handPath(track: SwingTrack): Hands {
  const x = new Array<number>(track.count).fill(0);
  const y = new Array<number>(track.count).fill(0);
  const present = new Array<boolean>(track.count).fill(false);

  for (let i = 0; i < track.count; i++) {
    if (track.found[i] !== 1) continue;
    const base = i * IMAGE_STRIDE;
    const lx = track.image[base + LM.leftWrist * 4] ?? 0;
    const ly = track.image[base + LM.leftWrist * 4 + 1] ?? 0;
    const rx = track.image[base + LM.rightWrist * 4] ?? 0;
    const ry = track.image[base + LM.rightWrist * 4 + 1] ?? 0;
    x[i] = (lx + rx) / 2;
    y[i] = (ly + ry) / 2;
    present[i] = true;
  }
  return { x, y, present };
}

/**
 * Frames at each end of a track that phase detection does not read.
 *
 * Two reasons, and they compound. The first frame of a run is the model's
 * cold detection — no tracking state behind it yet — so it routinely lands a
 * little off the frames that follow. And the smoothing window shrinks to
 * nothing at the ends (see smooth.ts), so that frame reaches us raw. The jump
 * from it to frame two was enough to beat the real downswing as "fastest", and
 * every phase was then built on it: a trim of 450–815 around a swing at
 * 636/755 came back as address 450, top 450, impact 451. Same width as the
 * smoothing radius, which is exactly the stretch that is not smoothed.
 */
export const EDGE_FRAMES = DEFAULT_RADIUS;

/** Marks the first and last few present frames absent, if there are enough. */
function trimEdges(hands: Hands): void {
  const present = hands.present;
  const indices: number[] = [];
  for (let i = 0; i < present.length; i++) if (present[i]) indices.push(i);
  if (indices.length <= EDGE_FRAMES * 2 + MIN_BACKSWING_FRAMES + 2) return;
  for (const i of [
    ...indices.slice(0, EDGE_FRAMES),
    ...indices.slice(-EDGE_FRAMES),
  ]) {
    present[i] = false;
  }
}

/** Index of the fastest hand movement between consecutive present frames. */
function fastestFrame(hands: Hands): number {
  let best = -1;
  let bestSpeed = -1;
  let previous = -1;
  for (let i = 0; i < hands.present.length; i++) {
    if (!hands.present[i]) continue;
    if (previous >= 0) {
      const dx = (hands.x[i] ?? 0) - (hands.x[previous] ?? 0);
      const dy = (hands.y[i] ?? 0) - (hands.y[previous] ?? 0);
      // Per frame, not per second: the gap between present frames is one frame
      // except across a dropout, and a dropout is not a burst of speed.
      const gap = i - previous;
      const speed = Math.sqrt(dx * dx + dy * dy) / gap;
      if (speed > bestSpeed) {
        bestSpeed = speed;
        best = i;
      }
    }
    previous = i;
  }
  return best;
}

/**
 * Finds address, top and impact in a pose track.
 *
 * The order the three are found in is not the order they happen in, because
 * each one is only unambiguous once another is known.
 *
 * The **fastest frame** comes first. Nothing else in a swing approaches the
 * speed of the hands through the downswing, so it needs no context — and it
 * lands between the top and the finish, which is what makes the other two
 * findable.
 *
 * **P4** is then the highest the hands get before that. Searching the whole
 * clip would find the finish instead: the hands finish higher than they ever
 * were at the top, which is the trap in looking for "hands highest".
 *
 * **P7** is where the hands come back through the height they started at, on
 * the way down from P4. The clubhead is what actually meets the ball and we do
 * not track it yet, but at impact the hands are within a centimetre or two of
 * where they addressed it, and that is a return the wrists show clearly.
 *
 * **P1** is found last, walking back from P4 to the last frame where the hands
 * had not yet moved from where they started.
 */
export function detectPhases(track: SwingTrack): SwingPhases | null {
  if (track.count < MIN_BACKSWING_FRAMES + 2) return null;

  const hands = handPath(track);
  trimEdges(hands);
  const first = hands.present.indexOf(true);
  if (first < 0) return null;

  const fast = fastestFrame(hands);
  if (fast < 0) return null;

  // P4: hands at their highest — smallest y — anywhere before the fastest
  // frame. Anything after it is the follow-through, where they go higher.
  let p4 = -1;
  let topY = Number.POSITIVE_INFINITY;
  for (let i = first; i <= fast; i++) {
    if (!hands.present[i]) continue;
    const y = hands.y[i] ?? 0;
    if (y < topY) {
      topY = y;
      p4 = i;
    }
  }
  if (p4 < 0) return null;

  // P1: walk back from the top to the last frame where the hands had not yet
  // left the address position.
  const startX = hands.x[first] ?? 0;
  const startY = hands.y[first] ?? 0;
  let p1 = first;
  for (let i = first; i <= p4; i++) {
    if (!hands.present[i]) continue;
    const dx = (hands.x[i] ?? 0) - startX;
    const dy = (hands.y[i] ?? 0) - startY;
    if (Math.sqrt(dx * dx + dy * dy) > TAKEAWAY_TRAVEL) break;
    p1 = i;
  }

  // P7: coming down from the top, the frame where the hands are nearest the
  // height they addressed the ball at. Searched forward from P4 and stopped
  // once they start climbing into the follow-through, so a finish that happens
  // to pass through the same height cannot win.
  const addressY = hands.y[p1] ?? 0;
  let p7 = -1;
  let closest = Number.POSITIVE_INFINITY;
  let lowestY = Number.NEGATIVE_INFINITY;
  for (let i = p4 + 1; i < track.count; i++) {
    if (!hands.present[i]) continue;
    const y = hands.y[i] ?? 0;
    // Past the lowest point of the swing the hands are rising again.
    if (y > lowestY) lowestY = y;
    else if (lowestY > addressY && i > fast) break;

    const distance = Math.abs(y - addressY);
    if (distance < closest) {
      closest = distance;
      p7 = i;
    }
  }
  if (p7 < 0) p7 = fast;

  const backswing = p4 - p1;
  const downswing = p7 - p4;
  const confident =
    backswing >= MIN_BACKSWING_FRAMES &&
    downswing >= 1 &&
    // A backswing is slower than a downswing in every swing ever filmed. If
    // this clip says otherwise, the phases are noise dressed as a swing.
    backswing > downswing;

  return {
    p1: track.startFrame + p1,
    p4: track.startFrame + p4,
    p7: track.startFrame + p7,
    confident,
  };
}
