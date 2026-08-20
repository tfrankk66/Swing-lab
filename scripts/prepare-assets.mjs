/**
 * Puts MediaPipe's runtime and models under public/ so everything is served
 * from our own origin.
 *
 * MediaPipe's docs point the fileset resolver at a jsDelivr URL. That would
 * mean the app breaks at a driving range with no signal, which is the main
 * place it will be used, so the WASM is copied out of node_modules and the
 * model weights are fetched once and cached on disk.
 *
 * Idempotent and non-fatal: a failed download leaves a warning, not a broken
 * install.
 */
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSource = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmTarget = join(root, "public", "mediapipe");
const modelDir = join(root, "public", "models");

const MODELS = [
  {
    file: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    bytes: 5_777_746,
  },
  {
    file: "pose_landmarker_full.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    bytes: 9_398_198,
  },
];

/** Size check for files. Directories report size 0 on Windows — use dirExists. */
async function exists(path, minBytes = 1) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size >= minBytes;
  } catch {
    return false;
  }
}

async function dirExists(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function copyWasm() {
  if (!(await dirExists(wasmSource))) {
    console.warn("[assets] @mediapipe/tasks-vision not installed; skipping WASM copy.");
    return;
  }
  await cp(wasmSource, wasmTarget, { recursive: true });
  console.log("[assets] WASM runtime -> public/mediapipe");
}

async function fetchModel({ file, url, bytes }) {
  const target = join(modelDir, file);
  // Allow 10% slack: the hosted weights get re-quantised occasionally.
  if (await exists(target, bytes * 0.9)) {
    console.log(`[assets] ${file} already present`);
    return;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    console.log(`[assets] ${file} downloaded`);
  } catch (error) {
    console.warn(`[assets] could not fetch ${file}: ${error.message}`);
    console.warn(`[assets] download it manually to public/models/ from:\n  ${url}`);
  }
}

await mkdir(modelDir, { recursive: true });
await copyWasm();
for (const model of MODELS) await fetchModel(model);
