import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Intake } from "./components/Intake";
import { Timeline } from "./components/Timeline";
import { CaptureSheet } from "./components/CaptureSheet";
import { Overlay } from "./components/Overlay";
import { AnalyzePanel } from "./components/AnalyzePanel";
import { Filmstrip } from "./components/Filmstrip";
import { LogBook } from "./components/LogBook";
import { CoachPanel } from "./components/CoachPanel";
import { Transport } from "./components/Transport";
import { usePlayhead } from "./hooks/usePlayhead";
import { usePoseTrack } from "./hooks/usePoseTrack";
import { useFilmstrip } from "./hooks/useFilmstrip";
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
import { smoothTrack } from "./lib/smooth";
import { detectPhases } from "./lib/phases";
import { inferSlowdown } from "./lib/slowmo";
import { computeMetrics } from "./lib/metrics";
import { DEFAULT_REFERENCES, type ReferenceOptions } from "./lib/draw";
import { versionLabel } from "./version";

const SPEEDS = [1, 0.5, 0.25, 0.1];

/**
 * Slow-motion factor assumed until told otherwise.
 *
 * Not measurable: a phone shooting 240fps writes a 60fps container with the
 * slowdown rendered in, and that file is identical to genuine 60fps footage as
 * far as the browser is concerned. Four is the phone slow-mo case, which is
 * every clip this tool is pointed at right now — a 60fps container times four
 * is the 240fps of real-world sampling the measurements want.
 *
 * Wrong for a clip filmed at normal speed, and nothing in the file says so.
 * It only has to hold until a pose track exists: `inferSlowdown` then reads
 * the factor off the detected downswing and replaces this, unless the user
 * has already set one by hand.
 */
const DEFAULT_SLOWDOWN = 4;

/**
 * Where the slow-motion factor currently in force came from.
 *
 * The ranking matters more than the labels: a factor the user typed outranks
 * one measured off the swing, which outranks the assumption above. Without
 * that, a re-run of detection would quietly overwrite a deliberate override
 * with a guess, and the number every impact measurement rests on would change
 * under someone who had already told the app what it was.
 */
type SlowdownSource = "assumed" | "inferred" | "manual";

/** Prefix on the factor in the topbar chip, saying which of the three it is. */
const SLOWDOWN_MARK: Record<SlowdownSource, string> = {
  assumed: "~",
  inferred: "=",
  manual: "",
};
/** Drag distance on the video that advances one frame. Deliberately slow. */
const PX_PER_FRAME = 8;

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<FrameRateResult | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [slowdown, setSlowdown] = useState(DEFAULT_SLOWDOWN);
  const [slowdownSource, setSlowdownSource] =
    useState<SlowdownSource>("assumed");
  const [trim, setTrim] = useState({ in: 0, out: 0 });
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(0.25);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scrubbed, setScrubbed] = useState(false);
  const [quality, setQuality] = useState<ModelQuality>("full");
  const [overlayOn, setOverlayOn] = useState(true);
  const [references, setReferences] =
    useState<ReferenceOptions>(DEFAULT_REFERENCES);

  const pose = usePoseTrack(videoRef);

  // The raw track is kept as the model returned it; everything downstream
  // reads the smoothed copy. Phase detection especially: it works by finding
  // where a trajectory peaks and reverses, and per-frame jitter invents
  // reversals that were never in the swing.
  const track = useMemo(
    () => (pose.track ? smoothTrack(pose.track) : null),
    [pose.track],
  );
  const phases = useMemo(() => (track ? detectPhases(track) : null), [track]);

  const fps = rate?.fps ?? 30;

  // Nine readings taken at the three phases. Cheap — plane geometry on a
  // dozen landmarks — so it recomputes with the track rather than on demand.
  const metrics = useMemo(
    () => computeMetrics(track, phases),
    [track, phases],
  );

  // The swing is the clock the slow-motion factor is read off. See slowmo.ts.
  const slowdownEstimate = useMemo(
    () => inferSlowdown(phases, fps),
    [phases, fps],
  );

  useEffect(() => {
    if (slowdownSource === "manual") return;
    if (!slowdownEstimate?.confident) return;
    setSlowdown(slowdownEstimate.factor);
    setSlowdownSource("inferred");
  }, [slowdownEstimate, slowdownSource]);
  const total = frameCount(duration, fps);
  const { time, playing } = usePlayhead(
    videoRef,
    src,
    { fps, trimIn: trim.in, trimOut: trim.out, loop },
    !pose.running,
  );
  const frame = clampFrame(timeToFrame(time, fps), total);

  const filmstrip = useFilmstrip({
    src,
    fps,
    trimIn: trim.in,
    trimOut: trim.out,
    phases,
    // Both passes seek, and a decoder asked to be in two places at once
    // serves neither. Detection is the one with a progress bar attached.
    enabled: !pose.running,
  });

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
    // A new clip is a new camera setting. Carrying the last clip's factor
    // over — inferred or typed — is how you measure one swing with another
    // swing's shutter.
    setSlowdown(DEFAULT_SLOWDOWN);
    setSlowdownSource("assumed");
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
      // Detection owns the video while it runs. See onStagePointerDown.
      if (pose.running) return;

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
    // Detection drives the video element itself. Letting the stage seek at the
    // same time fights it, and the playhead readout is frozen meanwhile, so the
    // scrub would look broken even where it worked.
    if (pose.running) return;
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
    <div className="app app-clip">
      <Topbar>
        <Badge
          component="button"
          size="sm"
          radius="sm"
          variant="light"
          ff="monospace"
          style={{ cursor: "pointer" }}
          color={
            measuring
              ? "gray"
              : // Both halves have to be known for the effective rate to mean
                // anything. A measured container rate multiplied by a guessed
                // factor is a guess, and it used to show green.
                rate?.source === "measured" && slowdownSource !== "assumed"
                ? "signal"
                : "yellow"
          }
          onClick={() => setSheetOpen(true)}
        >
          {/* The effective rate, not the container rate. 60fps of container at
              4x slow motion samples the real world 240 times a second, and it
              is that number the impact measurements live or die by.

              The factor carries a mark for where it came from, because the
              three cases are not equally trustworthy and the badge is the only
              place that difference is visible: ~ assumed, = measured off the
              swing, and nothing at all once a human has said so. */}
          {measuring
            ? "measuring…"
            : `${Math.round(effective)} fps · ${SLOWDOWN_MARK[slowdownSource]}${slowdown}×`}
        </Badge>
        <Button size="compact-sm" variant="default" onClick={closeClip}>
          New clip
        </Button>
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
          track={track}
          frame={frame}
          visible={overlayOn}
          phases={phases}
          references={references}
          videoRef={videoRef}
          stageRef={stageRef}
        />
        <Paper
          className="readout"
          radius="sm"
          px="xs"
          py={6}
          bg="light-dark(rgba(255,255,255,0.82), rgba(0,0,0,0.62))"
        >
          <Stack gap={1}>
            {pose.running ? (
              // The playhead loop is stopped during detection, so the frame
              // number here would be whatever it was when the run started.
              // Showing that stale number reads as a frozen player.
              <Text ff="heading" fw={700} size="lg" lh={1.1}>
                analysing…
              </Text>
            ) : (
              <>
                <Text ff="heading" fw={700} size="lg" lh={1.1}>
                  {frame}
                  <Text span inherit c="dimmed">
                    {" "}
                    / {Math.max(0, total - 1)}
                  </Text>
                </Text>
                <Text size="xs" ff="monospace" c="dimmed">
                  {formatClock(time)}
                </Text>
              </>
            )}
            <Text size="xs" ff="monospace" c="dimmed">
              {trimmedRealMs.toFixed(0)} ms trimmed
            </Text>
          </Stack>
        </Paper>

        <Text
          className="stage-hint"
          data-hidden={scrubbed || undefined}
          size="xs"
          ff="monospace"
          tt="uppercase"
          c="dimmed"
        >
          Drag across the video to step frames
        </Text>
      </div>

      {/* Phones: one scrolling column under the video, player controls then
          panels. Desktop: `.controls` dissolves (display: contents) and its
          two halves become grid cells — the player under the video on the
          left, the panels in their own scrolling column on the right. */}
      <div className="controls">
      <Stack className="player" gap="sm" px="md" pt="sm">
        <Timeline
          total={total}
          frame={frame}
          trimIn={trim.in}
          trimOut={trim.out}
          disabled={pose.running}
          marks={
            phases
              ? [
                  { frame: phases.p1, label: "P1" },
                  { frame: phases.p4, label: "P4" },
                  { frame: phases.p7, label: "P7" },
                ]
              : []
          }
          onScrub={seek}
          onTrimIn={(f) => setTrim((t) => ({ ...t, in: f }))}
          onTrimOut={(f) => setTrim((t) => ({ ...t, out: f }))}
        />

        <Stack gap={6}>
          <Label>Contact sheet{filmstrip.running ? " · building" : ""}</Label>
          <Filmstrip
            thumbs={filmstrip.thumbs}
            running={filmstrip.running}
            frame={frame}
            onSeekFrame={seek}
          />
        </Stack>

        <Transport
          playing={playing}
          busy={pose.running}
          onStep={step}
          onTogglePlay={togglePlay}
        />

        <SimpleGrid cols={2} spacing="sm">
          <Stack gap={6}>
            <Label>Playback speed</Label>
            <SegmentedControl
              fullWidth
              size="xs"
              value={String(speed)}
              onChange={(value) => setSpeed(Number(value))}
              data={SPEEDS.map((value) => ({
                value: String(value),
                label: `${value}×`,
              }))}
            />
          </Stack>
          <Stack gap={6}>
            <Label>Trim · {trimmedFrames} frames</Label>
            <SimpleGrid cols={2} spacing={6}>
              <Button
                size="xs"
                variant={loop ? "light" : "default"}
                onClick={() => setLoop((v) => !v)}
              >
                Loop {loop ? "on" : "off"}
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() => setTrim({ in: 0, out: Math.max(1, total) - 1 })}
              >
                Reset
              </Button>
            </SimpleGrid>
          </Stack>
        </SimpleGrid>

        {/* Hidden on touch, where none of it is reachable. */}
        <Text
          size="xs"
          ff="monospace"
          c="dimmed"
          ta="center"
          tt="uppercase"
          visibleFrom="sm"
        >
          space play · ← → frame · shift+← → ten · i in · o out · l loop
        </Text>
      </Stack>

      <Stack className="panels" gap="sm" px="md" pt="sm">
        <AnalyzePanel
          track={track}
          phases={phases}
          slowdown={slowdownEstimate}
          slowdownApplied={slowdownSource === "inferred"}
          onSeekFrame={seek}
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
          references={references}
          onToggleReference={(which) =>
            setReferences((r) => ({ ...r, [which]: !r[which] }))
          }
        />

        <LogBook metrics={metrics} hasTrack={track !== null} onSeekFrame={seek} />

        <CoachPanel metrics={metrics} hasTrack={track !== null} onSeekFrame={seek} />
      </Stack>
      </div>

      {sheetOpen && rate && (
        <CaptureSheet
          rate={rate}
          slowdown={slowdown}
          estimate={slowdownEstimate}
          onApply={(nextFps, nextSlowdown) => {
            setRate({
              fps: nextFps,
              source: "manual",
              samples: 0,
              slowPass: false,
            });
            setSlowdown(nextSlowdown);
            // Typed beats measured beats assumed: from here on, re-running
            // detection must not move this number back.
            setSlowdownSource("manual");
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

/** Small caps label above a control group. Used often enough to name. */
function Label({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" c="dimmed" tt="uppercase" ff="monospace" lts="0.1em">
      {children}
    </Text>
  );
}

function Topbar({ children }: { children?: ReactNode }) {
  return (
    <Group
      className="topbar"
      justify="space-between"
      wrap="nowrap"
      px="md"
      pb="xs"
      gap="xs"
      style={{
        flex: "none",
        borderBottom: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Title order={1} size="h4" tt="uppercase" lts="0.03em" style={{ whiteSpace: "nowrap" }}>
        Swing
        <Text span inherit c="var(--mantine-primary-color-filled)">
          Lab
        </Text>
      </Title>
      <Group gap={6} wrap="nowrap">
        {children ?? (
          <Badge size="sm" radius="sm" variant="default" ff="monospace">
            {versionLabel()}
          </Badge>
        )}
      </Group>
    </Group>
  );
}
