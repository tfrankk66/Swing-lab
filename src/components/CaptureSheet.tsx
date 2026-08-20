import { useState } from "react";
import type { FrameRateResult } from "../lib/fps";
import { effectiveFps, impactResolutionCm } from "../lib/frames";

interface Props {
  rate: FrameRateResult;
  slowdown: number;
  onApply: (fps: number, slowdown: number) => void;
  onClose: () => void;
}

const PRESETS = [30, 60, 120, 240];
const SLOWDOWNS = [1, 2, 4, 8];

/**
 * Manual override for capture settings.
 *
 * Two numbers matter and only one of them is measurable. Container frame rate
 * we can detect; the slow-motion factor we cannot, because a phone that shoots
 * 240fps often writes a 30fps file with the slowdown already baked in. Those
 * two clips look identical to the browser and are eight times apart in real
 * temporal resolution — which is the whole ballgame for impact.
 *
 * v0.3 will infer the factor from the detected swing length (a real swing runs
 * about 1.2 seconds top to impact). Until then, you tell it.
 */
export function CaptureSheet({ rate, slowdown, onApply, onClose }: Props) {
  const [fps, setFps] = useState(rate.fps);
  const [factor, setFactor] = useState(slowdown);

  const effective = effectiveFps(fps, factor);
  const resolution = impactResolutionCm(effective);
  const verdict =
    resolution <= 25 ? "good" : resolution <= 50 ? "warn" : "";

  return (
    <div className="sheet" onClick={onClose} role="presentation">
      <div
        className="sheet-body"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Capture settings"
      >
        <h2>Capture settings</h2>

        <div className="field">
          <label htmlFor="fps-input">Container frame rate</label>
          <div className="rategrid">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                className={fps === preset ? "on" : ""}
                onClick={() => setFps(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            id="fps-input"
            type="number"
            min={1}
            max={2000}
            step="any"
            value={fps}
            onChange={(e) => setFps(Number(e.target.value) || 1)}
          />
          <p>
            {rate.source === "measured"
              ? `Measured at ${rate.fps} from ${rate.samples} frames${
                  rate.slowPass ? ", slow pass" : ""
                }.`
              : "Could not measure — this browser has no frame callback API."}
          </p>
        </div>

        <div className="field">
          <label>Slow-motion factor already baked in</label>
          <div className="rategrid">
            {SLOWDOWNS.map((value) => (
              <button
                key={value}
                className={factor === value ? "on" : ""}
                onClick={() => setFactor(value)}
              >
                {value}&times;
              </button>
            ))}
          </div>
          <p>
            Pick 1&times; if the swing takes about a second on screen. Pick
            8&times; if it drifts by in slow motion.
          </p>
        </div>

        <div className="field">
          <label>Real-world sampling</label>
          <p>
            <span className={verdict ? `chip ${verdict}` : "chip"}>
              {Math.round(effective)} fps &middot; {resolution.toFixed(0)} cm
              per frame
            </span>{" "}
            &mdash; how far a 100mph clubhead travels between frames.{" "}
            {resolution <= 25
              ? "Impact metrics are trustworthy."
              : resolution <= 50
                ? "Impact metrics will be marked low-confidence."
                : "Too coarse for impact metrics; backswing metrics still work."}
          </p>
        </div>

        <div className="split">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={() => onApply(fps, factor)}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
