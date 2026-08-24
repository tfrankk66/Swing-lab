import { extendAcross } from "./geom";
import type { SwingPhases } from "./phases";
import { BONES, JOINTS, LM } from "./pose";
import { imageAt, midpoint, trackIndex, type SwingTrack } from "./track";

export interface OverlayTheme {
  bone: string;
  joint: string;
  weak: string;
  spine: string;
  /** Reference geometry — swing plane and butt line. Brass, so it reads as
   *  drawn onto the picture rather than found in it. */
  guide: string;
}

export interface OverlayOptions {
  theme: OverlayTheme;
  /** Below this visibility a bone is drawn faint rather than solid. */
  weakBelow: number;
  showSpine: boolean;
}

export const DEFAULT_OVERLAY: Omit<OverlayOptions, "theme"> = {
  weakBelow: 0.5,
  showSpine: true,
};

/**
 * Draws the skeleton for one frame onto a canvas already sized to the video's
 * displayed box.
 *
 * Low-confidence bones are drawn faint rather than hidden. Through the
 * downswing the trail arm is a blur and the model's confidence collapses;
 * dropping those bones makes the overlay strobe, and hiding uncertainty is
 * worse than showing it as uncertain.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  track: SwingTrack,
  frame: number,
  width: number,
  height: number,
  options: OverlayOptions,
): void {
  ctx.clearRect(0, 0, width, height);
  if (trackIndex(track, frame) < 0) return;

  const { theme, weakBelow, showSpine } = options;
  const scale = Math.min(width, height);
  const boneWidth = Math.max(2, scale * 0.006);
  const jointRadius = Math.max(2.5, scale * 0.008);

  const px = (nx: number) => nx * width;
  const py = (ny: number) => ny * height;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const [a, b] of BONES) {
    const from = imageAt(track, frame, a);
    const to = imageAt(track, frame, b);
    if (!from || !to) continue;

    const confident = Math.min(from.v, to.v) >= weakBelow;
    ctx.strokeStyle = confident ? theme.bone : theme.weak;
    ctx.lineWidth = confident ? boneWidth : boneWidth * 0.7;
    ctx.setLineDash(confident ? [] : [boneWidth * 1.5, boneWidth * 1.5]);

    ctx.beginPath();
    ctx.moveTo(px(from.x), py(from.y));
    ctx.lineTo(px(to.x), py(to.y));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Hip centre to shoulder centre. Not a MediaPipe bone, but it is the line
  // `spine-tilt` and `posture-loss` are both read off, so seeing it is what
  // makes those two numbers checkable by eye.
  if (showSpine) {
    const hips = midpoint(
      imageAt(track, frame, LM.leftHip),
      imageAt(track, frame, LM.rightHip),
    );
    const shoulders = midpoint(
      imageAt(track, frame, LM.leftShoulder),
      imageAt(track, frame, LM.rightShoulder),
    );
    if (hips && shoulders) {
      ctx.strokeStyle = theme.spine;
      ctx.lineWidth = boneWidth * 0.8;
      ctx.setLineDash([boneWidth * 2, boneWidth * 1.5]);
      ctx.beginPath();
      ctx.moveTo(px(hips.x), py(hips.y));
      ctx.lineTo(px(shoulders.x), py(shoulders.y));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  for (const id of JOINTS) {
    const point = imageAt(track, frame, id);
    if (!point) continue;
    ctx.fillStyle = point.v >= weakBelow ? theme.joint : theme.weak;
    ctx.beginPath();
    ctx.arc(px(point.x), py(point.y), jointRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Reads the overlay palette from CSS custom properties so it tracks theme. */
export function readTheme(element: HTMLElement): OverlayTheme {
  const styles = getComputedStyle(element);
  const value = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    // Fallbacks are the palette's own values, for the case where the custom
    // properties have not resolved yet — a stale fallback is a skeleton drawn
    // in last season's colours on the first frame after load.
    bone: value("--overlay-bone", "#fbfbff"),
    joint: value("--overlay-joint", "#01baef"),
    weak: value("--overlay-weak", "#8fa3a9"),
    spine: value("--overlay-spine", "#20bf55"),
    guide: value("--overlay-guide", "#e0b25c"),
  };
}

/* ------------------------------------------------------------ references -- */

export interface ReferenceOptions {
  /** The plane the hands travelled on, address to top, extended both ways. */
  plane: boolean;
  /** Vertical through the hips at address. Early extension crosses it. */
  butt: boolean;
}

export const DEFAULT_REFERENCES: ReferenceOptions = {
  plane: true,
  butt: true,
};

/**
 * Draws the two setup lines a coach would draw on a down-the-line still.
 *
 * Both are fixed to address and stay put as the clip plays, because that is
 * the entire point of a reference line: the golfer moves and the line does
 * not, so you can see what moved off it.
 *
 * **Butt line.** A vertical dropped through the hips at address. On paper a
 * coach draws this touching the golfer's backside, and pose landmarks have no
 * backside — the hip landmarks sit at the joint centres. So this line runs
 * through the hip midpoint instead, a few inches in front of where a coach
 * would put it. That offset is constant for a given setup, which is what
 * matters: early extension still shows as the hips crossing the line, and
 * `metrics.ts` measures the crossing rather than eyeballing it.
 *
 * **Plane line.** Through the hands at address and the hands at the top,
 * carried to both edges of the frame. This is the line `hand-plane` measures,
 * drawn so the number has something visible behind it — and it is the hands'
 * plane, not the shaft's, which the metric's caveat says at more length.
 */
export function drawReferences(
  ctx: CanvasRenderingContext2D,
  track: SwingTrack,
  phases: SwingPhases,
  width: number,
  height: number,
  theme: OverlayTheme,
  options: ReferenceOptions,
): void {
  const scale = Math.min(width, height);
  const lineWidth = Math.max(1.5, scale * 0.0035);
  const dash = [lineWidth * 4, lineWidth * 3];

  ctx.save();
  ctx.strokeStyle = theme.guide;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dash);
  ctx.lineCap = "butt";

  if (options.butt) {
    const hips = midpoint(
      imageAt(track, phases.p1, LM.leftHip),
      imageAt(track, phases.p1, LM.rightHip),
    );
    if (hips) {
      const x = hips.x * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      label(ctx, theme, "BUTT", x + lineWidth * 2, height - scale * 0.02, scale);
    }
  }

  if (options.plane) {
    const address = midpoint(
      imageAt(track, phases.p1, LM.leftWrist),
      imageAt(track, phases.p1, LM.rightWrist),
    );
    const top = midpoint(
      imageAt(track, phases.p4, LM.leftWrist),
      imageAt(track, phases.p4, LM.rightWrist),
    );
    if (address && top) {
      const from = { x: address.x * width, y: address.y * height };
      const to = { x: top.x * width, y: top.y * height };
      const ends = extendAcross(from, to, width);
      if (ends) {
        ctx.beginPath();
        ctx.moveTo(ends[0].x, ends[0].y);
        ctx.lineTo(ends[1].x, ends[1].y);
        ctx.stroke();
        label(ctx, theme, "PLANE", from.x + scale * 0.02, from.y - scale * 0.015, scale);
      }
    }
  }

  ctx.restore();
}

/**
 * Small caps label for a reference line.
 *
 * Set in a dark keyline as well as fill: these sit on footage, and brass on a
 * bright sky is unreadable without something behind it.
 */
function label(
  ctx: CanvasRenderingContext2D,
  theme: OverlayTheme,
  text: string,
  x: number,
  y: number,
  scale: number,
): void {
  const size = Math.max(9, scale * 0.022);
  ctx.save();
  ctx.setLineDash([]);
  ctx.font = `${size}px ui-monospace, Consolas, monospace`;
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = Math.max(2, size * 0.22);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = theme.guide;
  ctx.fillText(text, x, y);
  ctx.restore();
}
