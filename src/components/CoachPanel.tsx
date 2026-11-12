import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  List,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  CoachError,
  askCoach,
  canCoach,
  loadApiKey,
  saveApiKey,
  type Coaching,
} from "../lib/coach";
import { prescribe, type Drill } from "../lib/drills";
import type { Metric, Verdict } from "../lib/metrics";

interface Props {
  metrics: Metric[];
  hasTrack: boolean;
  onSeekFrame: (frame: number) => void;
  /** Injected for tests; the real call otherwise. */
  ask?: typeof askCoach;
}

const VERDICT_COLOR: Record<Verdict, string> = {
  good: "signal",
  watch: "yellow",
  crit: "red",
  unknown: "gray",
};

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" c="dimmed" tt="uppercase" ff="monospace" lts="0.1em">
      {children}
    </Text>
  );
}

/**
 * Coaching, in two layers.
 *
 * The top layer is always there and needs no signal: the worst readings,
 * ranked, each with drills from the curated library. The second is optional:
 * Claude reads the same nine numbers and writes the lesson — which fault is
 * the root, why, and one thought to take to the next ball. Online, with the
 * golfer's own key; never with the video.
 */
export function CoachPanel({ metrics, hasTrack, onSeekFrame, ask = askCoach }: Props) {
  const [key, setKey] = useState(loadApiKey);
  const [draft, setDraft] = useState("");
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A lesson is about one set of numbers. When the track changes, it is
  // about a different swing and has to go.
  useEffect(() => {
    abortRef.current?.abort();
    setCoaching(null);
    setError(null);
  }, [metrics]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!hasTrack) {
    return (
      <Paper withBorder radius="sm" p="sm">
        <PanelLabel>Coach</PanelLabel>
        <Text size="xs" c="dimmed" ff="monospace" mt="xs">
          Drills and a lesson, once there are measurements to coach from.
        </Text>
      </Paper>
    );
  }

  const prescriptions = prescribe(metrics);
  const measurable = canCoach(metrics);

  const run = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAsking(true);
    setError(null);
    try {
      setCoaching(await ask(key, metrics, controller.signal));
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof CoachError
          ? caught.message
          : "Something went wrong asking the coach.",
      );
    } finally {
      if (abortRef.current === controller) setAsking(false);
    }
  };

  const saveKey = () => {
    const trimmed = draft.trim();
    saveApiKey(trimmed);
    setKey(trimmed);
    setDraft("");
  };

  const forgetKey = () => {
    saveApiKey("");
    setKey("");
    setCoaching(null);
  };

  const byId = new Map(metrics.map((m) => [m.id, m]));

  return (
    <Paper withBorder radius="sm" p="sm">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <PanelLabel>Coach</PanelLabel>
          <Badge size="sm" radius="sm" variant="light" color="gray">
            works offline
          </Badge>
        </Group>

        {!measurable ? (
          <Text size="xs" c="dimmed" ff="monospace">
            Nothing was measured well enough to coach from. Check the filming
            setup and run detection again.
          </Text>
        ) : prescriptions.length === 0 ? (
          <Text size="sm">
            Nothing here is obviously wrong. Keep filming from the same spot so
            the next session can be compared with this one.
          </Text>
        ) : (
          <Stack gap="md">
            {prescriptions.map((p, index) => (
              <Stack key={p.metric.id} gap={6}>
                <Group gap="xs" wrap="nowrap">
                  <Badge
                    size="sm"
                    radius="sm"
                    variant="filled"
                    color={VERDICT_COLOR[p.verdict]}
                  >
                    {index + 1}
                  </Badge>
                  <Anchor
                    component="button"
                    type="button"
                    size="sm"
                    fw={600}
                    c="inherit"
                    onClick={() => {
                      if (p.metric.frame !== null) onSeekFrame(p.metric.frame);
                    }}
                  >
                    {p.label}
                  </Anchor>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {p.metric.name.toLowerCase()}
                  </Text>
                </Group>
                {p.drills.map((drill) => (
                  <DrillCard key={drill.id} drill={drill} />
                ))}
              </Stack>
            ))}
          </Stack>
        )}

        {measurable && (
          <Box pt="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
            <Stack gap="xs">
              <PanelLabel>Ask Claude</PanelLabel>

              {!key ? (
                <>
                  <Text size="xs" c="dimmed" ff="monospace" style={{ lineHeight: 1.6 }}>
                    Claude reads the nine numbers and writes the lesson: which
                    fault is the root, and one thought for the next ball. Only
                    the numbers are sent, never the video. Needs your own
                    Anthropic API key, kept in this browser only.
                  </Text>
                  <Group gap="xs" wrap="nowrap" align="flex-end">
                    <TextInput
                      style={{ flex: 1 }}
                      size="xs"
                      type="password"
                      label="Anthropic API key"
                      placeholder="sk-ant-…"
                      autoComplete="off"
                      value={draft}
                      onChange={(e) => setDraft(e.currentTarget.value)}
                    />
                    <Button size="xs" onClick={saveKey} disabled={!draft.trim()}>
                      Save
                    </Button>
                  </Group>
                </>
              ) : (
                <Group gap="xs" justify="space-between">
                  <Button size="xs" onClick={() => void run()} disabled={asking}>
                    {asking ? "Asking Claude…" : coaching ? "Ask again" : "Get a lesson"}
                  </Button>
                  <Anchor component="button" type="button" size="xs" c="dimmed" onClick={forgetKey}>
                    Forget key
                  </Anchor>
                </Group>
              )}

              {error && (
                <Alert color="red" variant="light" p="xs">
                  <Text size="xs">{error}</Text>
                </Alert>
              )}

              {coaching && (
                <Stack gap="sm">
                  {coaching.headline && <Text size="sm" fw={600}>{coaching.headline}</Text>}
                  {coaching.priorities.map((priority, index) => {
                    const metric = byId.get(priority.metricId);
                    return (
                      <Stack key={`${priority.metricId}-${index}`} gap={4}>
                        <Group gap="xs" wrap="nowrap">
                          <Badge
                            size="sm"
                            radius="sm"
                            variant="light"
                            color={VERDICT_COLOR[metric?.verdict ?? "unknown"]}
                          >
                            {index + 1}
                          </Badge>
                          <Text size="sm" fw={600}>
                            {metric?.name ?? priority.metricId}
                          </Text>
                        </Group>
                        {priority.why && <Text size="sm">{priority.why}</Text>}
                        {priority.cue && (
                          <Text size="sm" fs="italic">
                            “{priority.cue}”
                          </Text>
                        )}
                        {priority.drills.map((drill) => (
                          <DrillCard key={drill.id} drill={drill} />
                        ))}
                      </Stack>
                    );
                  })}
                  {coaching.plan && (
                    <Text size="sm">
                      <Text span size="xs" c="dimmed" tt="uppercase" ff="monospace" lts="0.1em">
                        Next session ·{" "}
                      </Text>
                      {coaching.plan}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed" ff="monospace">
                    {coaching.model} · from the numbers only
                  </Text>
                </Stack>
              )}
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

/** One drill, folded down to its name until tapped. */
function DrillCard({ drill }: { drill: Drill }) {
  const [open, setOpen] = useState(false);
  return (
    <Box
      pl="sm"
      style={{ borderLeft: "2px solid var(--mantine-color-default-border)" }}
    >
      <Anchor
        component="button"
        type="button"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {drill.name}
      </Anchor>
      <Text size="xs" c="dimmed" ff="monospace">
        {drill.kit} · {drill.reps}
      </Text>
      {open && (
        <Stack gap={4} mt={4}>
          <List type="ordered" size="sm" spacing={2}>
            {drill.steps.map((step) => (
              <List.Item key={step}>{step}</List.Item>
            ))}
          </List>
          <Text size="xs" c="dimmed" ff="monospace" style={{ lineHeight: 1.6 }}>
            Feel: {drill.feel}
          </Text>
        </Stack>
      )}
    </Box>
  );
}
