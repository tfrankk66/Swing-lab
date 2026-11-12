import { computeMetrics, type Metric } from "./metrics";

/**
 * The nine rows with chosen readings, judged by the bands in metrics.ts.
 *
 * Built from computeMetrics' own rows so the bands under test are the real
 * ones; a copy of them here would pass while the app drifted. Test-only — it
 * lives outside any `.test.ts` so importing it does not drag a second copy of
 * someone else's suite along with it.
 */
export function withReadings(readings: Record<string, number>): Metric[] {
  return computeMetrics(null, null).map((row) => {
    const value = readings[row.id];
    if (value === undefined) return row;
    const verdict =
      value >= row.good[0] && value <= row.good[1]
        ? "good"
        : value >= row.watch[0] && value <= row.watch[1]
          ? "watch"
          : "crit";
    return { ...row, value, verdict };
  });
}

/** Every reading inside its good band. */
export const ALL_GREEN: Record<string, number> = {
  "spine-tilt": 35,
  "posture-loss": 2,
  "early-extension": 1,
  "head-sway": 1,
  "head-lift": 1,
  "knee-flex": 160,
  "arm-hang": 3,
  "hand-plane": 50,
  tempo: 3,
};
