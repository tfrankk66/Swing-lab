import { Badge, Group, Paper, ScrollArea, Text, UnstyledButton } from "@mantine/core";
import { FILMSTRIP_CELLS } from "../hooks/useFilmstrip";
import type { Thumbnail } from "../lib/filmstrip";

interface Props {
  thumbs: Thumbnail[];
  running: boolean;
  /** Current playhead, to mark whichever cell it is nearest. */
  frame: number;
  onSeekFrame: (frame: number) => void;
}

/**
 * The contact sheet.
 *
 * Cells that have not decoded yet are drawn as hatched blanks rather than
 * left out, so the row keeps its width while it fills and nothing under it
 * jumps — the panel below is the one holding the numbers you are reading.
 */
export function Filmstrip({ thumbs, running, frame, onSeekFrame }: Props) {
  if (thumbs.length === 0 && !running) {
    return (
      <Paper withBorder radius="sm" p="md">
        <Text size="xs" c="dimmed" ff="monospace" ta="center">
          No frames to sheet yet.
        </Text>
      </Paper>
    );
  }

  // Nearest cell rather than exact match: the playhead sits between sampled
  // frames almost always, and a sheet with nothing marked reads as inert.
  let current = -1;
  let closest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < thumbs.length; i++) {
    const thumb = thumbs[i];
    if (!thumb) continue;
    const distance = Math.abs(thumb.frame - frame);
    if (distance < closest) {
      closest = distance;
      current = i;
    }
  }

  const pending = running ? Math.max(0, FILMSTRIP_CELLS - thumbs.length) : 0;

  return (
    <ScrollArea type="auto" scrollbarSize={6} offsetScrollbars="x">
      <Group gap={2} wrap="nowrap" p={2}>
        {thumbs.map((thumb, i) => (
          <UnstyledButton
            key={thumb.frame}
            className="filmcell"
            onClick={() => onSeekFrame(thumb.frame)}
            title={
              thumb.label
                ? `${thumb.label} — frame ${thumb.frame}`
                : `Frame ${thumb.frame}`
            }
            style={{
              position: "relative",
              flex: "none",
              lineHeight: 0,
              overflow: "hidden",
              borderRadius: "var(--mantine-radius-xs)",
              outline:
                i === current
                  ? "2px solid var(--mantine-color-signal-filled)"
                  : "1px solid var(--mantine-color-default-border)",
              outlineOffset: -1,
            }}
          >
            <img src={thumb.url} alt="" />
            {thumb.label && (
              <Badge
                size="xs"
                radius="xs"
                variant="filled"
                style={{ position: "absolute", left: 0, bottom: 0 }}
              >
                {thumb.label}
              </Badge>
            )}
          </UnstyledButton>
        ))}
        {Array.from({ length: pending }, (_, i) => (
          <div key={`pending-${i}`} className="filmcell-pending" aria-hidden="true" />
        ))}
      </Group>
    </ScrollArea>
  );
}
