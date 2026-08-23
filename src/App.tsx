import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Intake } from "./components/Intake";
import { Timeline } from "./components/Timeline";
import { CaptureSheet } from "./components/CaptureSheet";
import { Overlay } from "./components/Overlay";
import { AnalyzePanel } from "./components/AnalyzePanel";
import { usePlayhead } from "./hooks/usePlayhead";
import { usePoseTrack } from "./hooks/usePoseTrack";
import { detectFrameRate, type FrameRateResult } from "./lib/fps";
import type { ModelQuality } from "./lib/pose";
import {
  clampFrame,
  effectiveFps,
  formatClock,
  frameCount,
  frameToTime,
  seekToFrame,
  timeToFrame,
  windowAround,
} from "./lib/frames";
import { maxAnalysisFrames } from "./lib/analysis";

const SPEEDS = [1, 0.5, 0.25, 0.1];
/** Drag distance on the video that advances one frame. Deliberately slow. */
const PX_PER_FRAME = 8;

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<FrameRateResult | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [slowdown, setSlowdown] = useState(1);
  const [trim, setTrim] = useState({ in: 0, out: 0 });
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(0.25);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scrubbed, setScrubbed] = useState(false);
  const [quality, setQuality] = useState<ModelQuality>("full");
  const [overlayOn, setOverlayOn] = useState(true);

  const pose = usePoseTrack(videoRef);

  const fps = rate?.fps ?? 30;
  const total = frameCount(duration, fps);
  const { time, playing } = usePlayhead(
    videoRef,
    src,
    { fps, trimIn: trim.in, trimOut: trim.out, loop },
    !pose.running,
  );
  const frame = clampFrame(timeToFrame(time, fps), total);

  /* ------------------------------------------------------------- loading */

  const pickFile = (file: File) => {
    setSrc((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
    setRate(null);
    setDuration(0);
    setTrim({ in: 0, out: 0 });
    setScrubbed(false);
    pose.clear();
  };

  const closeClip = () => {
    setSrc((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    setRate(null);
    setDuration(0);
    pose.clear();
  };

  /**
   * Frame-rate measurement hangs off `loadedmetadata` rather than an effect on
   * purpose. Detection drives the video element — it plays it, changes its
   * rate, and seeks it — so two overlapping passes produce nonsense. An event
   * fires exactly once per clip; an effect fires twice under StrictMode.
   */
  const onLoadedMetadata = async (video: HTMLVideoElement) => {
    setDuration(video.duration);
    setMeasuring(true);
    const result = await detectFrameRate(video);
    setRate(result);
    setTrim({
      in: 0,
      out: Math.max(1, frameCount(video.duration, result.fps)) - 1,
    });
    setMeasuring(false);
  };

  // Playback rate is clobbered by frame-rate measurement, so reassert it.
  useEffect(() => {
    const video = videoRef.current;
    if (video && !measuring) video.playbackRate = speed;
  }, [speed, measuring, rate]);

  /* ------------------------------------------------------------ commands */

  const seek = useCallback(
    (to: number) => {
      const video = videoRef.current;
      if (video) seekToFrame(video, to, fps, total);
    },
    [fps, total],
  );

  const step = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      seek(frame + delta);
    },
    [frame, seek],
  );

  /** Narrows the trim to the longest analysable window around the playhead. */
  const trimToWindow = useCallback(() => {
    setTrim(windowAround(frame, maxAnalysisFrames(fps), total));
  }, [frame, fps, total]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      // Restart from the in point when parked at or past the out point.
      if (frame >= trim.out) video.currentTime = frameToTime(trim.in, fps);
      void video.play();
    } else {
      video.pause();
    }
  }, [frame, trim.in, trim.out, fps]);

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    if (!src) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      const jump = event.shiftKey ? 10 : 1;
      switch (event.key) {
        case " ":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          event.preventDefault();
          step(-jump);
          break;
        case "ArrowRight":
          event.preventDefault();
          step(jump);
          break;
        case "i":
        case "I":
          setTrim((t) => ({ ...t, in: Math.min(frame, t.out - 1) }));
          break;
        case "o":
        case "O":
          setTrim((t) => ({ ...t, out: Math.max(frame, t.in + 1) }));
          break;
        case "l":
        case "L":
          setLoop((value) => !value);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, frame, step, togglePlay]);

  /* -------------------------------------------------- drag-to-scrub stage */

  const dragRef = useRef<{ x: number; frame: number } | null>(null);

  const onStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    videoRef.current?.pause();
    dragRef.current = { x: event.clientX, frame };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onStagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = Math.round((event.clientX - drag.x) / PX_PER_FRAME);
    if (delta !== 0) setScrubbed(true);
    seek(drag.frame + delta);
  };

  const endStageDrag = () => {
    dragRef.current = null;
  };

  /* ---------------------------------------------------------------- view */

  if (!src) {
    return (
      <div className="app">
        <Topbar />
        <Intake onPick={pickFile} />
      </div>
    );
  }

  const effective = effectiveFps(fps, slowdown);
  const trimmedFrames = Math.max(0, trim.out - trim.in + 1);
  const trimmedRealMs = (trimmedFrames / effective) * 1000;

  return (
    <div className="app">
      <Topbar>
        <button
          className={
            measuring
              ? "chip is-button"
              : rate?.source === "measured"
                ? "chip is-button good"
                : "chip is-button warn"
          }
          onClick={() => setSheetOpen(true)}
        >
          {measuring ? "measuring…" : `${fps} fps · ${slowdown}×`}
        </button>
        <button className="chip is-button" onClick={closeClip}>
          New clip
        </button>
      </Topbar>

      <div
        className="stage"
        ref={stageRef}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={endStageDrag}
        onPointerCancel={endStageDrag}
      >
        <video
          ref={videoRef}
          src={src}
          playsInline
          muted
          preload="auto"
          onLoadedMetadata={(e) => void onLoadedMetadata(e.currentTarget)}
        />
        <Overlay
          track={pose.track}
          frame={frame}
          visible={overlayOn}
          videoRef={videoRef}
          stageRef={stageRef}
        />
        <div className="readout">
          <span className="big">
            {frame}
            <span style={{ opacity: 0.5 }}> / {Math.max(0, total - 1)}</span>
          </span>
          <span>{formatClock(time)}</span>
          <span>{trimmedRealMs.toFixed(0)} ms trimmed</span>
        </div>
        <div className={scrubbed ? "stage-hint hidden" : "stage-hint"}>
          Drag across the video to step frames
        </div>
      </div>

      <div className="controls">
        <Timeline
          total={total}
          frame={frame}
          trimIn={trim.in}
          trimOut={trim.out}
          onScrub={seek}
          onTrimIn={(f) => setTrim((t) => ({ ...t, in: f }))}
          onTrimOut={(f) => setTrim((t) => ({ ...t, out: f }))}
        />

        <div className="transport">
          <button className="tbtn" onClick={() => step(-10)} aria-label="Back ten frames">
            ⏮ 10
          </button>
          <button className="tbtn" onClick={() => step(-1)} aria-label="Back one frame">
            ◀
          </button>
          <button className="tbtn primary" onClick={togglePlay}>
            {playing ? "Pause" : "Play"}
          </button>
          <button className="tbtn" onClick={() => step(1)} aria-label="Forward one frame">
            ▶
          </button>
          <button className="tbtn" onClick={() => step(10)} aria-label="Forward ten frames">
            10 ⏭
          </button>
        </div>

        <div className="split">
          <div>
            <div className="rowlabel">Playback speed</div>
            <div className="rates">
              {SPEEDS.map((value) => (
                <button
                  key={value}
                  className={speed === value ? "on" : ""}
                  onClick={() => setSpeed(value)}
                >
                  {value}×
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="rowlabel">Trim · {trimmedFrames} frames</div>
            <div className="split">
              <button
                className={loop ? "tbtn on" : "tbtn"}
                onClick={() => setLoop((v) => !v)}
              >
                Loop {loop ? "on" : "off"}
              </button>
              <button
                className="tbtn"
                onClick={() => setTrim({ in: 0, out: Math.max(1, total) - 1 })}
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <AnalyzePanel
          track={pose.track}
          progress={pose.progress}
          error={pose.error}
          quality={quality}
          frames={trimmedFrames}
          fps={fps}
          overlayOn={overlayOn}
          onQuality={setQuality}
          onRun={() =>
            void pose.run({ fps, from: trim.in, to: trim.out, quality })
          }
          onCancel={pose.cancel}
          onToggleOverlay={() => setOverlayOn((v) => !v)}
          onTrimToWindow={trimToWindow}
        />

        <div className="keyhint">
          space play · ← → frame · shift+← → ten · i in · o out · l loop
        </div>
      </div>

      {sheetOpen && rate && (
        <CaptureSheet
          rate={rate}
          slowdown={slowdown}
          onApply={(nextFps, nextSlowdown) => {
            setRate({
              fps: nextFps,
              source: "manual",
              samples: 0,
              slowPass: false,
            });
            setSlowdown(nextSlowdown);
            setTrim({
              in: 0,
              out: Math.max(1, frameCount(duration, nextFps)) - 1,
            });
            // The track indexes by frame number, so a new frame rate
            // renumbers every frame in it.
            pose.clear();
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

function Topbar({ children }: { children?: ReactNode }) {
  return (
    <div className="topbar">
      <span className="wordmark">
        Swing<em>Lab</em>
      </span>
      <div className="chipset">
        {children ?? <span className="chip">v0.1 · player</span>}
      </div>
    </div>
  );
}
