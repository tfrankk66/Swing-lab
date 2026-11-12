import { useState } from "react";
import {
  Accordion,
  Badge,
  Box,
  Group,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import {
  TRIM_ADVICE,
  formatMetric,
  phasesUnsure,
  tally,
  type Metric,
  type Verdict,
} from "../lib/metrics";

interface Props {
  metrics: Metric[];
  /** False until a track exists — the panel says so rather than showing nine dashes. */
  hasTrack: boolean;
  onSeekFrame: (frame: number) => void;
}

/**
 * Verdict to Mantine colour.
 *
 * `signal` and not `green`: the theme's green is the palette's own 20BF55,
 * the same one the playhead uses, and a good reading should be the same green
 * as everything else that means good.
 */
const VERDICT_COLOR: Record<Verdict, string> = {
  good: "signal",
  watch: "yellow",
  crit: "red",
  unknown: "gray",
};

/**
 * The log book: nine measurements, one to a line.
 *
 * An Accordion rather than a list of rows with hand-rolled expansion, and it
 * is a better fit than the markup it replaces: single-open is the default, the
 * control is already a button with the right ARIA, and keyboard handling comes
 * with it. Tapping a row jumps the playhead to the frame that reading was
 * taken at — the number on its own is a fact, and the fact is only useful next
 * to the position it came from.
 */
export function LogBook({ metrics, hasTrack, onSeekFrame }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  if (!hasTrack) {
    return (
      <Paper withBorder radius="sm" p="sm">
        <Text size="xs" c="dimmed" tt="uppercase" ff="monospace" lts="0.1em">
          Log book
        </Text>
        <Text size="xs" c="dimmed" ff="monospace" mt="xs">
          Nine measurements, once there is a pose track to read them from.
        </Text>
      </Paper>
    );
  }

  const counts = tally(metrics);
  const unsure = phasesUnsure(metrics);
  const summary = unsure ? "not graded" : [
    counts.good > 0 ? `${counts.good} green` : null,
    counts.watch > 0 ? `${counts.watch} amber` : null,
    counts.crit > 0 ? `${counts.crit} red` : null,
    counts.unknown > 0 ? `${counts.unknown} unread` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const headline: Verdict =
    counts.crit > 0
      ? "crit"
      : counts.watch > 0
        ? "watch"
        : counts.unknown === metrics.length
          ? "unknown"
          : "good";

  return (
    <Paper withBorder radius="sm" p="sm">
      <Group justify="space-between" wrap="nowrap" mb="xs">
        <Text size="xs" c="dimmed" tt="uppercase" ff="monospace" lts="0.1em">
          Log book
        </Text>
        <Badge
          size="sm"
          radius="sm"
          variant="light"
          color={VERDICT_COLOR[headline]}
        >
          {summary}
        </Badge>
      </Group>

      {unsure && (
        <Text size="xs" c="dimmed" ff="monospace" mb="xs" style={{ lineHeight: 1.6 }}>
          {TRIM_ADVICE}
        </Text>
      )}

      <Accordion
        value={open}
        onChange={setOpen}
        variant="default"
        chevronPosition="right"
        styles={{
          control: { paddingLeft: 0, paddingRight: "var(--mantine-spacing-xs)" },
          label: { paddingTop: 6, paddingBottom: 6 },
          content: { paddingLeft: "var(--mantine-spacing-sm)" },
        }}
      >
        {metrics.map((metric) => (
          <Accordion.Item key={metric.id} value={metric.id}>
            <Accordion.Control
              onClick={() => {
                if (metric.frame !== null) onSeekFrame(metric.frame);
              }}
            >
              <Group gap="sm" wrap="nowrap">
                {/* The navigation light. The column of them reads top to
                    bottom as the state of the swing before a single number
                    has been. */}
                <Box
                  w={4}
                  style={{
                    alignSelf: "stretch",
                    borderRadius: 2,
                    background: `var(--mantine-color-${VERDICT_COLOR[metric.verdict]}-filled)`,
                  }}
                />
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={600} tt="uppercase" lts="0.02em">
                    {metric.name}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {metric.where}
                  </Text>
                </Box>
                <Text
                  ff="monospace"
                  fw={600}
                  // The CSS variable rather than a Mantine colour name: the
                  // name resolves to a fixed shade, and `-filled` is the one
                  // that stays legible as the colour scheme flips.
                  c={
                    metric.verdict === "unknown"
                      ? "dimmed"
                      : `var(--mantine-color-${VERDICT_COLOR[metric.verdict]}-filled)`
                  }
                  style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
                >
                  {formatMetric(metric)}
                  <Text span size="xs" c="dimmed" ml={2}>
                    {metric.unit}
                  </Text>
                </Text>
              </Group>
            </Accordion.Control>

            <Accordion.Panel>
              <Stack gap="xs">
                <Band metric={metric} />
                <Text size="xs" c="dimmed" ff="monospace" style={{ lineHeight: 1.6 }}>
                  {metric.fault}
                </Text>
                {metric.caveat && (
                  <Text size="xs" c="dimmed" ff="monospace" style={{ lineHeight: 1.6 }}>
                    What it cannot see: {metric.caveat}
                  </Text>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Paper>
  );
}

/**
 * The expected range, with the reading marked on it.
 *
 * A number with no band beside it cannot say whether it is a hair outside or
 * nowhere near, and those are different lessons. Mantine has no component for
 * "range within a range with a marker", so this stays a few absolutely
 * positioned elements.
 */
function Band({ metric }: { metric: Metric }) {
  const [lo, hi] = metric.scale;
  const span = hi - lo || 1;
  const place = (value: number) =>
    Math.min(100, Math.max(0, ((value - lo) / span) * 100));

  const from = place(metric.good[0]);
  const to = place(metric.good[1]);

  return (
    <Box>
      <div className="logband">
        <i style={{ left: `${from}%`, width: `${Math.max(1, to - from)}%` }} />
        {metric.value !== null && Number.isFinite(metric.value) && (
          <b style={{ left: `${place(metric.value)}%` }} />
        )}
      </div>
      <Group justify="space-between" mt={2}>
        <Text size="xs" c="dimmed" ff="monospace">
          {lo}
        </Text>
        <Text size="xs" c="dimmed" ff="monospace">
          good {metric.good[0]}&ndash;{metric.good[1]}
          {metric.unit}
        </Text>
        <Text size="xs" c="dimmed" ff="monospace">
          {hi}
        </Text>
      </Group>
    </Box>
  );
}
