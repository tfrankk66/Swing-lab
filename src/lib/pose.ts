import type { PoseLandmarker } from "@mediapipe/tasks-vision";

/**
 * Pose landmarker setup.
 *
 * Everything is served from our own origin rather than MediaPipe's CDN, so the
 * app still works at a range with no signal. `scripts/prepare-assets.mjs` puts
 * the WASM and the weights in place.
 *
 * ## Why the library is imported dynamically
 *
 * `@mediapipe/tasks-vision` is 155KB of the bundle, and none of it is needed
 * to load a clip, scrub it, trim it or read the contact sheet — only to press
 * *Find the body*. A static import puts all of it in the first chunk, which is
 * the one that has to arrive over a bad connection before anything works.
 *
 * The import above is `import type`, so it is erased at build time and costs
 * nothing; the real module is fetched inside `build()`, the first time a
 * landmarker is actually asked for. Nothing downstream changes: `build()` was
 * already async and already behind the "loading model" progress stage, and by
 * the time this fetch happens the app is about to download 15MB of model
 * weights anyway, so one more JS chunk is not what anybody is waiting for.
 */

export type ModelQuality = "lite" | "full";

const MODEL_PATH: Record<ModelQuality, string> = {
  lite: "/models/pose_landmarker_lite.task",
  full: "/models/pose_landmarker_full.task",
};

/** Roughly how long each model takes per frame, for the progress estimate. */
export const MODEL_NOTES: Record<ModelQuality, string> = {
  lite: "Faster, looser on fast-moving limbs. Use it on a phone.",
  full: "Steadier through the downswing. Default on a laptop.",
};

export interface LandmarkerHandle {
  landmarker: PoseLandmarker;
  quality: ModelQuality;
  delegate: "GPU" | "CPU";
  /**
   * The last timestamp this landmarker was given, in its own milliseconds.
   *
   * VIDEO mode keeps tracking state between calls and refuses any timestamp
   * that does not advance past the last one it saw, for the life of the
   * instance. The instance is cached across runs, so the clock has to live
   * with it: a counter that restarted at zero for each run had the second
   * run's every frame rejected ("Packet timestamp mismatch ... expected
   * 900001 but received 1000"), and re-running on a shorter trim came back
   * as a track that was nothing but gaps.
   */
  clock: number;
}

/** The next timestamp to hand this landmarker. Always strictly increasing. */
export function nextTimestamp(handle: LandmarkerHandle): number {
  handle.clock += 1;
  return handle.clock;
}

let cached: LandmarkerHandle | null = null;
let pending: Promise<LandmarkerHandle> | null = null;
let pendingQuality: ModelQuality | null = null;

async function build(quality: ModelQuality): Promise<LandmarkerHandle> {
  // The one place the library is actually fetched. See the note at the top.
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe");

  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: {
      modelAssetPath: MODEL_PATH[quality],
      delegate,
    },
    runningMode: "VIDEO" as const,
    numPoses: 1,
    // The swing spends most of its length with limbs blurred past
    // recognisability. Loose thresholds keep a plausible skeleton on screen
    // through the downswing instead of dropping out for twenty frames; the
    // per-landmark visibility score is what later phases gate on.
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
    outputSegmentationMasks: false,
  });

  try {
    const landmarker = await vision.PoseLandmarker.createFromOptions(
      fileset,
      options("GPU"),
    );
    return { landmarker, quality, delegate: "GPU", clock: 0 };
  } catch {
    // Older mobile Safari and locked-down GPU drivers land here.
    const landmarker = await vision.PoseLandmarker.createFromOptions(
      fileset,
      options("CPU"),
    );
    return { landmarker, quality, delegate: "CPU", clock: 0 };
  }
}

/** Loads the landmarker, reusing the instance unless the model changed. */
export async function getLandmarker(
  quality: ModelQuality,
): Promise<LandmarkerHandle> {
  if (cached?.quality === quality) return cached;
  // An in-flight build for the *same* model is worth waiting on; one for a
  // different model is not, or a re-run after switching quality would quietly
  // get handed back the previous model.
  if (pending && pendingQuality === quality) return pending;

  if (cached) {
    cached.landmarker.close();
    cached = null;
  }

  pendingQuality = quality;
  pending = build(quality).then(
    (handle) => {
      cached = handle;
      pending = null;
      pendingQuality = null;
      return handle;
    },
    (error) => {
      pending = null;
      pendingQuality = null;
      throw error;
    },
  );
  return pending;
}

export function releaseLandmarker(): void {
  cached?.landmarker.close();
  cached = null;
}

/* ------------------------------------------------------------- landmarks -- */

/** BlazePose's 33-point index map. Named so later phases read as geometry. */
export const LM = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const LANDMARK_COUNT = 33;

/** Bones to draw. Face points are landmarked but not connected — the mesh of
 *  eye and mouth lines is noise on a swing. */
export const BONES: ReadonlyArray<readonly [number, number]> = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.leftAnkle, LM.leftHeel],
  [LM.leftHeel, LM.leftFootIndex],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
  [LM.rightAnkle, LM.rightHeel],
  [LM.rightHeel, LM.rightFootIndex],
  [LM.leftWrist, LM.leftIndex],
  [LM.rightWrist, LM.rightIndex],
];

/** Landmarks worth drawing as joints. Keeps the face to a single nose dot. */
export const JOINTS: readonly number[] = [
  LM.nose,
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
];
