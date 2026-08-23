import { BONES, JOINTS, LM } from "./pose";
import { imageAt, midpoint, trackIndex, type SwingTrack } from "./track";

export interface OverlayTheme {
  bone: string;
  joint: string;
  weak: string;
  spine: string;
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
  // every spine-angle measurement in v0.4 is taken from, so it is worth
  // seeing on screen from the start.
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
    joint: value("--accent", "#01baef"),
    weak: value("--overlay-weak", "#8fa3a9"),
    spine: value("--tracer", "#20bf55"),
  };
}
