/**
 * @vitest-environment happy-dom
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { AnalyzePanel } from "./components/AnalyzePanel";
import { CaptureSheet } from "./components/CaptureSheet";
import { Filmstrip } from "./components/Filmstrip";
import { Intake } from "./components/Intake";
import { LogBook } from "./components/LogBook";
import { Transport } from "./components/Transport";
import { DEFAULT_REFERENCES } from "./lib/draw";
import { computeMetrics } from "./lib/metrics";
import { IMAGE_STRIDE, WORLD_STRIDE, type SwingTrack } from "./lib/track";
import { theme } from "./theme";

/**
 * Guards the per-component CSS list in `main.tsx`.
 *
 * `main.tsx` imports Mantine's stylesheets one component at a time rather than
 * taking the 234KB bundle, because this app ships to a phone that may be
 * offline. The hazard in doing that is silent: leave out the CSS for a
 * component and nothing throws — Mantine renders it with its hashed class
 * names intact and no rules behind them, so it appears unstyled, and only in
 * whichever state puts it on screen.
 *
 * This closes that hole from the other end. Mantine stamps every styled
 * element with a hashed class like `m_8d3f4000`, and each hash appears in
 * exactly the stylesheet that defines it. So: render the app's panels, collect
 * the hashes that actually reached the DOM, work out which file each one comes
 * from, and assert that file is imported.
 *
 * It catches the case that matters — a component added later whose CSS nobody
 * remembered — and it catches internal dependencies, which is the part that is
 * genuinely hard to know from the outside. `Modal` renders ModalBase, Overlay,
 * Paper and CloseButton; nothing in the import statement says so.
 */

const STYLES_DIR = join(
  process.cwd(),
  "node_modules",
  "@mantine",
  "core",
  "styles",
);

/** Every hashed class Mantine defines, mapped to the files defining it. */
function hashOwners(): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const file of readdirSync(STYLES_DIR)) {
    // `.layer.css` is the same rules wrapped in `@layer mantine`. Counting
    // both would make every hash look like it has two homes.
    if (!file.endsWith(".css") || file.endsWith(".layer.css")) continue;
    if (file === "styles.css") continue;

    const css = readFileSync(join(STYLES_DIR, file), "utf8");
    for (const match of css.matchAll(/\.(m_[0-9a-f]+)\b/g)) {
      const hash = match[1];
      if (!hash) continue;
      const list = owners.get(hash);
      if (list) {
        if (!list.includes(file)) list.push(file);
      } else {
        owners.set(hash, [file]);
      }
    }
  }
  return owners;
}

/** The stylesheet files `main.tsx` pulls in. */
function importedFiles(): Set<string> {
  const source = readFileSync(join(process.cwd(), "src", "main.tsx"), "utf8");
  const files = new Set<string>();
  for (const match of source.matchAll(
    /@mantine\/core\/styles\/([A-Za-z0-9-]+\.css)/g,
  )) {
    if (match[1]) files.add(match[1]);
  }
  return files;
}

const noop = () => {};

/** Just enough of a track to reach AnalyzePanel's "finished" branch. */
function stubTrack(): SwingTrack {
  const count = 60;
  return {
    fps: 60,
    startFrame: 0,
    count,
    videoWidth: 1080,
    videoHeight: 1920,
    analyzedWidth: 540,
    analyzedHeight: 960,
    image: new Float32Array(count * IMAGE_STRIDE),
    world: new Float32Array(count * WORLD_STRIDE),
    found: new Uint8Array(count).fill(1),
    quality: "full",
    delegate: "GPU",
    elapsedMs: 4200,
    seekMs: 2600,
    detectMs: 1600,
  };
}

/**
 * Renders every panel in the states that put different components on screen.
 *
 * Coverage here is the test's only real limit: a component that never renders
 * is a component whose CSS this cannot notice is missing. The states below are
 * chosen to reach each distinct branch — no track, mid-run, finished, over the
 * cap, and the modal.
 */
function renderEverything(): void {
  const analyzeBase = {
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

  const screens = [
    <Intake onPick={noop} />,
    <AnalyzePanel {...analyzeBase} progress={null} />,
    <AnalyzePanel {...analyzeBase} frames={3000} progress={null} />,
    <AnalyzePanel {...analyzeBase} progress={null} error="WebGL context lost" />,
    <AnalyzePanel
      {...analyzeBase}
      progress={{ stage: "detecting", done: 40, total: 100, rate: 10 }}
    />,
    // The finished branch, which is the only one carrying the reference-line
    // toggles, the phase jumps and the slow-motion readout.
    <AnalyzePanel
      {...analyzeBase}
      track={stubTrack()}
      phases={{ p1: 4, p4: 40, p7: 52, confident: true }}
      slowdown={{
        factor: 4,
        raw: 4.1,
        downswingMediaSeconds: 1.12,
        downswingRealSeconds: 0.28,
        tempo: 3,
        drift: 0.03,
        confident: true,
      }}
      slowdownApplied
      progress={null}
    />,
    <Transport playing={false} busy={false} onStep={noop} onTogglePlay={noop} />,
    <LogBook metrics={computeMetrics(null, null)} hasTrack onSeekFrame={noop} />,
    <Filmstrip
      thumbs={[
        { frame: 10, url: "data:image/jpeg;base64,x", label: "P1" },
        { frame: 50, url: "data:image/jpeg;base64,x" },
      ]}
      running
      frame={10}
      onSeekFrame={noop}
    />,
    <CaptureSheet
      rate={{ fps: 60, source: "measured", samples: 40, slowPass: false }}
      slowdown={4}
      estimate={null}
      onApply={noop}
      onClose={noop}
    />,
  ];

  for (const screen of screens) {
    render(<MantineProvider theme={theme}>{screen}</MantineProvider>);
  }
}

/** Hashed Mantine classes present anywhere in the rendered document. */
function usedHashes(): Set<string> {
  const used = new Set<string>();
  for (const element of document.querySelectorAll<HTMLElement>("*")) {
    for (const name of element.classList) {
      if (/^m_[0-9a-f]+$/.test(name)) used.add(name);
    }
  }
  return used;
}

describe("per-component Mantine CSS", () => {
  it("imports a stylesheet for every component that reaches the DOM", () => {
    renderEverything();

    const owners = hashOwners();
    const imported = importedFiles();
    const missing = new Map<string, string[]>();

    for (const hash of usedHashes()) {
      const files = owners.get(hash);
      // A hash with no owning file is Mantine styling something from a
      // stylesheet we cannot see — not something this test can rule on.
      if (!files || files.length === 0) continue;
      if (files.some((file) => imported.has(file))) continue;
      missing.set(hash, files);
    }

    expect(
      Object.fromEntries(missing),
      "These Mantine classes are in the DOM but no stylesheet defining them is " +
        "imported by main.tsx. Add the file(s) listed for each.",
    ).toEqual({});
  });

  it("does not import stylesheets nothing renders", () => {
    // The other direction. Not a correctness problem — dead CSS is only
    // weight — but the whole point of the list is that it stays minimal, and
    // an entry nothing uses is one somebody kept out of superstition.
    renderEverything();

    const owners = hashOwners();
    const used = usedHashes();
    const earning = new Set<string>();
    for (const hash of used) {
      for (const file of owners.get(hash) ?? []) earning.add(file);
    }

    // Base files carry variables and resets rather than hashed classes, so
    // they never show up as "earning" and are exempt.
    const base = new Set([
      "baseline.css",
      "default-css-variables.css",
      "global.css",
    ]);

    const unused = [...importedFiles()].filter(
      (file) => !base.has(file) && !earning.has(file),
    );

    expect(unused, "Imported but never rendered by any test screen.").toEqual([]);
  });
});
