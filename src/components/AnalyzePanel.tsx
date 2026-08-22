import type { AnalysisProgress } from "../lib/analysis";
import { MODEL_NOTES, type ModelQuality } from "../lib/pose";
import { coverage, type SwingTrack } from "../lib/track";

/** Frames past which the trim is almost certainly still the whole clip. */
const LONG_RANGE = 900;

interface Props {
  track: SwingTrack | null;
  progress: AnalysisProgress | null;
  error: string | null;
  quality: ModelQuality;
  frames: number;
  overlayOn: boolean;
  onQuality: (quality: ModelQuality) => void;
  onRun: () => void;
  onCancel: () => void;
  onToggleOverlay: () => void;
}

export function AnalyzePanel({
  track,
  progress,
  error,
  quality,
  frames,
  overlayOn,
  onQuality,
  onRun,
  onCancel,
  onToggleOverlay,
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
              : `${
                  progress.stage === "filling" ? "Filling gaps" : "Detecting"
                } · ${progress.done} / ${progress.total}`}
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
          <br />
          {track.streamed} streamed · {track.filled} seeked back for
          {gaps > 0 && " · gap frames show no skeleton"}
        </p>
      </div>
    );
  }

  // A swing is a second and a half. Anything past a few hundred frames means
  // the trim is still around the whole clip, and the pass will take minutes
  // detecting a golfer walking to the tee.
  const oversized = frames > LONG_RANGE;

  return (
    <div className="analyze">
      <div className="analyze-head">
        <span className="rowlabel" style={{ margin: 0 }}>
          Pose detection
        </span>
        <span className={oversized ? "chip warn" : "mono-note"}>
          {frames} frames trimmed
        </span>
      </div>
      {oversized && (
        <p className="mono-note">
          That is the whole clip, not the swing. Set the trim with I and O
          around the swing first — every frame in the range costs a model call.
        </p>
      )}
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
      <button className="tbtn primary" onClick={onRun} disabled={frames < 2}>
        Find the body
      </button>
      {error && <p className="mono-note error">{error}</p>}
    </div>
  );
}
