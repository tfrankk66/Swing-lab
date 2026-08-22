import { describe, expect, it } from "vitest";
import { nextBudgetMs, rateForBudget } from "./analysis";

/**
 * The streaming pass is a control loop: play as fast as the model can consume
 * frames, and no faster, because every frame it outruns costs a seek to
 * recover. These two functions are that loop.
 */
describe("rateForBudget", () => {
  it("presents one frame per budget", () => {
    // 30fps source, 33ms per frame allowed — real time.
    expect(rateForBudget(30, 1000 / 30)).toBeCloseTo(1, 5);
    // Twice the budget, half the speed.
    expect(rateForBudget(30, 2000 / 30)).toBeCloseTo(0.5, 5);
  });

  it("slows a high-rate clip far below real time", () => {
    // 240fps at 25ms a frame is where a slow-motion clip actually lands.
    expect(rateForBudget(240, 25)).toBeCloseTo(1000 / 240 / 25, 5);
    expect(rateForBudget(240, 25)).toBeLessThan(0.2);
  });

  it("clamps to what a browser will play", () => {
    // Chrome stops playing below 1/16 speed, so asking for less is pointless.
    expect(rateForBudget(240, 4000)).toBe(0.0625);
    expect(rateForBudget(24, 1)).toBe(4);
  });

  it("falls back to real time on a nonsense frame rate", () => {
    expect(rateForBudget(0, 25)).toBe(1);
    expect(rateForBudget(Number.NaN, 25)).toBe(1);
    expect(rateForBudget(30, 0)).toBe(1);
  });
});

describe("nextBudgetMs", () => {
  it("backs off after missing frames", () => {
    expect(nextBudgetMs(50, 20, 3)).toBeCloseTo(65, 5);
  });

  it("backs off even when the model is fast", () => {
    // A fast model is not evidence we can keep up — the decoder may be the
    // one falling behind, and missed frames are the only signal either way.
    expect(nextBudgetMs(100, 5, 1)).toBeCloseTo(130, 5);
  });

  it("creeps back down over a clean stretch", () => {
    const first = nextBudgetMs(100, 20, 0);
    expect(first).toBeCloseTo(90, 5);
    expect(nextBudgetMs(first, 20, 0)).toBeLessThan(first);
  });

  it("never creeps below the cost of a model call", () => {
    // 40ms per detect: settling at 30ms would miss every other frame.
    let budget = 200;
    for (let i = 0; i < 100; i++) budget = nextBudgetMs(budget, 40, 0);
    expect(budget).toBeCloseTo(52, 5);
  });

  it("never asks for more than a 60Hz display can present", () => {
    let budget = 100;
    for (let i = 0; i < 100; i++) budget = nextBudgetMs(budget, 0.1, 0);
    expect(budget).toBe(16);
  });

  it("caps the backoff so a bad clip still finishes", () => {
    let budget = 100;
    for (let i = 0; i < 100; i++) budget = nextBudgetMs(budget, 20, 5);
    expect(budget).toBe(400);
  });
});
