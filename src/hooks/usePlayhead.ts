import { useEffect, useRef, useState, type RefObject } from "react";
import { frameToTime } from "../lib/frames";

interface Options {
  fps: number;
  /** Inclusive first frame of the trimmed range. */
  trimIn: number;
  /** Inclusive last frame of the trimmed range. */
  trimOut: number;
  loop: boolean;
}

interface Playhead {
  time: number;
  playing: boolean;
}

/**
 * Tracks playback position and enforces the trim range.
 *
 * Reads `currentTime` on every animation frame rather than listening to
 * `timeupdate`, which only fires about four times a second — far too coarse
 * for a playhead you are trying to park on a single frame of a golf swing.
 *
 * Trim enforcement lives here too, because it has to run at the same
 * resolution: the check needs to happen before the video plays past the out
 * point, not a quarter-second later.
 */
export function usePlayhead(
  videoRef: RefObject<HTMLVideoElement | null>,
  /** Current clip. The loop restarts when this changes, once the element exists. */
  src: string | null,
  options: Options,
  /**
   * Set false while something else is driving the video. The loop sets state
   * sixty times a second, and a full React render per animation frame is real
   * contention for the main thread the pose model is trying to use.
   */
  enabled = true,
): Playhead {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Held in a ref so changing the trim range doesn't tear down the rAF loop.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src || !enabled) return;

    let raf = 0;

    const tick = () => {
      const { fps, trimIn, trimOut, loop } = optionsRef.current;
      const outTime = frameToTime(trimOut, fps);
      const inTime = frameToTime(trimIn, fps);

      // An uninitialised range (both ends at zero) means the clip is still
      // being measured. Enforcing it would stop the measurement pass dead.
      const armed = trimOut > trimIn;

      if (armed && !video.paused && video.currentTime >= outTime) {
        if (loop) {
          video.currentTime = inTime;
        } else {
          video.pause();
          video.currentTime = outTime;
        }
      }

      setTime(video.currentTime);
      raf = requestAnimationFrame(tick);
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [videoRef, src, enabled]);

  return { time, playing };
}
