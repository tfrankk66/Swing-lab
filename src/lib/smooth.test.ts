import { describe, expect, it } from "vitest";
import { smoothSeries } from "./smooth";

const all = (n: number) => new Array<boolean>(n).fill(true);

describe("smoothSeries", () => {
  it("removes a single-frame spike", () => {
    const values = [1, 1, 9, 1, 1];
    expect(smoothSeries(values, all(5), 2)).toEqual([1, 1, 1, 1, 1]);
  });

  it("leaves a clean series alone", () => {
    const values = [1, 2, 3, 4, 5];
    expect(smoothSeries(values, all(5), 2)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps a rounded peak within a frame of where it was", () => {
    // The top of the backswing is not an instant: the hands decelerate, pause
    // and reverse over several frames. The median flattens the very top of
    // such a peak, so its argmax can tie between two neighbouring frames —
    // which is the same frame of ambiguity the pause itself has. What must not
    // happen is the peak sliding somewhere else entirely.
    const values = [0, 2, 5, 8, 9, 10, 9, 8, 5, 2, 0];
    const out = smoothSeries(values, all(11), 2);
    let peak = 0;
    for (let i = 1; i < out.length; i++) {
      if ((out[i] ?? 0) > (out[peak] ?? 0)) peak = i;
    }
    expect(Math.abs(peak - 5)).toBeLessThanOrEqual(1);
  });

  it("removes a one-frame peak, which is the whole point", () => {
    // A median cannot tell a real single-frame excursion from a bad detection,
    // and at 240fps nothing in a golf swing happens in one frame. Anything
    // that narrow is the model having a bad frame, so it goes.
    const values = [0, 0, 0, 10, 0, 0, 0];
    expect(smoothSeries(values, all(7), 2)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("leaves the first and last frames exactly as found", () => {
    // Address is frame zero and P1 detection reads it.
    const values = [7, 1, 1, 1, 8];
    const out = smoothSeries(values, all(5), 2);
    expect(out[0]).toBe(7);
    expect(out[4]).toBe(8);
  });

  it("does not invent positions for absent frames", () => {
    const values = [1, 1, 999, 1, 1];
    const present = [true, true, false, true, true];
    const out = smoothSeries(values, present, 2);
    // The absent frame keeps whatever was there; the track's `found` flag is
    // what decides it is not drawn.
    expect(out[2]).toBe(999);
  });

  it("ignores absent neighbours when smoothing present frames", () => {
    const values = [5, 5, 999, 5, 5];
    const present = [true, true, false, true, true];
    const out = smoothSeries(values, present, 2);
    expect(out[0]).toBe(5);
    expect(out[1]).toBe(5);
    expect(out[3]).toBe(5);
    expect(out[4]).toBe(5);
  });

  it("survives a series with nothing present", () => {
    const values = [3, 4, 5];
    const present = [false, false, false];
    expect(smoothSeries(values, present, 2)).toEqual([3, 4, 5]);
  });

  it("handles the ends without running off the array", () => {
    const values = [9, 1, 1, 1, 9];
    const out = smoothSeries(values, all(5), 2);
    expect(out).toHaveLength(5);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("returns the input unchanged at radius zero", () => {
    const values = [1, 9, 1];
    expect(smoothSeries(values, all(3), 0)).toEqual([1, 9, 1]);
  });
});
