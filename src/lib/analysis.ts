import { getLandmarker, LANDMARK_COUNT, type ModelQuality } from "./pose";
import { frameToTime } from "./frames";
import { IMAGE_STRIDE, WORLD_STRIDE, type SwingTrack } from "./track";

export interface AnalysisProgress {
  done: number;
  total: number;
  /** Frames per second of analysis, for the time-remaining estimate. */
  rate: number;
  stage: "loading-model" | "detecting";
}

export interface AnalysisOptions {
  fps: number;
  /** Inclusive absolute frame range. */
  from: number;
  to: number;
  quality: ModelQuality;
}

/**
 * Longest edge fed to the model.
 *
 * BlazePose resizes its input to 256x256 internally, so handing it a 4K frame
 * buys nothing in accuracy and costs a full-resolution texture upload on every
 * call. Downscaling into a small working canvas first is a straight saving,
 * and landmarks come back normalised, so no coordinates need adjusting.
 */
const MAX_EDGE = 720;

/** Yield to the event loop no more often than this, in milliseconds. */
const YIELD_EVERY_MS = 100;

/**
 * Longest span of clip the detection pass will accept, in seconds of media.
 *
 * Every frame in the range is a seek and a model call — together a couple of
 * hundred milliseconds — so cost is linear in the range and no decode trick
 * changes that. A swing is about a second and a half; fifteen seconds is loose
 * enough to hold an address, a waggle and a follow-through without the trim
 * having to be surgical, and short enough that the pass finishes while you
 * wait.
 */
export const MAX_ANALYSIS_SECONDS = 15;

/** Frames that span covers at a given rate, which is what the trim is measured in. */
export function maxAnalysisFrames(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(1, Math.round(MAX_ANALYSIS_SECONDS * fps));
}

/** Resolves once the video has actually painted the requested time. */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 1e-6) {
      resolve();
      return;
    }
    let timer = 0;
    const done = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", done);
      resolve();
    };
    // A seek past the end, or into a damaged region, can leave `seeked`
    // unfired. Better a missing frame than a hung analysis.
    timer = window.setTimeout(done, 2000);
    video.addEventListener("seeked", done);
    video.currentTime = time;
  });
}

/**
 * Runs pose detection across a frame range.
 *
 * Seeks to each frame rather than playing through with
 * `requestVideoFrameCallback`. Playing is faster — the decoder runs linearly —
 * but it only ever hands over the frames it managed to present, so a slow
 * detection pass silently thins the sample. The measurements in v0.4 assume a
 * gapless series, and finding impact within a frame or two depends on actually
 * having every frame. Determinism wins over speed here.
 *
 * Seek and detect time are tracked separately because they call for opposite
 * fixes: detect-bound means a smaller model or fewer pixels, seek-bound means
 * the decoder is the wall and only a different decode path gets past it.
 */
export async function analyzeRange(
  video: HTMLVideoElement,
  options: AnalysisOptions,
  onProgress: (progress: AnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<SwingTrack | null> {
  const { fps, from, to, quality } = options;
  const total = Math.max(0, to - from + 1);
  if (total === 0) return null;

  onProgress({ done: 0, total, rate: 0, stage: "loading-model" });
  const { landmarker, delegate } = await getLandmarker(quality);
  if (signal?.aborted) return null;

  video.pause();
  const restoreTime = video.currentTime;

  const sourceWidth = video.videoWidth || 1;
  const sourceHeight = video.videoHeight || 1;
  const shrink = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const work = document.createElement("canvas");
  work.width = Math.max(1, Math.round(sourceWidth * shrink));
  work.height = Math.max(1, Math.round(sourceHeight * shrink));
  const workCtx = work.getContext("2d", { alpha: false });
  if (!workCtx) throw new Error("Could not create a 2D context for analysis.");

  const image = new Float32Array(total * IMAGE_STRIDE);
  const world = new Float32Array(total * WORLD_STRIDE);
  const found = new Uint8Array(total);

  const startedAt = performance.now();
  let seekMs = 0;
  let detectMs = 0;
  let lastYield = startedAt;
  // detectForVideo rejects a timestamp that doesn't advance, and at 240fps
  // consecutive frames round to the same millisecond, so keep our own clock.
  let stamp = 0;

  for (let index = 0; index < total; index++) {
    if (signal?.aborted) {
      video.currentTime = restoreTime;
      return null;
    }

    const beforeSeek = performance.now();
    await seekTo(video, frameToTime(from + index, fps));
    const afterSeek = performance.now();
    seekMs += afterSeek - beforeSeek;

    stamp += 1;
    let result;
    try {
      workCtx.drawImage(video, 0, 0, work.width, work.height);
      result = landmarker.detectForVideo(work, stamp);
    } catch {
      result = null;
    }
    detectMs += performance.now() - afterSeek;

    const pose = result?.landmarks?.[0];
    const posesWorld = result?.worldLandmarks?.[0];

    if (pose && pose.length === LANDMARK_COUNT) {
      found[index] = 1;
      const imageBase = index * IMAGE_STRIDE;
      const worldBase = index * WORLD_STRIDE;
      for (let id = 0; id < LANDMARK_COUNT; id++) {
        const point = pose[id];
        if (!point) continue;
        const at = imageBase + id * 4;
        image[at] = point.x;
        image[at + 1] = point.y;
        image[at + 2] = point.z;
        // `visibility` is optional in the type; absent means the model didn't
        // score it, which we treat as fully visible rather than invisible.
        image[at + 3] = point.visibility ?? 1;

        const worldPoint = posesWorld?.[id];
        if (worldPoint) {
          const wat = worldBase + id * 3;
          world[wat] = worldPoint.x;
          world[wat + 1] = worldPoint.y;
          world[wat + 2] = worldPoint.z;
        }
      }
    }

    const done = index + 1;
    const now = performance.now();
    // Yield on a clock, not a frame count. setTimeout(0) is clamped to about
    // 4ms once nested, so yielding every fourth frame spent a tenth of the
    // budget waiting for timers.
    if (now - lastYield >= YIELD_EVERY_MS || done === total) {
      lastYield = now;
      const elapsed = now - startedAt;
      onProgress({
        done,
        total,
        rate: elapsed > 0 ? (done / elapsed) * 1000 : 0,
        stage: "detecting",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  video.currentTime = restoreTime;

  return {
    fps,
    startFrame: from,
    count: total,
    videoWidth: sourceWidth,
    videoHeight: sourceHeight,
    analyzedWidth: work.width,
    analyzedHeight: work.height,
    image,
    world,
    found,
    quality,
    delegate,
    elapsedMs: performance.now() - startedAt,
    seekMs,
    detectMs,
  };
}
