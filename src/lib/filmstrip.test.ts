import { describe, expect, it } from "vitest";
import { filmstripFrames } from "./filmstrip";
import type { SwingPhases } from "./phases";

const phases = (p1: number, p4: number, p7: number): SwingPhases => ({
  p1,
  p4,
  p7,
  confident: true,
});

describe("filmstripFrames", () => {
  it("spans the trim end to end", () => {
    const cells = filmstripFrames(20, 140, null, 9);
    expect(cells[0]?.frame).toBe(20);
    expect(cells[cells.length - 1]?.frame).toBe(140);
    expect(cells).toHaveLength(9);
  });

  it("comes back in order with no repeats", () => {
    const cells = filmstripFrames(0, 200, phases(12, 96, 150), 9);
    const frames = cells.map((c) => c.frame);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
    expect(new Set(frames).size).toBe(frames.length);
  });

  it("puts every phase on the sheet", () => {
    const cells = filmstripFrames(0, 200, phases(12, 96, 150), 9);
    const labelled = new Map(cells.filter((c) => c.label).map((c) => [c.label, c.frame]));
    expect(labelled.get("P1")).toBe(12);
    expect(labelled.get("P4")).toBe(96);
    expect(labelled.get("P7")).toBe(150);
  });

  it("keeps the cell count when phases displace even slots", () => {
    // Substitution, not insertion — the row stays the length it was asked for.
    const withoutPhases = filmstripFrames(0, 200, null, 9);
    const withPhases = filmstripFrames(0, 200, phases(12, 96, 150), 9);
    expect(withPhases).toHaveLength(withoutPhases.length);
  });

  it("does not collapse two phases onto one cell", () => {
    // A downswing of four frames puts P4 and P7 inside one slot's width. Both
    // still have to appear, or the sheet silently loses impact.
    const cells = filmstripFrames(0, 60, phases(2, 50, 54), 9);
    const labels = cells.filter((c) => c.label).map((c) => c.label);
    expect(labels).toContain("P4");
    expect(labels).toContain("P7");
    expect(new Set(cells.map((c) => c.frame)).size).toBe(cells.length);
  });

  it("ignores phases outside the trim", () => {
    // Narrowing the trim after a run leaves phases pointing off the ends.
    const cells = filmstripFrames(100, 160, phases(12, 96, 150), 9);
    const labels = cells.filter((c) => c.label).map((c) => c.label);
    expect(labels).toEqual(["P7"]);
    expect(cells.every((c) => c.frame >= 100 && c.frame <= 160)).toBe(true);
  });

  it("never asks for more cells than the trim has frames", () => {
    const cells = filmstripFrames(10, 13, null, 9);
    expect(cells.map((c) => c.frame)).toEqual([10, 11, 12, 13]);
  });

  it("handles a degenerate trim without throwing", () => {
    expect(filmstripFrames(10, 10, null, 9)).toEqual([{ frame: 10 }]);
    expect(filmstripFrames(10, 5, null, 9)).toEqual([]);
    expect(filmstripFrames(0, 100, null, 0)).toEqual([]);
  });
});
