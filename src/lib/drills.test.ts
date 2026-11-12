import { describe, expect, it } from "vitest";
import {
  DRILLS,
  FAULT_LABEL,
  MAX_PRIORITIES,
  directionOf,
  prescribe,
  severity,
} from "./drills";
import { computeMetrics } from "./metrics";
import { ALL_GREEN, withReadings } from "./metrics.fixture";

describe("the library", () => {
  it("has a drill for every fault the app can label", () => {
    // A fault with a name and no drill is a red light with nothing to do
    // about it — the one thing the coach panel exists to prevent.
    for (const [metric, directions] of Object.entries(FAULT_LABEL)) {
      for (const direction of Object.keys(directions)) {
        const found = DRILLS.some((d) =>
          d.fixes.some((f) => f.metric === metric && f.direction === direction),
        );
        expect(found, `${metric} ${direction}`).toBe(true);
      }
    }
  });

  it("only names metrics and directions that exist", () => {
    const ids = new Set(computeMetrics(null, null).map((m) => m.id));
    for (const drill of DRILLS) {
      for (const fix of drill.fixes) {
        expect(ids.has(fix.metric), `${drill.id} → ${fix.metric}`).toBe(true);
        expect(FAULT_LABEL[fix.metric]?.[fix.direction], `${drill.id} ${fix.direction}`).toBeDefined();
      }
    }
  });

  it("has unique ids", () => {
    expect(new Set(DRILLS.map((d) => d.id)).size).toBe(DRILLS.length);
  });
});

describe("direction and severity", () => {
  it("reads which side of the band a value fell on", () => {
    const [tilt] = withReadings({ "spine-tilt": 50 });
    expect(directionOf(tilt!)).toBe("high");
    const [tall] = withReadings({ "spine-tilt": 20 });
    expect(directionOf(tall!)).toBe("low");
    const [fine] = withReadings({ "spine-tilt": 35 });
    expect(directionOf(fine!)).toBeNull();
  });

  it("puts the edge of amber at 1, so red is past it", () => {
    // spine-tilt good 28–42, watch 22–48: 48 is six past 42 across a six-wide zone.
    const [edge] = withReadings({ "spine-tilt": 48 });
    expect(severity(edge!)).toBeCloseTo(1);
    const [red] = withReadings({ "spine-tilt": 54 });
    expect(severity(red!)).toBeGreaterThan(1);
  });
});

describe("prescribe", () => {
  it("prescribes nothing for a green swing", () => {
    expect(prescribe(withReadings(ALL_GREEN))).toEqual([]);
  });

  it("prescribes nothing for an unread one", () => {
    expect(prescribe(computeMetrics(null, null))).toEqual([]);
  });

  it("ranks the worst first and stops at the cap", () => {
    const rx = prescribe(
      withReadings({
        ...ALL_GREEN,
        "early-extension": 12, // far into red
        "head-sway": 4, // just amber
        "spine-tilt": 47, // amber, near the edge
        tempo: 1.5, // red, rushed
      }),
    );
    expect(rx).toHaveLength(MAX_PRIORITIES);
    expect(rx[0]?.metric.id).toBe("early-extension");
    expect(rx.map((p) => p.metric.id)).not.toContain("head-sway");
  });

  it("chooses drills for the direction, not just the metric", () => {
    const flat = prescribe(withReadings({ ...ALL_GREEN, "hand-plane": 30 }));
    expect(flat[0]?.label).toBe("Backswing too flat");
    expect(flat[0]?.drills.map((d) => d.id)).toContain("wall-takeaway");
    expect(flat[0]?.drills.map((d) => d.id)).not.toContain("trail-elbow-down");

    const steep = prescribe(withReadings({ ...ALL_GREEN, "hand-plane": 70 }));
    expect(steep[0]?.drills.map((d) => d.id)).toContain("trail-elbow-down");
    expect(steep[0]?.drills.map((d) => d.id)).not.toContain("wall-takeaway");
  });

  it("does not hand the same drill to two faults when another exists", () => {
    // Both can use crossed-arm turns, and each has another drill to fall
    // back on, so neither should get the one the other already has.
    const rx = prescribe(
      withReadings({ ...ALL_GREEN, "early-extension": 10, "head-lift": 10 }),
    );
    const first = rx[0]!.drills.map((d) => d.id);
    const second = rx[1]!.drills.map((d) => d.id);
    expect(first.filter((id) => second.includes(id))).toEqual([]);
  });
});
