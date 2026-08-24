import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import type { FrameRateResult } from "../lib/fps";
import { effectiveFps, impactResolutionCm } from "../lib/frames";
import { describeSlowdown, type SlowdownEstimate } from "../lib/slowmo";

interface Props {
  rate: FrameRateResult;
  slowdown: number;
  /** What the detected downswing says the factor is, once there is a track. */
  estimate: SlowdownEstimate | null;
  onApply: (fps: number, slowdown: number) => void;
  onClose: () => void;
}

const PRESETS = [30, 60, 120, 240];
const SLOWDOWNS = [1, 2, 4, 8];

/**
 * Manual override for capture settings.
 *
 * Two numbers matter and neither is reported by any browser API. Container
 * frame rate we can measure by watching frames arrive; the slow-motion factor
 * is not in the file at all, because a phone that shoots 240fps often writes
 * a 30fps container with the slowdown already baked in. Those two clips are
 * identical to the browser and eight times apart in real temporal resolution
 * — which is the whole ballgame for impact.
 *
 * Since v0.3 the factor is inferred from the detected downswing instead of
 * guessed at (see `slowmo.ts`), and this sheet shows what that inference
 * concluded. It stays open to being overruled: the swing is a good clock, not
 * a perfect one, and anything typed here outranks it from then on.
 */
export function CaptureSheet({
  rate,
  slowdown,
  estimate,
  onApply,
  onClose,
}: Props) {
  const [fps, setFps] = useState(rate.fps);
  const [factor, setFactor] = useState(slowdown);

  const effective = effectiveFps(fps, factor);
  const resolution = impactResolutionCm(effective);
  const verdict =
    resolution <= 25 ? "signal" : resolution <= 50 ? "yellow" : "red";

  return (
    <Modal
      opened
      onClose={onClose}
      title="Capture settings"
      centered
      radius="sm"
      size="md"
    >
      <Stack gap="lg">
        <Stack gap="xs">
          <Text size="xs" c="dimmed" tt="uppercase" ff="monospace" lts="0.1em">
            Container frame rate
          </Text>
          <SegmentedControl
            fullWidth
            value={PRESETS.includes(fps) ? String(fps) : ""}
            onChange={(value) => setFps(Number(value))}
            data={PRESETS.map((preset) => ({
              value: String(preset),
              label: String(preset),
            }))}
          />
          <NumberInput
            aria-label="Container frame rate"
            min={1}
            max={2000}
            value={fps}
            onChange={(value) => setFps(Number(value) || 1)}
            // Style props land on the root, and the font has to reach the
            // input itself for the digits to line up.
            styles={{
              input: { fontFamily: "var(--mantine-font-family-monospace)" },
            }}
          />
          <Text size="xs" c="dimmed">
            {rate.source === "measured"
              ? `Measured at ${rate.fps} from ${rate.samples} frames${
                  rate.slowPass ? ", slow pass" : ""
                }.`
              : "Could not measure — this browser has no frame callback API."}
          </Text>
        </Stack>

        <Stack gap="xs">
          <Text size="xs" c="dimmed" tt="uppercase" ff="monospace" lts="0.1em">
            Slow-motion factor already baked in
          </Text>
          <SegmentedControl
            fullWidth
            value={String(factor)}
            onChange={(value) => setFactor(Number(value))}
            data={SLOWDOWNS.map((value) => ({
              value: String(value),
              label: `${value}×`,
            }))}
          />
          {estimate?.confident ? (
            <Alert
              variant="light"
              color="signal"
              radius="sm"
              title={`The swing says ${estimate.factor}×`}
            >
              <Text size="xs" ff="monospace" style={{ lineHeight: 1.6 }}>
                {describeSlowdown(estimate)}
              </Text>
              {estimate.factor !== factor && (
                <Button
                  size="xs"
                  variant="default"
                  mt="xs"
                  onClick={() => setFactor(estimate.factor)}
                >
                  Use the measured {estimate.factor}×
                </Button>
              )}
            </Alert>
          ) : (
            <Text size="xs" c="dimmed">
              Pick 1× if the swing takes about a second on screen. Pick 8× if
              it drifts by in slow motion.
            </Text>
          )}
        </Stack>

        <Stack gap="xs">
          <Text size="xs" c="dimmed" tt="uppercase" ff="monospace" lts="0.1em">
            Real-world sampling
          </Text>
          <Group gap="xs" align="baseline">
            <Badge color={verdict} variant="light" radius="sm" ff="monospace">
              {Math.round(effective)} fps · {resolution.toFixed(0)} cm per frame
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            How far a 100mph clubhead travels between frames.{" "}
            {resolution <= 25
              ? "Impact metrics are trustworthy."
              : resolution <= 50
                ? "Impact metrics will be marked low-confidence."
                : "Too coarse for impact metrics; backswing metrics still work."}
          </Text>
        </Stack>

        <Group grow>
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(fps, factor)}>Apply</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
