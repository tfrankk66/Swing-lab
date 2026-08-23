import { getLandmarker, LANDMARK_COUNT, type ModelQuality } from "./pose";
import { frameToTime, timeToFrame } from "./frames";
import { getRvfc } from "./fps";
import { IMAGE_STRIDE, WORLD_STRIDE, type SwingTrack } from "./track";

export interface AnalysisProgress {
  done: number;
  total: number;
  /** Frames per second of analysis, for the time-remaining estimate. */
  rate: number;
  stage: "loading-model" | "streaming" | "filling";
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

/** Yield to the event loop, and re-tune playback, no more often than this. */
const YIELD_EVERY_MS = 100;

/**
 * Ranges shorter than this skip the streaming pass.
 *
 * Starting playback costs a seek and a play/pause round trip. Over a handful
 * of frames that setup outweighs the seeks it saves.
 */
const STREAM_MIN_FRAMES = 30;

/** Chrome refuses to play below 1/16 speed; past that we accept missed frames. */
const MIN_RATE = 0.0625;
const MAX_RATE = 4;

/** One 60Hz frame — the fastest a display will present, so the fastest worth asking for. */
const MIN_BUDGET_MS = 16;
const MAX_BUDGET_MS = 400;

/** Give up on streaming if no frame presents for this long, and go seek instead. */
const STALL_MS = 3000;

/**
 * Longest span of clip the detection pass will accept, in seconds of media.
 *
 * Every frame in the range is a model call of tens of milliseconds, so cost is
 * linear in the range and nothing about the decode path changes that. A swing
 * is about a second and a half; fifteen seconds is loose enough to hold an
 * address, a waggle and a follow-through without the trim having to be
 * surgical, and short enough that the pass finishes while you wait.
 */
export const MAX_ANALYSIS_SECONDS = 15;

/** Frames that span covers at a given rate, which is what the trim is measured in. */
export function maxAnalysisFrames(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(1, Math.round(MAX_ANALYSIS_SECONDS * fps));
}

interface FrameMeta {
  mediaTime: number;
}

/**
 * Wall-clock milliseconds to allow per frame on the next stretch of streaming.
 *
 * Missing frames means we are asking the decoder and the model for more than
 * they can deliver, so back off hard: recovering one missed frame costs a seek,
 * which is worth many milliseconds of going slower. A clean stretch creeps the
 * budget back down towards what a model call actually costs.
 *
 * The floor is a 60Hz frame. Presenting faster than the display refreshes just
 * makes the compositor coalesce frames we would then have to seek back for.
 */
export function nextBudgetMs(
  budgetMs: number,
  perDetectMs: number,
  missed: number,
): number {
  const target = Math.max(MIN_BUDGET_MS, perDetectMs * 1.3);
  if (missed > 0) return Math.min(MAX_BUDGET_MS, budgetMs * 1.3);
  return Math.max(target, budgetMs * 0.9);
}

/** Playback rate that presents one frame per `budgetMs`, within what a browser accepts. */
export function rateForBudget(fps: number, budgetMs: number): number {
  if (!Number.isFinite(fps) || fps <= 0 || budgetMs <= 0) return 1;
  const rate = 1000 / fps / budgetMs;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
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
 * Two passes. The first plays the clip through and takes frames from
 * `requestVideoFrameCallback`, which is the decoder's linear path: no seek, no
 * pipeline flush, one decode per frame in the order the file stores them.
 * Playback is slowed to a rate the model can keep up with, so most frames get
 * presented rather than dropped.
 *
 * The second pass seeks to the frames the first one missed, and that is what
 * makes streaming safe to use at all. The objection to playing a clip through
 * is that it silently thins the sample, and the measurements in v0.4 assume a
 * gapless series. But a frame the streaming pass skipped is one it never marked
 * `settled`, and the fill pass seeks to every unsettled frame before the track
 * is returned, so the series is gapless whatever playback did.
 *
 * Nothing is inferred about *why* a frame was skipped. A presentation the
 * compositor dropped and a measured frame rate that overshoots the clip's real
 * one both show up as a jump in frame numbering, they are not reliably
 * distinguishable from the callback, and they want the same answer anyway.
 * Guessing "same decoded frame" and copying the previous landmarks across would
 * be the one failure worth avoiding here: it writes a pose into a frame the
 * model never saw, with nothing in the track to say so.
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
  const restoreRate = video.playbackRate;
  const restoreMuted = video.muted;

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
  /** 1 where we have an answer for the frame, whether or not a pose was in it. */
  const settled = new Uint8Array(total);

  const startedAt = performance.now();
  let seekMs = 0;
  let detectMs = 0;
  let done = 0;
  let streamed = 0;
  let filled = 0;
  let missed = 0;
  // detectForVideo rejects a timestamp that doesn't advance, and at 240fps
  // consecutive frames round to the same millisecond, so keep our own clock.
  let stamp = 0;
  // Smoothed cost of one model call. Seeds the playback rate before we have
  // measured anything, then follows it.
  let perDetectMs = 24;
  let lastYield = startedAt;

  const report = (stage: AnalysisProgress["stage"]) => {
    const elapsed = performance.now() - startedAt;
    onProgress({
      done,
      total,
      rate: elapsed > 0 ? (done / elapsed) * 1000 : 0,
      stage,
    });
  };

  /** Runs the model on whatever the video element is currently showing. */
  const detectInto = (index: number) => {
    const before = performance.now();
    stamp += 1;
    let result: Awaited<ReturnType<typeof landmarker.detectForVideo>> | null =
      null;
    try {
      workCtx.drawImage(video, 0, 0, work.width, work.height);
      result = landmarker.detectForVideo(work, stamp);
    } catch {
      result = null;
    }
    const cost = performance.now() - before;
    detectMs += cost;
    perDetectMs = perDetectMs * 0.8 + cost * 0.2;

    settled[index] = 1;
    done += 1;

    const pose = result?.landmarks?.[0];
    const posesWorld = result?.worldLandmarks?.[0];
    if (!pose || pose.length !== LANDMARK_COUNT) return;

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
  };

  /* ---------------------------------------------------------- streaming -- */

  const rvfc = getRvfc(video);

  if (rvfc && total >= STREAM_MIN_FRAMES) {
    const beforeSeek = performance.now();
    await seekTo(video, frameToTime(from, fps));
    seekMs += performance.now() - beforeSeek;

    if (signal?.aborted) {
      video.currentTime = restoreTime;
      return null;
    }

    // Half a frame past the last one we want, so the final frame presents.
    const endTime = frameToTime(to, fps) + 0.5 / fps;
    let budgetMs = Math.max(MIN_BUDGET_MS, perDetectMs * 1.3);
    let missedSinceTune = 0;

    video.muted = true;
    video.playbackRate = rateForBudget(fps, budgetMs);

    await new Promise<void>((resolve) => {
      let lastIndex = -1;
      let handle = 0;
      let stopped = false;
      let watchdog = 0;

      const stop = () => {
        if (stopped) return;
        stopped = true;
        window.clearTimeout(watchdog);
        video.removeEventListener("ended", stop);
        rvfc.cancel(handle);
        video.pause();
        resolve();
      };

      // A clip that stalls mid-play would otherwise hang the pass forever, and
      // the fill pass can finish the job by seeking.
      const arm = () => {
        window.clearTimeout(watchdog);
        watchdog = window.setTimeout(stop, STALL_MS);
      };

      const onFrame = (_now: number, meta: FrameMeta) => {
        if (stopped) return;
        if (signal?.aborted) {
          stop();
          return;
        }
        arm();

        const index = timeToFrame(meta.mediaTime, fps) - from;

        if (index >= 0 && index < total && settled[index] !== 1) {
          // Anything we skipped over stays unsettled, and the fill pass seeks
          // back for it. No inference needed about why it was skipped —
          // `settled` is the record, and it is exact.
          if (lastIndex >= 0 && index > lastIndex + 1) {
            const gap = index - lastIndex - 1;
            missed += gap;
            missedSinceTune += gap;
          }
          detectInto(index);
          streamed += 1;
          lastIndex = index;
        }

        const now = performance.now();
        if (now - lastYield >= YIELD_EVERY_MS) {
          lastYield = now;
          budgetMs = nextBudgetMs(budgetMs, perDetectMs, missedSinceTune);
          missedSinceTune = 0;
          video.playbackRate = rateForBudget(fps, budgetMs);
          report("streaming");
        }

        if (meta.mediaTime >= endTime) {
          stop();
          return;
        }
        handle = rvfc.request(onFrame);
      };

      video.addEventListener("ended", stop);
      arm();
      handle = rvfc.request(onFrame);
      video.play().catch(() => stop());
    });

    video.playbackRate = restoreRate;
    video.muted = restoreMuted;
  }

  /* ------------------------------------------------------------ filling -- */

  for (let index = 0; index < total; index++) {
    if (signal?.aborted) {
      video.currentTime = restoreTime;
      return null;
    }
    if (settled[index] === 1) continue;

    const beforeSeek = performance.now();
    await seekTo(video, frameToTime(from + index, fps));
    seekMs += performance.now() - beforeSeek;

    detectInto(index);
    filled += 1;

    // Yield on a clock, not a frame count. setTimeout(0) is clamped to about
    // 4ms once nested, so yielding every fourth frame spent a tenth of the
    // budget waiting for timers.
    const now = performance.now();
    if (now - lastYield >= YIELD_EVERY_MS) {
      lastYield = now;
      report("filling");
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
    streamed,
    filled,
    missed,
  };
}
