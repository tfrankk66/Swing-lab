import { useRef, useState, type DragEvent } from "react";
import {
  Button,
  Divider,
  List,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";

interface Props {
  onPick: (file: File) => void;
}

/**
 * First screen: choose a clip, plus the filming rules the measurements assume.
 *
 * The drop target is a plain Paper rather than `@mantine/dropzone`. That
 * package is a whole extra dependency for one screen, and all it would buy
 * here is what these four native handlers already do.
 */
export function Intake({ onPick }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file?.type.startsWith("video/")) onPick(file);
  };

  return (
    <Stack className="intake" justify="center" gap="lg" p="md" style={{ flex: 1, overflowY: "auto" }}>
      <Paper
        withBorder
        p="xl"
        radius="sm"
        bg={over ? "var(--mantine-primary-color-light)" : undefined}
        style={{
          borderStyle: over ? "solid" : "dashed",
          borderColor: over ? "var(--mantine-primary-color-filled)" : undefined,
          transition: "background 0.15s, border-color 0.15s",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
      >
        <Stack align="center" gap="sm">
          <Title order={1} size="h2" tt="uppercase" ta="center">
            Load a swing
          </Title>
          <Text c="dimmed" ta="center" maw="30ch">
            Down-the-line, shot in your phone&rsquo;s slow-motion mode.
          </Text>
          <Button onClick={() => inputRef.current?.click()}>Choose video</Button>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPick(file);
              e.target.value = "";
            }}
          />
        </Stack>
      </Paper>

      <Paper withBorder p="md" radius="sm">
        <Text size="xs" c="dimmed" tt="uppercase" ff="monospace" lts="0.1em">
          Camera setup
        </Text>
        <Divider my="xs" />
        <List type="ordered" size="sm" c="dimmed" spacing="xs">
          <List.Item>
            Stand the phone{" "}
            <Text span fw={700} c="var(--mantine-color-text)">
              behind the ball, on the target line
            </Text>
            , lens at about hand height.
          </List.Item>
          <List.Item>
            <Text span fw={700} c="var(--mantine-color-text)">
              Slow motion, 240fps.
            </Text>{" "}
            At 30fps the clubhead moves five feet between frames and impact
            never lands on one.
          </List.Item>
          <List.Item>
            Frame from{" "}
            <Text span fw={700} c="var(--mantine-color-text)">
              above your head to below the ball
            </Text>
            , with a little room left and right.
          </List.Item>
          <List.Item>
            <Text span fw={700} c="var(--mantine-color-text)">
              Mark the spot.
            </Text>{" "}
            Same distance and height every session, or trends across sessions
            measure the tripod, not the swing.
          </List.Item>
        </List>
      </Paper>
    </Stack>
  );
}
