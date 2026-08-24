import { frameToTime } from "./frames";
import type { SwingPhases } from "./phases";

/**
 * The contact sheet.
 *
 * A coach flipping through a swing on paper does not scrub — they lay the
 * positions out side by side and look at the shape of the sequence. That is
 * what this builds: a short row of stills spanning the trimmed swing, with
 * address, top and impact guaranteed to be among them.
 *
 * Capture is a second video element rather than the one on screen. Seeking is
 * the expensive part of every pass in this app and the player owns its own
 * playhead; driving it from here would fight playback and leave the readout
 * parked wherever the last thumbnail landed. A detached element with the same
 * object URL costs one more decoder and nothing else — the blob is already in
 * memory, so there is no second download.
 */

export interface Thumbnail {
  /** Absolute video frame this still was taken at. */
  frame: number;
  /** JPEG data URL. Small enough at thumbnail size to hold a dozen in state. */
  url: string;
  /** Which phase this frame is, when it is one. */
  label?: string;
}

/** Height to decode thumbnails at. Matches `.filmcell img` in the stylesheet. */
export const THUMB_HEIGHT = 96;

/**
 * Picks which frames to put on the sheet.
 *
 * Even spacing across the trim gives the sequence its rhythm, and the three
 * phases are then dropped in over whichever even frame sits nearest each of
 * them. Substituting rather than appending is what keeps the row evenly
 * spaced: a sheet with P4 wedged between two neighbours four frames away
 * reads as a mistake, and the phases are never far from where an even sample
 * would have landed anyway.
 */
export function filmstripFrames(
  trimIn: number,
  trimOut: number,
  phases: SwingPhases | null,
  count: number,
): Array<{ frame: number; label?: string }> {
  if (count <= 0 || trimOut < trimIn) return [];

  const span = trimOut - trimIn;
  const slots = Math.min(count, span + 1);
  const picked: Array<{ frame: number; label?: string }> = [];
  for (let i = 0; i < slots; i++) {
    const at = slots === 1 ? trimIn : trimIn + Math.round((span * i) / (slots - 1));
    picked.push({ frame: at });
  }

  if (phases) {
    const marks: ReadonlyArray<[number, string]> = [
      [phases.p1, "P1"],
      [phases.p4, "P4"],
      [phases.p7, "P7"],
    ];
    for (const [frame, label] of marks) {
      if (frame < trimIn || frame > trimOut) continue;
      // Nearest slot that is not already spoken for by another phase, so two
      // phases close together cannot collapse onto the same cell.
      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < picked.length; i++) {
        const slot = picked[i];
        if (!slot || slot.label) continue;
        const distance = Math.abs(slot.frame - frame);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      if (best >= 0) picked[best] = { frame, label };
    }
  }

  // Substitution can push a phase past its neighbour, and two even slots on a
  // short trim can round to the same frame. Sort and dedupe, keeping the
  // labelled copy of any frame that appears twice.
  picked.sort((a, b) => a.frame - b.frame);
  const out: Array<{ frame: number; label?: string }> = [];
  for (const slot of picked) {
    const previous = out[out.length - 1];
    if (previous && previous.frame === slot.frame) {
      if (slot.label && !previous.label) previous.label = slot.label;
      continue;
    }
    out.push({ ...slot });
  }
  return out;
}

/** Resolves on the next `event` from `target`, or rejects if aborted first. */
function once(
  target: EventTarget,
  event: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const done = () => {
      target.removeEventListener(event, done);
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const cancel = () => {
      target.removeEventListener(event, done);
      signal?.removeEventListener("abort", cancel);
      reject(new DOMException("aborted", "AbortError"));
    };
    target.addEventListener(event, done, { once: true });
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

/**
 * Decodes one still per requested frame.
 *
 * Thumbnails arrive through `onThumbnail` as each one lands rather than all
 * at the end. A dozen seeks is a second or two on a phone, and a sheet that
 * fills in left to right reads as working where an empty box reads as broken.
 */
export async function captureThumbnails(
  src: string,
  frames: ReadonlyArray<{ frame: number; label?: string }>,
  fps: number,
  onThumbnail: (thumb: Thumbnail) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (frames.length === 0) return;

  const video = document.createElement("video");
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await once(video, "loadedmetadata", signal);

    const aspect =
      video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
    const canvas = document.createElement("canvas");
    canvas.height = THUMB_HEIGHT;
    canvas.width = Math.max(1, Math.round(THUMB_HEIGHT * aspect));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    for (const slot of frames) {
      if (signal?.aborted) return;
      video.currentTime = frameToTime(slot.frame, fps);
      await once(video, "seeked", signal);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      onThumbnail({
        frame: slot.frame,
        label: slot.label,
        // 0.62 rather than the usual 0.8: these are 96px tall and never
        // zoomed, and a dozen of them at 0.8 is most of a megabyte of state.
        url: canvas.toDataURL("image/jpeg", 0.62),
      });
    }
  } catch (error) {
    // An abort is the caller changing its mind, not a failure.
    if ((error as DOMException)?.name !== "AbortError") throw error;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
