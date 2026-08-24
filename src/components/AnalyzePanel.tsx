import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import {
  MAX_ANALYSIS_SECONDS,
  maxAnalysisFrames,
  type AnalysisProgress,
} from "../lib/analysis";
import type { ReferenceOptions } from "../lib/draw";
import { MODEL_NOTES, type ModelQuality } from "../lib/pose";
import type { SwingPhases } from "../lib/phases";
import { describeSlowdown, type SlowdownEstimate } from "../lib/slowmo";
import { coverage, type SwingTrack } from "../lib/track";

interface Props {
  track: SwingTrack | null;
  /** Address, top and impact, once a track exists to find them in. */
  phases: SwingPhases | null;
  /** What the downswing says about the clip's baked-in slow motion. */
  slowdown: SlowdownEstimate | null;
  /** True when that inference is the factor currently in force. */
  slowdownApplied: boolean;
  onSeekFrame: (frame: number) => void;
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
  /** Which setup lines are drawn over the picture. */
  references: ReferenceOptions;
  onToggleReference: (which: keyof ReferenceOptions) => void;
}

/** Small caps label, used as the heading of every block in this panel. */
function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" c="dimmed" tt="uppercase" ff="monospace" lts="0.1em">
      {children}
    </Text>
  );
}

export function AnalyzePanel({
  track,
  phases,
  slowdown,
  slowdownApplied,
  onSeekFrame,
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
  references,
  onToggleReference,
}: Props) {
  if (progress) {
    const pct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
    const remaining =
      progress.rate > 0
        ? Math.ceil((progress.total - progress.done) / progress.rate)
        : null;

    return (
      <Paper withBorder radius="sm" p="sm">
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <PanelLabel>
              {progress.stage === "loading-model"
                ? "Loading model"
                : `Detecting · ${progress.done} / ${progress.total}`}
            </PanelLabel>
            <Text size="xs" c="dimmed" ff="monospace">
              {remaining !== null ? `~${remaining}s left` : "…"}
            </Text>
          </Group>
          <Progress value={pct} size="sm" radius="xs" animated />
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
        </Stack>
      </Paper>
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
      <Paper withBorder radius="sm" p="sm">
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap">
            <PanelLabel>Pose track · {track.count} frames</PanelLabel>
            <Badge
              size="sm"
              radius="sm"
              variant="light"
              color={found >= 0.95 ? "signal" : "yellow"}
            >
              {gaps === 0 ? "no gaps" : `${gaps} gaps`}
            </Badge>
          </Group>

          <SimpleGrid cols={2} spacing="xs">
            <Button
              variant={overlayOn ? "light" : "default"}
              onClick={onToggleOverlay}
            >
              Overlay {overlayOn ? "on" : "off"}
            </Button>
            <Button variant="default" onClick={onRun}>
              Re-run
            </Button>
          </SimpleGrid>

          {/* Pinned to address, so they only mean anything once the phases
              have been found. Offered separately because they answer
              different questions and two lines at once on a phone-sized
              picture is one line too many for most of them. */}
          {phases && (
            <Stack gap="xs">
              <PanelLabel>Reference lines</PanelLabel>
              <SimpleGrid cols={2} spacing="xs">
                <Button
                  variant={references.plane ? "light" : "default"}
                  onClick={() => onToggleReference("plane")}
                >
                  Plane line
                </Button>
                <Button
                  variant={references.butt ? "light" : "default"}
                  onClick={() => onToggleReference("butt")}
                >
                  Butt line
                </Button>
              </SimpleGrid>
            </Stack>
          )}

          {phases && (
            <Stack gap="xs">
              <Group gap="xs">
                <PanelLabel>Swing phases</PanelLabel>
                {!phases.confident && (
                  <Badge size="xs" radius="sm" variant="light" color="yellow">
                    unsure
                  </Badge>
                )}
              </Group>
              {/* Buttons, not a SegmentedControl: these jump the playhead
                  rather than select a mode, and a control that shows one of
                  three as "current" would be claiming something false the
                  moment you scrub away from it. */}
              <SimpleGrid cols={3} spacing="xs">
                {(
                  [
                    ["P1", phases.p1, "address"],
                    ["P4", phases.p4, "top"],
                    ["P7", phases.p7, "impact"],
                  ] as const
                ).map(([name, at, what]) => (
                  <Button
                    key={name}
                    size="xs"
                    variant="default"
                    onClick={() => onSeekFrame(at)}
                    title={`${what} — frame ${at}`}
                  >
                    {name}
                  </Button>
                ))}
              </SimpleGrid>
              <Text size="xs" c="dimmed" ff="monospace">
                {phases.confident
                  ? `address ${phases.p1} · top ${phases.p4} · impact ${phases.p7}`
                  : // Backswing not slower than downswing, or nothing moved.
                    "This does not look like a full swing — the phases are a best guess, not something to measure against."}
              </Text>
            </Stack>
          )}

          {slowdown && (
            <Stack gap="xs">
              <Group gap="xs">
                <PanelLabel>Slow motion</PanelLabel>
                {slowdownApplied && (
                  <Badge size="xs" radius="sm" variant="light" color="signal">
                    {slowdown.factor}× applied
                  </Badge>
                )}
                {/* Two adjacent factors fitting the same downswing equally
                    well is a real outcome on a short or badly trimmed clip,
                    and the honest move is to say so rather than pick one and
                    look sure. */}
                {slowdownApplied && slowdown.drift > 0.4 && (
                  <Badge size="xs" radius="sm" variant="light" color="yellow">
                    borderline
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed" ff="monospace" style={{ lineHeight: 1.6 }}>
                {describeSlowdown(slowdown)}
              </Text>
            </Stack>
          )}

          <Text size="xs" c="dimmed" ff="monospace" style={{ lineHeight: 1.6 }}>
            {track.quality} model on {track.delegate} at {track.analyzedWidth}
            ×{track.analyzedHeight} · {perFrame.toFixed(0)} ms per frame
            <br />
            seek {seekPerFrame.toFixed(0)} ms · detect{" "}
            {detectPerFrame.toFixed(0)} ms — {bound}-bound
            {gaps > 0 && " · gap frames show no skeleton"}
          </Text>
        </Stack>
      </Paper>
    );
  }

  // Cost is one model call per frame, so it scales with the range and no
  // decode trick changes that. Past the cap the run is refused rather than
  // started and abandoned twenty minutes later.
  const cap = maxAnalysisFrames(fps);
  const overCap = cap > 0 && frames > cap;
  const seconds = fps > 0 ? frames / fps : 0;

  return (
    <Paper withBorder radius="sm" p="sm">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <PanelLabel>Pose detection</PanelLabel>
          <Badge
            size="sm"
            radius="sm"
            variant="light"
            color={overCap ? "yellow" : "gray"}
          >
            {frames} frames · {seconds.toFixed(1)}s
          </Badge>
        </Group>

        {overCap ? (
          <>
            <Text size="xs" c="dimmed" ff="monospace" style={{ lineHeight: 1.6 }}>
              Capped at {MAX_ANALYSIS_SECONDS}s, and the trim is{" "}
              {seconds.toFixed(0)}s. Every frame is a model call, so the whole
              clip would take minutes. Park the playhead on impact and take a
              window around it — a swing needs about two seconds, and{" "}
              {MAX_ANALYSIS_SECONDS} leaves room for the address and the finish.
            </Text>
            <Button onClick={onTrimToWindow}>
              Trim to {MAX_ANALYSIS_SECONDS}s around the playhead
            </Button>
          </>
        ) : (
          <>
            <SegmentedControl
              fullWidth
              value={quality}
              onChange={(value) => onQuality(value as ModelQuality)}
              data={[
                { value: "lite", label: "lite" },
                { value: "full", label: "full" },
              ]}
            />
            <Text size="xs" c="dimmed" ff="monospace">
              {MODEL_NOTES[quality]}
            </Text>
            <Button onClick={onRun} disabled={frames < 2}>
              Find the body
            </Button>
          </>
        )}

        {error && (
          <Alert variant="light" color="red" radius="sm">
            <Text size="xs" ff="monospace">
              {error}
            </Text>
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
