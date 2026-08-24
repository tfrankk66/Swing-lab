import { describe, expect, it } from "vitest";
import { tickStep } from "./Timeline";

describe("tickStep", () => {
  it("stays on the 1/2/5 series", () => {
    // Whatever the clip length, the spacing has to be a number you can count
    // in your head — the whole reason for not just dividing by the tick count.
    for (let total = 1; total <= 5000; total += 7) {
      const step = tickStep(total);
      const magnitude = 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5, 10]).toContain(Math.round(step / magnitude));
    }
  });

  it("lands near the requested number of graduations", () => {
    // The 1/2/5 rounding costs some precision, so the bound is loose — but a
    // 500-frame clip must not come back with three ticks or three hundred.
    for (const total of [50, 120, 480, 1200, 4800]) {
      const ticks = total / tickStep(total, 24);
      expect(ticks).toBeGreaterThanOrEqual(9);
      expect(ticks).toBeLessThanOrEqual(50);
    }
  });

  it("never graduates finer than one frame", () => {
    expect(tickStep(4)).toBe(1);
    expect(tickStep(1)).toBe(1);
    expect(tickStep(0)).toBe(1);
    expect(tickStep(-10)).toBe(1);
  });
});
