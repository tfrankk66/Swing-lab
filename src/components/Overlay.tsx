import { useEffect, useRef, useState, type RefObject } from "react";
import {
  DEFAULT_OVERLAY,
  drawReferences,
  drawSkeleton,
  readTheme,
  type ReferenceOptions,
} from "../lib/draw";
import type { SwingPhases } from "../lib/phases";
import type { SwingTrack } from "../lib/track";

interface Props {
  track: SwingTrack | null;
  frame: number;
  visible: boolean;
  /** Address and top, which the reference lines are pinned to. */
  phases: SwingPhases | null;
  references: ReferenceOptions;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Positioning context the canvas is placed inside. */
  stageRef: RefObject<HTMLDivElement | null>;
}

/**
 * Canvas layer pinned to the video's rendered box.
 *
 * The video is sized by `max-width`/`max-height`, so its element box is
 * exactly the picture — no letterboxing to compensate for — but that box moves
 * and resizes with the clip's aspect ratio, the window, and phone rotation.
 * Rather than guess at it in CSS, the canvas is measured onto the video every
 * time either one changes.
 *
 * The backing store is sized in device pixels; a CSS-sized canvas draws a
 * soft skeleton on any phone.
 */
export function Overlay({
  track,
  frame,
  visible,
  phases,
  references,
  videoRef,
  stageRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Bumped by the observer to force a redraw: resizing a canvas clears it.
  const [layout, setLayout] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // No window resize listener needed: the video is sized off the stage,
    // which is sized off the window, so the observer already covers it.
    const observer = new ResizeObserver(() => setLayout((n) => n + 1));
    observer.observe(video);
    return () => observer.disconnect();
  }, [videoRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const stage = stageRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !video || !stage) return;

    const videoBox = video.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    canvas.style.left = `${videoBox.left - stageBox.left}px`;
    canvas.style.top = `${videoBox.top - stageBox.top}px`;
    canvas.style.width = `${videoBox.width}px`;
    canvas.style.height = `${videoBox.height}px`;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(videoBox.width * dpr));
    const height = Math.max(1, Math.round(videoBox.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    if (!track || !visible) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const theme = readTheme(canvas);
    // Skeleton first: it clears the canvas, and the reference lines have to
    // sit on top of the body they are being compared against rather than
    // under it.
    drawSkeleton(ctx, track, frame, canvas.width, canvas.height, {
      ...DEFAULT_OVERLAY,
      theme,
    });
    if (phases) {
      drawReferences(
        ctx,
        track,
        phases,
        canvas.width,
        canvas.height,
        theme,
        references,
      );
    }
  }, [track, frame, visible, phases, references, layout, videoRef, stageRef]);

  return <canvas ref={canvasRef} className="overlay" aria-hidden="true" />;
}
