/**
 * Frame-rate detection.
 *
 * There is no browser API that reports a video's frame rate, so we measure it
 * from `requestVideoFrameCallback`, which fires once per frame the compositor
 * actually presents and hands us that frame's `mediaTime`.
 *
 * The trap: rVFC fires at the *display* refresh rate, not the video's. Play a
 * 240fps clip at 1x on a 60Hz screen and the browser presents every 4th frame,
 * so consecutive `mediaTime` values are 1/60 apart and the clip looks like
 * 60fps. Slowing playback fixes it — at 0.15x a 240fps clip only needs to
 * present 36 frames per real second, well inside a 60Hz budget, so every frame
 * gets its own callback and the deltas are the true 1/240.
 *
 * So: sample fast at 1x, and only if the answer comes back suspiciously close
 * to the display refresh rate do we pay for a slow second pass.
 */

export type FrameRateSource = "measured" | "assumed" | "manual";

export interface FrameRateResult {
  fps: number;
  source: FrameRateSource;
  /** How many usable frame-to-frame deltas the measurement is built on. */
  samples: number;
  /** True when we slowed playback to defeat display-refresh aliasing. */
  slowPass: boolean;
}

/** Rates real cameras and phones actually shoot. Measurements snap to these. */
const COMMON_RATES = [
  23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 200,
  239.76, 240,
];

const SNAP_TOLERANCE = 0.04; // 4% — wide enough for 29.97 vs 30, tight enough to keep 100 and 120 apart.

interface FrameMeta {
  mediaTime: number;
  presentedFrames: number;
}

type RvfcCallback = (now: number, meta: FrameMeta) => void;

/** Returns a bound `requestVideoFrameCallback`, or null where it isn't supported (Firefox). */
function getRvfc(video: HTMLVideoElement) {
  const el = video as unknown as Record<string, unknown>;
  const request = el["requestVideoFrameCallback"];
  const cancel = el["cancelVideoFrameCallback"];
  if (typeof request !== "function" || typeof cancel !== "function") return null;
  return {
    request: (cb: RvfcCallback) =>
      (request as (cb: RvfcCallback) => number).call(video, cb),
    cancel: (handle: number) =>
      (cancel as (h: number) => void).call(video, handle),
  };
}

export function supportsFrameCallback(video: HTMLVideoElement): boolean {
  return getRvfc(video) !== null;
}

/**
 * Pulls a noisy measurement onto a rate a camera actually shoots.
 *
 * Whole rates beat NTSC ones inside the tolerance window even when the NTSC
 * rate is marginally nearer. A phone shooting 240 that measures 239.4 is
 * closer to 239.76, but reporting "239.76 fps" for footage the camera app
 * labelled 240 reads as a bug, and this tool is asking you to trust its
 * numbers. The cost is misreporting genuine 29.97 broadcast footage as 30 —
 * a 0.1% error, which over a two-second swing is a sixteenth of a frame.
 */
export function snapToCommonRate(raw: number): number {
  const within = COMMON_RATES.filter(
    (rate) => Math.abs(rate - raw) / rate <= SNAP_TOLERANCE,
  );
  if (within.length === 0) return Math.round(raw * 100) / 100;

  const whole = within.filter((rate) => Number.isInteger(rate));
  const pool = whole.length > 0 ? whole : within;

  return pool.reduce((best, rate) =>
    Math.abs(rate - raw) < Math.abs(best - raw) ? rate : best,
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Rough display refresh rate, used to decide whether a measurement is aliased. */
async function measureRefreshRate(): Promise<number> {
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const tick = (t: number) => {
      stamps.push(t);
      if (stamps.length < 10) {
        requestAnimationFrame(tick);
        return;
      }
      const deltas: number[] = [];
      for (let i = 1; i < stamps.length; i++) {
        deltas.push((stamps[i] ?? 0) - (stamps[i - 1] ?? 0));
      }
      const dt = median(deltas);
      resolve(dt > 0 ? 1000 / dt : 60);
    };
    requestAnimationFrame(tick);
  });
}

interface PassResult {
  fps: number | null;
  samples: number;
}

/**
 * Plays a short stretch at `rate` and derives frame duration from consecutive
 * callbacks. Only pairs where `presentedFrames` advanced by exactly one are
 * used, so a dropped frame contributes nothing rather than doubling the answer.
 */
async function samplePass(
  video: HTMLVideoElement,
  rate: number,
  wanted: number,
  timeoutMs: number,
): Promise<PassResult> {
  const rvfc = getRvfc(video);
  if (!rvfc) return { fps: null, samples: 0 };

  const deltas: number[] = [];
  let previous: FrameMeta | null = null;
  let handle = 0;
  let timer = 0;

  video.playbackRate = rate;
  try {
    await video.play();
  } catch {
    return { fps: null, samples: 0 };
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      rvfc.cancel(handle);
      resolve();
    };

    timer = window.setTimeout(finish, timeoutMs);

    const onFrame: RvfcCallback = (_now, meta) => {
      if (previous) {
        const framesAdvanced = meta.presentedFrames - previous.presentedFrames;
        const dt = meta.mediaTime - previous.mediaTime;
        // One presented frame, and a plausible duration (2000fps .. 5fps).
        if (framesAdvanced === 1 && dt > 0.0005 && dt < 0.2) deltas.push(dt);
      }
      previous = meta;
      if (deltas.length >= wanted) {
        finish();
        return;
      }
      handle = rvfc.request(onFrame);
    };

    handle = rvfc.request(onFrame);
  });

  video.pause();
  if (deltas.length < 4) return { fps: null, samples: deltas.length };
  return { fps: 1 / median(deltas), samples: deltas.length };
}

/**
 * Measures the frame rate of a loaded video, restoring playback position,
 * rate, mute state and paused state before it resolves.
 */
export async function detectFrameRate(
  video: HTMLVideoElement,
): Promise<FrameRateResult> {
  const fallback: FrameRateResult = {
    fps: 30,
    source: "assumed",
    samples: 0,
    slowPass: false,
  };
  if (!getRvfc(video) || !Number.isFinite(video.duration)) return fallback;

  const restore = {
    time: video.currentTime,
    paused: video.paused,
    rate: video.playbackRate,
    muted: video.muted,
    loop: video.loop,
  };

  video.muted = true;
  video.loop = false;
  // Start a little way in: the first frames after a seek are the ones most
  // likely to be dropped while the decoder catches up.
  video.currentTime = Math.min(0.2, video.duration * 0.1);

  try {
    const refreshRate = await measureRefreshRate();

    const quick = await samplePass(video, 1, 24, 1500);
    let fps = quick.fps;
    let samples = quick.samples;
    let slowPass = false;

    // Within 15% of the refresh rate means we may be seeing the screen's
    // cadence rather than the file's. Re-measure slowly to find out.
    const looksAliased =
      fps !== null && Math.abs(fps - refreshRate) / refreshRate < 0.15;

    if (fps === null || looksAliased) {
      video.currentTime = Math.min(0.2, video.duration * 0.1);
      const slow = await samplePass(video, 0.15, 20, 4000);
      if (slow.fps !== null) {
        fps = slow.fps;
        samples = slow.samples;
        slowPass = true;
      }
    }

    if (fps === null) return fallback;
    return { fps: snapToCommonRate(fps), source: "measured", samples, slowPass };
  } catch {
    return fallback;
  } finally {
    video.playbackRate = restore.rate;
    video.muted = restore.muted;
    video.loop = restore.loop;
    video.currentTime = restore.time;
    if (restore.paused) video.pause();
  }
}
