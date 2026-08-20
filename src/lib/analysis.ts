import { getLandmarker, LANDMARK_COUNT, type ModelQuality } from "./pose";
import { frameToTime } from "./frames";
import {
  IMAGE_STRIDE,
  WORLD_STRIDE,
  type SwingTrack,
} from "./track";

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

  const image = new Float32Array(total * IMAGE_STRIDE);
  const world = new Float32Array(total * WORLD_STRIDE);
  const found = new Uint8Array(total);

  const startedAt = performance.now();
  // detectForVideo rejects a timestamp that doesn't advance, and at 240fps
  // consecutive frames round to the same millisecond, so keep our own clock.
  let stamp = 0;

  for (let index = 0; index < total; index++) {
    if (signal?.aborted) {
      video.currentTime = restoreTime;
      return null;
    }

    await seekTo(video, frameToTime(from + index, fps));
    stamp += 1;

    let result;
    try {
      result = landmarker.detectForVideo(video, stamp);
    } catch {
      result = null;
    }

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
    const elapsed = performance.now() - startedAt;
    // Yield every few frames so the progress bar paints and cancel stays live.
    if (done % 4 === 0 || done === total) {
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
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    image,
    world,
    found,
    quality,
    delegate,
    elapsedMs: performance.now() - startedAt,
  };
}
