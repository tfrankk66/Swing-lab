/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { AnalyzePanel } from "./AnalyzePanel";
import { CaptureSheet } from "./CaptureSheet";
import { Filmstrip } from "./Filmstrip";
import { Intake } from "./Intake";
import { LogBook } from "./LogBook";
import { CoachPanel } from "./CoachPanel";
import { CoachError } from "../lib/coach";
import { DEFAULT_REFERENCES } from "../lib/draw";
import { computeMetrics } from "../lib/metrics";
import { ALL_GREEN, withReadings } from "../lib/metrics.fixture";
import { theme } from "../theme";

/**
 * Does the Mantine conversion actually render?
 *
 * Type-checking a component tree proves the props exist, not that they are
 * the right ones — `c="signal.filled"` type-checks and resolves to nothing,
 * and a Mantine component used outside its provider throws only at runtime.
 * These mount each converted panel and look for the words that should be on
 * screen. They are not layout tests; happy-dom could not answer that question.
 */
function wrap(ui: ReactNode) {
  return render(<MantineProvider theme={theme}>{ui}</MantineProvider>);
}

/**
 * Explicit, because Testing Library's automatic version does not run here.
 *
 * RTL registers its own `afterEach(cleanup)` by reaching for a global hook,
 * and this suite runs without `globals: true`. Without this line every render
 * stacks into the same document: the second test sees the first one's buttons,
 * and assertions about what is *not* on screen quietly stop meaning anything.
 */
afterEach(cleanup);

const noop = () => {};

describe("Intake", () => {
  it("renders the empty state and the filming rules", () => {
    wrap(<Intake onPick={noop} />);
    expect(screen.getByText("Load a swing")).toBeDefined();
    expect(screen.getByRole("button", { name: /choose video/i })).toBeDefined();
    expect(screen.getByText(/Camera setup/i)).toBeDefined();
    expect(screen.getByText(/behind the ball, on the target line/i)).toBeDefined();
  });
});

describe("AnalyzePanel", () => {
  const base = {
    track: null,
    phases: null,
    slowdown: null,
    slowdownApplied: false,
    onSeekFrame: noop,
    error: null,
    quality: "full" as const,
    frames: 120,
    fps: 60,
    overlayOn: true,
    onQuality: noop,
    onRun: noop,
    onCancel: noop,
    onToggleOverlay: noop,
    onTrimToWindow: noop,
    references: DEFAULT_REFERENCES,
    onToggleReference: noop,
  };

  it("offers a run when there is no track yet", () => {
    wrap(<AnalyzePanel {...base} progress={null} />);
    expect(screen.getByRole("button", { name: /find the body/i })).toBeDefined();
    expect(screen.getByText(/120 frames/)).toBeDefined();
  });

  it("refuses a range past the cap and offers to narrow it", () => {
    // 15s cap at 60fps is 900 frames; 3000 is well past it.
    wrap(<AnalyzePanel {...base} frames={3000} progress={null} />);
    expect(screen.getByRole("button", { name: /trim to 15s/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /find the body/i })).toBeNull();
  });

  it("shows progress and a cancel while a pass is running", () => {
    wrap(
      <AnalyzePanel
        {...base}
        progress={{ stage: "detecting", done: 40, total: 100, rate: 10 }}
      />,
    );
    expect(screen.getByText(/Detecting/)).toBeDefined();
    expect(screen.getByText(/~6s left/)).toBeDefined();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDefined();
  });

  it("surfaces an error rather than swallowing it", () => {
    wrap(
      <AnalyzePanel {...base} progress={null} error="WebGL context lost" />,
    );
    expect(screen.getByText("WebGL context lost")).toBeDefined();
  });
});

describe("LogBook", () => {
  it("says so when there is nothing to read yet", () => {
    wrap(<LogBook metrics={[]} hasTrack={false} onSeekFrame={noop} />);
    expect(screen.getByText(/once there is a pose track/i)).toBeDefined();
  });

  it("explains an ungraded swing instead of calling it unread", () => {
    // Numbers, but phases were a guess — what a trim that starts after the
    // takeaway produces.
    const metrics = withReadings({ "spine-tilt": 23, tempo: 0.8 }).map((m) => ({
      ...m,
      verdict: "unknown" as const,
    }));
    wrap(<LogBook metrics={metrics} hasTrack onSeekFrame={noop} />);
    expect(screen.getByText("not graded")).toBeDefined();
    expect(screen.getByText(/before the club moves/)).toBeDefined();
  });

  it("renders all nine rows with their lights", () => {
    // No track, so every reading is unread — which is itself the case worth
    // rendering, because it is what a failed detection looks like.
    const metrics = computeMetrics(null, null);
    wrap(<LogBook metrics={metrics} hasTrack onSeekFrame={noop} />);

    for (const metric of metrics) {
      expect(screen.getByText(metric.name), metric.id).toBeDefined();
    }
    expect(screen.getByText("9 unread")).toBeDefined();
  });
});

describe("CoachPanel", () => {
  const faulty = () =>
    withReadings({ ...ALL_GREEN, "early-extension": 12, tempo: 1.5 });

  afterEach(() => window.localStorage.clear());

  it("waits for a track", () => {
    wrap(<CoachPanel metrics={[]} hasTrack={false} onSeekFrame={noop} />);
    expect(screen.getByText(/once there are measurements/i)).toBeDefined();
  });

  it("prescribes drills offline, worst fault first", () => {
    wrap(<CoachPanel metrics={faulty()} hasTrack onSeekFrame={noop} />);
    expect(screen.getByText("Hips pushing toward the ball")).toBeDefined();
    expect(screen.getByText("Rushed transition")).toBeDefined();
    expect(screen.getByRole("button", { name: "Backside on the chair" })).toBeDefined();
    // No key yet, so it asks for one instead of offering the lesson.
    expect(screen.getByLabelText(/Anthropic API key/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /get a lesson/i })).toBeNull();
  });

  it("says so when nothing is wrong", () => {
    wrap(<CoachPanel metrics={withReadings(ALL_GREEN)} hasTrack onSeekFrame={noop} />);
    expect(screen.getByText(/nothing here is obviously wrong/i)).toBeDefined();
  });

  it("does not offer Claude when nothing was measured", () => {
    wrap(<CoachPanel metrics={computeMetrics(null, null)} hasTrack onSeekFrame={noop} />);
    expect(screen.getByText(/nothing was measured well enough/i)).toBeDefined();
    expect(screen.queryByLabelText(/Anthropic API key/i)).toBeNull();
  });

  it("blames the trim, not the camera, when the swing was not graded", () => {
    const metrics = withReadings({ "spine-tilt": 23 }).map((m) => ({
      ...m,
      verdict: "unknown" as const,
    }));
    wrap(<CoachPanel metrics={metrics} hasTrack onSeekFrame={noop} />);
    expect(screen.getByText(/before the club moves/)).toBeDefined();
    expect(screen.queryByText(/Check the filming setup/)).toBeNull();
  });

  it("opens a drill's steps when tapped", () => {
    wrap(<CoachPanel metrics={faulty()} hasTrack onSeekFrame={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Backside on the chair" }));
    expect(screen.getByText(/Feel:/)).toBeDefined();
  });

  it("saves a key, asks the coach with it, and shows the lesson", async () => {
    const ask = vi.fn(async (key: string) => ({
      headline: `Lesson for ${key}`,
      plan: "Twenty chair drills.",
      model: "claude-opus-5-5",
      priorities: [
        {
          metricId: "early-extension",
          why: "Your hips run out of room.",
          cue: "Backside back to the chair",
          drills: [],
        },
      ],
    }));
    wrap(<CoachPanel metrics={faulty()} hasTrack onSeekFrame={noop} ask={ask} />);

    fireEvent.change(screen.getByLabelText(/Anthropic API key/i), {
      target: { value: "  sk-ant-test  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: /get a lesson/i }));

    expect(await screen.findByText("Lesson for sk-ant-test")).toBeDefined();
    expect(screen.getByText(/Backside back to the chair/)).toBeDefined();
    expect(screen.getByText(/from the numbers only/)).toBeDefined();
    expect(window.localStorage.getItem("swing-lab.anthropic-key")).toBe("sk-ant-test");
  });

  it("shows a coach failure as a message", async () => {
    window.localStorage.setItem("swing-lab.anthropic-key", "sk-ant-bad");
    const ask = vi.fn(async () => {
      throw new CoachError("Anthropic rejected that API key.");
    });
    wrap(<CoachPanel metrics={faulty()} hasTrack onSeekFrame={noop} ask={ask} />);
    fireEvent.click(screen.getByRole("button", { name: /get a lesson/i }));
    expect(await screen.findByText(/rejected that API key/)).toBeDefined();
  });
});

describe("Filmstrip", () => {
  it("says so when the sheet is empty", () => {
    wrap(
      <Filmstrip thumbs={[]} running={false} frame={0} onSeekFrame={noop} />,
    );
    expect(screen.getByText(/no frames to sheet/i)).toBeDefined();
  });

  it("labels the phase cells", () => {
    wrap(
      <Filmstrip
        thumbs={[
          { frame: 10, url: "data:image/jpeg;base64,x", label: "P1" },
          { frame: 50, url: "data:image/jpeg;base64,x" },
          { frame: 90, url: "data:image/jpeg;base64,x", label: "P7" },
        ]}
        running={false}
        frame={50}
        onSeekFrame={noop}
      />,
    );
    expect(screen.getByText("P1")).toBeDefined();
    expect(screen.getByText("P7")).toBeDefined();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});

describe("CaptureSheet", () => {
  it("mounts as a modal with both settings and the sampling verdict", () => {
    wrap(
      <CaptureSheet
        rate={{ fps: 60, source: "measured", samples: 40, slowPass: false }}
        slowdown={4}
        estimate={null}
        onApply={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText("Capture settings")).toBeDefined();
    expect(screen.getByText(/Container frame rate/i)).toBeDefined();
    expect(screen.getByText(/already baked in/i)).toBeDefined();
    // 60fps container at 4x is 240fps of real sampling — trustworthy.
    expect(screen.getByText(/240 fps/)).toBeDefined();
    expect(screen.getByText(/trustworthy/i)).toBeDefined();
  });

  it("shows what the swing concluded when there is an inference", () => {
    wrap(
      <CaptureSheet
        rate={{ fps: 60, source: "measured", samples: 40, slowPass: false }}
        slowdown={1}
        estimate={{
          factor: 4,
          raw: 4.1,
          downswingMediaSeconds: 1.12,
          downswingRealSeconds: 0.28,
          tempo: 3,
          drift: 0.03,
          confident: true,
        }}
        onApply={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText(/The swing says 4/)).toBeDefined();
    // Currently on 1x, so it offers the measured value rather than assuming.
    expect(screen.getByRole("button", { name: /use the measured 4/i })).toBeDefined();
  });
});

describe("the provider contract", () => {
  it("throws outside MantineProvider, which is why wrap() exists", () => {
    // Guards the setup itself: if Mantine ever stops requiring a provider,
    // this test tells us the wrapper is now ceremony rather than necessity.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(<LogBook metrics={[]} hasTrack={false} onSeekFrame={noop} />),
    ).toThrow();
    quiet.mockRestore();
  });
});
