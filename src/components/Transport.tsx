import { ActionIcon, Button, Group, Text } from "@mantine/core";

interface Props {
  playing: boolean;
  /** True while detection owns the video element. */
  busy: boolean;
  onStep: (delta: number) => void;
  onTogglePlay: () => void;
}

/**
 * Play, pause, and frame stepping.
 *
 * Every control here drives the video element, which detection owns while it
 * runs. Disabled rather than left live and ignored: a transport that responds
 * to nothing is the same thing as a broken one from the other side of the
 * screen.
 *
 * Its own component rather than inline in App mostly so it can be rendered on
 * its own — `mantine-css.test.tsx` can only check the stylesheet list against
 * components it is able to put on screen, and these were the last Mantine
 * controls that lived somewhere nothing could reach.
 */
export function Transport({ playing, busy, onStep, onTogglePlay }: Props) {
  return (
    <Group gap={6} wrap="nowrap">
      <ActionIcon
        variant="default"
        onClick={() => onStep(-10)}
        disabled={busy}
        aria-label="Back ten frames"
      >
        <Text size="xs" ff="monospace">
          −10
        </Text>
      </ActionIcon>
      <ActionIcon
        variant="default"
        onClick={() => onStep(-1)}
        disabled={busy}
        aria-label="Back one frame"
      >
        <Text size="sm">◀</Text>
      </ActionIcon>
      <Button flex={1} onClick={onTogglePlay} disabled={busy} tt="uppercase">
        {busy ? "Analysing" : playing ? "Pause" : "Play"}
      </Button>
      <ActionIcon
        variant="default"
        onClick={() => onStep(1)}
        disabled={busy}
        aria-label="Forward one frame"
      >
        <Text size="sm">▶</Text>
      </ActionIcon>
      <ActionIcon
        variant="default"
        onClick={() => onStep(10)}
        disabled={busy}
        aria-label="Forward ten frames"
      >
        <Text size="xs" ff="monospace">
          +10
        </Text>
      </ActionIcon>
    </Group>
  );
}
