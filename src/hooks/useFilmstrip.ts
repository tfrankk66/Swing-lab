import { useEffect, useMemo, useRef, useState } from "react";
import {
  captureThumbnails,
  filmstripFrames,
  type Thumbnail,
} from "../lib/filmstrip";
import type { SwingPhases } from "../lib/phases";

/** Cells on the sheet. Nine spans a swing without crowding a phone's width. */
export const FILMSTRIP_CELLS = 9;

/**
 * How long the trim has to sit still before the sheet is rebuilt.
 *
 * Every rebuild is a dozen seeks, and dragging a trim handle produces a new
 * range on every pointer move. Waiting out the drag turns what would be
 * hundreds of abandoned passes into one.
 */
const SETTLE_MS = 400;

interface Options {
  src: string | null;
  fps: number;
  trimIn: number;
  trimOut: number;
  phases: SwingPhases | null;
  /** False while detection owns the decoder, or the two passes fight for it. */
  enabled: boolean;
}

export interface FilmstripState {
  thumbs: Thumbnail[];
  /** True from the moment a rebuild starts until its last cell lands. */
  running: boolean;
}

/**
 * Keeps a contact sheet of the trimmed range in step with the trim.
 *
 * Thumbnails accumulate as they decode rather than appearing all at once, and
 * a rebuild that is overtaken by a new trim is aborted mid-pass — so the sheet
 * on screen always belongs to the range currently selected, even while it is
 * still filling in.
 */
export function useFilmstrip({
  src,
  fps,
  trimIn,
  trimOut,
  phases,
  enabled,
}: Options): FilmstripState {
  const [thumbs, setThumbs] = useState<Thumbnail[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // The frame list is the real input: a trim change that moves no cell — and
  // on a long clip most single-frame nudges move none — should not rebuild.
  const wanted = useMemo(
    () => filmstripFrames(trimIn, trimOut, phases, FILMSTRIP_CELLS),
    [trimIn, trimOut, phases],
  );
  const key = useMemo(
    () => wanted.map((c) => `${c.frame}${c.label ?? ""}`).join(","),
    [wanted],
  );

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    if (!src || !enabled || wanted.length === 0 || fps <= 0) {
      setRunning(false);
      return;
    }

    const timer = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setThumbs([]);
      setRunning(true);

      void captureThumbnails(
        src,
        wanted,
        fps,
        (thumb) => {
          if (controller.signal.aborted) return;
          setThumbs((previous) => [...previous, thumb]);
        },
        controller.signal,
      )
        .catch(() => {
          // A clip the decoder will not seek is not worth an error banner —
          // the sheet is a convenience and the player still works without it.
        })
        .finally(() => {
          if (!controller.signal.aborted) setRunning(false);
        });
    }, SETTLE_MS);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
      abortRef.current = null;
    };
    // `key` stands in for `wanted`, which is a fresh array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, fps, key, enabled]);

  // Unmount, or a new clip: drop the sheet rather than leaving the last one
  // hanging under a video it does not belong to.
  useEffect(() => {
    setThumbs([]);
  }, [src]);

  return { thumbs, running };
}
