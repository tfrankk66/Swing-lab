import { useCallback, useRef, useState, type RefObject } from "react";
import {
  analyzeRange,
  type AnalysisOptions,
  type AnalysisProgress,
} from "../lib/analysis";
import type { SwingTrack } from "../lib/track";

interface State {
  track: SwingTrack | null;
  progress: AnalysisProgress | null;
  error: string | null;
}

export function usePoseTrack(videoRef: RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<State>({
    track: null,
    progress: null,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (options: AnalysisOptions) => {
      const video = videoRef.current;
      if (!video) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ track: null, progress: null, error: null });
      try {
        const track = await analyzeRange(
          video,
          options,
          (progress) => {
            if (!controller.signal.aborted) {
              setState((s) => ({ ...s, progress }));
            }
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setState({ track, progress: null, error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          track: null,
          progress: null,
          error:
            error instanceof Error
              ? error.message
              : "Pose detection failed to start.",
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [videoRef],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, progress: null }));
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ track: null, progress: null, error: null });
  }, []);

  return { ...state, run, cancel, clear, running: state.progress !== null };
}
