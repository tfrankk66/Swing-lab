import {
  MAX_ANALYSIS_SECONDS,
  maxAnalysisFrames,
  type AnalysisProgress,
} from "../lib/analysis";
import { MODEL_NOTES, type ModelQuality } from "../lib/pose";
import { coverage, type SwingTrack } from "../lib/track";

interface Props {
  track: SwingTrack | null;
  progress: AnalysisProgress | null;
  error: string | null;
  quality: ModelQuality;
  frames: number;
  /** Measured rate of the clip, to turn the frame cap into seconds. */
  fps: number;
  overlayOn: boolean;
  onQuality: (quality: ModelQuality) => void;
  onRun: () => void;
  onCancel: () => void;
  onToggleOverlay: () => void;
  /** Narrows the trim to the longest analysable window around the playhead. */
  onTrimToWindow: () => void;
}

export function AnalyzePanel({
  track,
  progress,
  error,
  quality,
  frames,
  fps,
  overlayOn,
  onQuality,
  onRun,
  onCancel,
  onToggleOverlay,
  onTrimToWindow,
}: Props) {
  if (progress) {
    const pct =
      progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
    const remaining =
      progress.rate > 0
        ? Math.ceil((progress.total - progress.done) / progress.rate)
        : null;

    return (
      <div className="analyze">
        <div className="analyze-head">
          <span className="rowlabel" style={{ margin: 0 }}>
            {progress.stage === "loading-model"
              ? "Loading model"
              : `Detecting · ${progress.done} / ${progress.total}`}
          </span>
          <span className="mono-note">
            {remaining !== null ? `~${remaining}s left` : "…"}
          </span>
        </div>
        <div className="meter">
          <i style={{ width: `${pct}%` }} />
        </div>
        <button className="tbtn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (track) {
    const found = coverage(track);
    const perFrame = track.elapsedMs / Math.max(1, track.count);
    const seekPerFrame = track.seekMs / Math.max(1, track.count);
    const detectPerFrame = track.detectMs / Math.max(1, track.count);
    const gaps = track.count - Math.round(found * track.count);
    const bound = track.seekMs > track.detectMs ? "decoder" : "model";

    return (
      <div className="analyze">
        <div className="analyze-head">
          <span className="rowlabel" style={{ margin: 0 }}>
            Pose track · {track.count} frames
          </span>
          <span className={found >= 0.95 ? "chip good" : "chip warn"}>
            {gaps === 0 ? "no gaps" : `${gaps} gaps`}
          </span>
        </div>
        <div className="split">
          <button
            className={overlayOn ? "tbtn on" : "tbtn"}
            onClick={onToggleOverlay}
          >
            Overlay {overlayOn ? "on" : "off"}
          </button>
          <button className="tbtn" onClick={onRun}>
            Re-run
          </button>
        </div>
        <p className="mono-note">
          {track.quality} model on {track.delegate} at {track.analyzedWidth}
          &times;{track.analyzedHeight} · {perFrame.toFixed(0)} ms per frame
          <br />
          seek {seekPerFrame.toFixed(0)} ms · detect{" "}
          {detectPerFrame.toFixed(0)} ms — {bound}-bound
          {gaps > 0 && " · gap frames show no skeleton"}
        </p>
      </div>
    );
  }

  // Cost is one model call per frame, so it scales with the range and no
  // decode trick changes that. Past the cap the run is refused rather than
  // started and abandoned twenty minutes later.
  const cap = maxAnalysisFrames(fps);
  const overCap = cap > 0 && frames > cap;
  const seconds = fps > 0 ? frames / fps : 0;

  return (
    <div className="analyze">
      <div className="analyze-head">
        <span className="rowlabel" style={{ margin: 0 }}>
          Pose detection
        </span>
        <span className={overCap ? "chip warn" : "mono-note"}>
          {frames} frames · {seconds.toFixed(1)}s
        </span>
      </div>
      {overCap ? (
        <>
          <p className="mono-note">
            Capped at {MAX_ANALYSIS_SECONDS}s, and the trim is {seconds.toFixed(0)}s.
            Every frame is a model call, so the whole clip would take minutes.
            Park the playhead on impact and take a window around it — a swing
            needs about two seconds, and {MAX_ANALYSIS_SECONDS} leaves room for
            the address and the finish.
          </p>
          <button className="tbtn primary" onClick={onTrimToWindow}>
            Trim to {MAX_ANALYSIS_SECONDS}s around the playhead
          </button>
        </>
      ) : (
        <>
          <div className="rates">
            {(["lite", "full"] as const).map((value) => (
              <button
                key={value}
                className={quality === value ? "on" : ""}
                onClick={() => onQuality(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <p className="mono-note">{MODEL_NOTES[quality]}</p>
          <button
            className="tbtn primary"
            onClick={onRun}
            disabled={frames < 2}
          >
            Find the body
          </button>
        </>
      )}
      {error && <p className="mono-note error">{error}</p>}
    </div>
  );
}
