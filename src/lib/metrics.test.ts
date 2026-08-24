import { describe, expect, it } from "vitest";
import { computeMetrics, formatMetric, tally, type Metric } from "./metrics";
import type { SwingPhases } from "./phases";
import { LM } from "./pose";
import { IMAGE_STRIDE, WORLD_STRIDE, type SwingTrack } from "./track";

/**
 * Poses are written in *pixels* of a 1080x1920 portrait clip and divided down
 * on the way into the track, rather than written as normalised coordinates.
 *
 * That is deliberate. Normalised coordinates hide the aspect ratio, so a test
 * written in them cannot tell a correct angle from one that has been stretched
 * by 1.78 — which is exactly the bug `geom.ts` exists to prevent. Stating the
 * pose in pixels means the geometry in the test is the geometry a person would
 * measure off the screen with a protractor.
 */
const W = 1080;
const H = 1920;

type Pose = Record<number, [number, number]>;

/** A textbook down-the-line address, laid out to hit the middle of every band. */
function addressPose(): Pose {
  const hips: [number, number] = [540, 1150];
  // 35 degrees of forward bend over a 420px torso.
  const lean = (35 * Math.PI) / 180;
  const shoulders: [number, number] = [
    540 + 420 * Math.sin(lean),
    1150 - 420 * Math.cos(lean),
  ];
  return {
    [LM.nose]: [shoulders[0] - 20, shoulders[1] - 110],
    [LM.leftShoulder]: shoulders,
    [LM.rightShoulder]: shoulders,
    [LM.leftHip]: hips,
    [LM.rightHip]: hips,
    // Offset in x to put about 163 degrees in the knee — flexed, not locked.
    [LM.leftKnee]: [580, 1430],
    [LM.rightKnee]: [580, 1430],
    [LM.leftAnkle]: [540, 1700],
    [LM.rightAnkle]: [540, 1700],
    // Hands hanging just about under the shoulders.
    [LM.leftWrist]: [shoulders[0] - 11, 1120],
    [LM.rightWrist]: [shoulders[0] - 11, 1120],
  };
}

/** Top of the backswing: hands up and back on a 50-degree plane. */
function topPose(): Pose {
  const pose = addressPose();
  const [hx, hy] = pose[LM.leftWrist] as [number, number];
  const rise = 300 * Math.tan((50 * Math.PI) / 180);
  const top: [number, number] = [hx - 300, hy - rise];
  return { ...pose, [LM.leftWrist]: top, [LM.rightWrist]: top };
}

const PHASES: SwingPhases = { p1: 10, p4: 100, p7: 130, confident: true };

function buildTrack(
  poses: Record<number, Pose>,
  {
    visibility = 0.9,
    videoWidth = W,
    videoHeight = H,
  }: { visibility?: number; videoWidth?: number; videoHeight?: number } = {},
): SwingTrack {
  const count = 160;
  const image = new Float32Array(count * IMAGE_STRIDE);
  const world = new Float32Array(count * WORLD_STRIDE);
  const found = new Uint8Array(count).fill(1);
  const fallback = addressPose();

  for (let i = 0; i < count; i++) {
    const pose = poses[i] ?? fallback;
    for (const [key, value] of Object.entries(pose)) {
      const [px, py] = value as [number, number];
      const at = i * IMAGE_STRIDE + Number(key) * 4;
      image[at] = px / W;
      image[at + 1] = py / H;
      image[at + 2] = 0;
      image[at + 3] = visibility;
    }
  }

  return {
    fps: 60,
    startFrame: 0,
    count,
    videoWidth,
    videoHeight,
    analyzedWidth: videoWidth,
    analyzedHeight: videoHeight,
    image,
    world,
    found,
    quality: "full",
    delegate: "GPU",
    elapsedMs: 0,
    seekMs: 0,
    detectMs: 0,
  };
}

/** The swing everything else is a deviation from: address held, hands to the top. */
function textbook(overrides: Record<number, Pose> = {}): SwingTrack {
  return buildTrack({
    [PHASES.p1]: addressPose(),
    [PHASES.p4]: topPose(),
    [PHASES.p7]: addressPose(),
    ...overrides,
  });
}

const by = (metrics: Metric[], id: string): Metric => {
  const found = metrics.find((m) => m.id === id);
  if (!found) throw new Error(`no metric ${id}`);
  return found;
};

describe("computeMetrics", () => {
  it("always returns the same nine rows in the same order", () => {
    // A list that changes shape with what the model saw cannot be compared
    // against last week's, which is the whole point of v0.6.
    const full = computeMetrics(textbook(), PHASES);
    const empty = computeMetrics(null, null);
    expect(full).toHaveLength(9);
    expect(empty).toHaveLength(9);
    expect(empty.map((m) => m.id)).toEqual(full.map((m) => m.id));
  });

  it("gives a textbook swing nine green lights", () => {
    const metrics = computeMetrics(textbook(), PHASES);
    const counts = tally(metrics);
    expect(
      counts,
      metrics.map((m) => `${m.id}=${formatMetric(m)} ${m.verdict}`).join("\n"),
    ).toEqual({ good: 9, watch: 0, crit: 0, unknown: 0 });
  });

  it("measures the angles it was posed with", () => {
    const metrics = computeMetrics(textbook(), PHASES);
    expect(by(metrics, "spine-tilt").value).toBeCloseTo(35, 0);
    expect(by(metrics, "hand-plane").value).toBeCloseTo(50, 0);
    // 90 frames of backswing against 30 of downswing.
    expect(by(metrics, "tempo").value).toBeCloseTo(3, 5);
  });

  it("reads the same numbers whatever shape the frame is", () => {
    // Same pose in pixels, described by two different clips. If the aspect
    // ratio leaks into the answer, these diverge.
    const portrait = computeMetrics(textbook(), PHASES);
    const landscape = computeMetrics(
      buildTrack(
        {
          [PHASES.p1]: addressPose(),
          [PHASES.p4]: topPose(),
          [PHASES.p7]: addressPose(),
        },
        { videoWidth: W, videoHeight: H },
      ),
      PHASES,
    );
    for (const metric of portrait) {
      expect(by(landscape, metric.id).value).toBeCloseTo(metric.value ?? 0, 6);
    }
  });

  it("catches hips that pushed toward the ball", () => {
    const impact = addressPose();
    const [hx, hy] = impact[LM.leftHip] as [number, number];
    // 10% of stature is a bad case of early extension by any standard.
    impact[LM.leftHip] = [hx + 95, hy];
    impact[LM.rightHip] = [hx + 95, hy];

    const metrics = computeMetrics(textbook({ [PHASES.p7]: impact }), PHASES);
    expect(by(metrics, "early-extension").verdict).toBe("crit");
    expect(by(metrics, "early-extension").value).toBeGreaterThan(7);
  });

  it("catches a golfer standing up out of the shot", () => {
    const impact = addressPose();
    const hips = impact[LM.leftHip] as [number, number];
    // Same torso length, twelve degrees more upright.
    const lean = (23 * Math.PI) / 180;
    const shoulders: [number, number] = [
      hips[0] + 420 * Math.sin(lean),
      hips[1] - 420 * Math.cos(lean),
    ];
    impact[LM.leftShoulder] = shoulders;
    impact[LM.rightShoulder] = shoulders;

    const metrics = computeMetrics(textbook({ [PHASES.p7]: impact }), PHASES);
    expect(by(metrics, "posture-loss").value).toBeCloseTo(12, 0);
    expect(by(metrics, "posture-loss").verdict).toBe("crit");
  });

  it("separates sway from lift", () => {
    const impact = addressPose();
    const [nx, ny] = impact[LM.nose] as [number, number];
    impact[LM.nose] = [nx, ny - 90]; // straight up, no sideways movement

    const metrics = computeMetrics(textbook({ [PHASES.p7]: impact }), PHASES);
    expect(by(metrics, "head-sway").value).toBeCloseTo(0, 6);
    expect(by(metrics, "head-lift").value).toBeGreaterThan(6);
    expect(by(metrics, "head-lift").verdict).toBe("crit");
  });

  it("refuses to measure landmarks the model was unsure of", () => {
    // Below the visibility floor nothing is read, rather than read faintly.
    const metrics = computeMetrics(
      buildTrack(
        {
          [PHASES.p1]: addressPose(),
          [PHASES.p4]: topPose(),
          [PHASES.p7]: addressPose(),
        },
        { visibility: 0.2 },
      ),
      PHASES,
    );
    const geometric = metrics.filter((m) => m.id !== "tempo");
    expect(geometric.every((m) => m.value === null)).toBe(true);
    expect(geometric.every((m) => m.verdict === "unknown")).toBe(true);
    // Tempo is counted in frames, so it survives a body the model cannot see.
    expect(by(metrics, "tempo").value).toBeCloseTo(3, 5);
  });

  it("reads nothing off phases it does not believe in", () => {
    const metrics = computeMetrics(textbook(), { ...PHASES, confident: false });
    expect(metrics.every((m) => m.verdict === "unknown")).toBe(true);
    expect(tally(metrics).unknown).toBe(9);
  });

  it("falls back to the torso when the feet are cropped out", () => {
    const cropped = addressPose();
    delete cropped[LM.leftAnkle];
    delete cropped[LM.rightAnkle];
    const track = buildTrack({
      [PHASES.p1]: cropped,
      [PHASES.p4]: topPose(),
      [PHASES.p7]: cropped,
    });
    // Ankles are absent from every frame's pose, so nothing wrote them and
    // they sit at the origin with zero visibility — which `at` refuses.
    const metrics = computeMetrics(track, PHASES);
    // Angles do not need a stature at all.
    expect(by(metrics, "spine-tilt").value).toBeCloseTo(35, 0);
    // Displacements do, and get one from the torso rather than giving up.
    expect(by(metrics, "early-extension").value).not.toBeNull();
  });
});

describe("formatMetric", () => {
  it("prints an em dash rather than a number it does not have", () => {
    const metrics = computeMetrics(null, null);
    expect(formatMetric(by(metrics, "spine-tilt"))).toBe("—");
  });

  it("respects the precision each metric asked for", () => {
    const metrics = computeMetrics(textbook(), PHASES);
    expect(formatMetric(by(metrics, "spine-tilt"))).toMatch(/^\d+$/);
    expect(formatMetric(by(metrics, "tempo"))).toMatch(/^\d+\.\d$/);
  });
});
