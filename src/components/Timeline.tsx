import { useRef, type PointerEvent } from "react";

interface Props {
  total: number;
  frame: number;
  trimIn: number;
  trimOut: number;
  /** True while detection owns the video and scrubbing it would fight the pass. */
  disabled?: boolean;
  /** Absolute frames to mark on the track — address, top, impact. */
  marks?: ReadonlyArray<{ frame: number; label: string }>;
  onScrub: (frame: number) => void;
  onTrimIn: (frame: number) => void;
  onTrimOut: (frame: number) => void;
}

type Grab = "scrub" | "in" | "out";

/**
 * Scrub track with trim handles. One pointer surface handles all three
 * targets: whichever is nearest to the initial press wins the drag, so the
 * handles stay grabbable at thumb size without overlapping hit areas fighting
 * each other.
 */
export function Timeline({
  total,
  frame,
  trimIn,
  trimOut,
  disabled = false,
  marks = [],
  onScrub,
  onTrimIn,
  onTrimOut,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<Grab | null>(null);

  const last = Math.max(1, total - 1);
  const pct = (f: number) => `${(f / last) * 100}%`;

  const frameAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.round(Math.min(1, Math.max(0, ratio)) * last);
  };

  const apply = (grab: Grab, at: number) => {
    if (grab === "in") onTrimIn(Math.min(at, trimOut - 1));
    else if (grab === "out") onTrimOut(Math.max(at, trimIn + 1));
    else onScrub(at);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const at = frameAt(event.clientX);
    const rect = trackRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 1;
    // 24px of slop around each handle, expressed in frames.
    const slop = (24 / width) * last;

    let grab: Grab = "scrub";
    const toIn = Math.abs(at - trimIn);
    const toOut = Math.abs(at - trimOut);
    if (Math.min(toIn, toOut) <= slop) grab = toIn <= toOut ? "in" : "out";

    grabRef.current = grab;
    event.currentTarget.setPointerCapture(event.pointerId);
    apply(grab, at);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const grab = grabRef.current;
    if (!grab) return;
    apply(grab, frameAt(event.clientX));
  };

  const release = () => {
    grabRef.current = null;
  };

  return (
    <div
      className={disabled ? "timeline is-disabled" : "timeline"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className="track" ref={trackRef}>
        <div
          className="track-active"
          style={{ left: pct(trimIn), right: `${100 - (trimOut / last) * 100}%` }}
        />
      </div>
      {marks.map((mark) => (
        <div
          key={mark.label}
          className="phasemark"
          style={{ left: pct(mark.frame) }}
        >
          <span>{mark.label}</span>
        </div>
      ))}
      <div className="playhead" style={{ left: pct(frame) }} />
      <div className="handle" style={{ left: pct(trimIn) }}>
        <span>IN</span>
      </div>
      <div className="handle" style={{ left: pct(trimOut) }}>
        <span>OUT</span>
      </div>
    </div>
  );
}
