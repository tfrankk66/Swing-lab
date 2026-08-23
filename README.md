# Swing Lab

Down-the-line golf swing analysis that runs entirely in the browser. No upload,
no account, no server holding your video.

**Status: v0.2 — pose overlay.** Frame-accurate playback, trimming, and a
skeleton tracked across the trimmed swing. Measurements and coaching come in
later phases.

## Running it

```bash
npm install   # also fetches ~15MB of model weights, see below
npm run dev
npm test
```

Open http://localhost:5173 on the laptop, or the printed Network URL on your
phone (same Wi-Fi). It installs as a PWA from the browser's share sheet.

Dependencies are pinned to Vite 6 so this runs on Node 20.13; Vite 7+ needs
Node 20.19 or newer.

## Filming

The measurements assume a specific setup, and they degrade quietly if you
change it:

- **Down-the-line.** Phone behind the ball on the target line, lens at hand
  height.
- **240fps slow motion.** At 30fps a 100mph clubhead covers about 1.5 metres
  between frames, so impact never lands on one. At 240fps it is 18cm.
- **Same spot every session.** Trend lines across sessions compare camera
  positions as much as swings.
- **Plain background, fitted shirt.** Pose detection degrades on baggy clothes
  and busy backgrounds more than on anything else you can control.

## Controls

| Input                 | Action                |
| --------------------- | --------------------- |
| Drag across the video | Step frames (8px = 1) |
| Space                 | Play / pause          |
| ← →                   | One frame             |
| Shift + ← →           | Ten frames            |
| I / O                 | Set trim in / out     |
| L                     | Toggle loop           |

## Layout

```
src/
  lib/fps.ts          Frame-rate measurement (see note below)
  lib/frames.ts       Frame <-> time maths, impact-resolution helpers
  lib/pose.ts         MediaPipe setup, BlazePose landmark map, bones
  lib/analysis.ts     Seek-and-detect pass over a frame range, and its cap
  lib/track.ts        SwingTrack storage + accessors (what v0.4 reads)
  lib/draw.ts         Skeleton rendering
  hooks/usePlayhead   Playback position + trim-range enforcement
  hooks/usePoseTrack  Analysis lifecycle: progress, cancel, errors
  components/         Intake, Timeline, CaptureSheet, Overlay, AnalyzePanel
scripts/
  prepare-assets.mjs  Copies MediaPipe WASM + downloads model weights
```

## Assets

`scripts/prepare-assets.mjs` runs on `postinstall`, `dev` and `build`. It
copies MediaPipe's WASM runtime out of `node_modules` into `public/mediapipe`
and downloads the pose weights into `public/models`. Both are gitignored and
reproducible.

Everything is served from our own origin rather than MediaPipe's CDN, because
the app is meant to work at a range with no signal. A failed download warns
rather than breaking the install; re-run `npm run assets` when back online.

## Pose detection

`analyzeRange` seeks to each frame in the trimmed range and runs the
landmarker, building a `SwingTrack` of 33 landmarks per frame in both
normalised image space and hip-centred world space.

Seeking is slower than playing the clip through with
`requestVideoFrameCallback`, and that is the deliberate trade. Playing only
ever hands over frames the compositor managed to present, so a slow detection
pass silently thins the sample — and finding impact within a frame or two
depends on actually having every frame.

### Streaming was tried, and measured, and reverted

The obvious fix for seek cost is to play the clip and take frames from
`requestVideoFrameCallback`, seeking afterwards only for the frames playback
missed. That is gapless — a frame playback skipped is one never marked
settled, and the fill pass goes back for it — so the determinism objection is
answerable.

It still lost, by a factor of about 1.5 on a real 60fps clip: 46s against 30s
for the same 121-frame range. The reason is structural. `detectForVideo` is
synchronous main-thread work of around 70ms, and the clip keeps presenting
frames throughout it. Slowing playback until frames arrive no faster than the
model consumes them does avoid the misses, but it buys that by spending the
same wall-clock time waiting instead — and any miss is a seek at several times
the price. Two failures showed up along the way, both instructive: the first
`detectForVideo` of a session pays for model warm-up and took 4.8 seconds, in
which the clip played past the entire range; and a rate controller that backed
off faster than it recovered settled on its own floor and stayed there.

Streaming only pays once detection stops blocking presentation, which means
the model in a worker with `OffscreenCanvas`, or buffering frames during
playback and detecting them in chunks. Until then, seeking every frame is
both simpler and faster.

The cost no decode path gets past is the model itself. One call is tens of
milliseconds, so a long range takes minutes whatever we do about seeking.
Analysis is therefore capped at `MAX_ANALYSIS_SECONDS` of clip; past that the
panel refuses the run and offers to narrow the trim to a window around the
playhead instead.

Low-confidence bones are drawn dashed rather than hidden. Through the
downswing the trail arm is a blur and the model's confidence collapses;
dropping those bones makes the overlay strobe, and showing uncertainty is
better than hiding it. Frames where no pose was found draw nothing, and the
panel reports the gap count.

### The frame-rate problem

No browser API reports a video's frame rate. `requestVideoFrameCallback` gives
us the `mediaTime` of each presented frame, but it fires at the _display_
refresh rate — so a 240fps clip played at 1x on a 60Hz screen presents every
fourth frame and measures as 60fps.

`detectFrameRate` samples quickly at 1x, and if the answer lands suspiciously
close to the measured display refresh rate, re-samples at 0.15x where every
frame gets its own callback. Only frame pairs where `presentedFrames` advanced
by exactly one are counted, so dropped frames contribute nothing.

What it **cannot** detect is a slow-motion factor already baked into the file.
A phone that shoots 240fps often writes a 30fps container with the slowdown
rendered in; that file is indistinguishable from genuine 30fps footage to the
browser, and the two are eight times apart in real temporal resolution. Set it
by hand in Capture settings — v0.3 will infer it from the detected swing
length, since a real swing runs about 1.2 seconds from top to impact.

Firefox has no `requestVideoFrameCallback`, so it falls back to an assumed
30fps and relies on the manual override.

## Roadmap

| Version  | Adds                                                          |
| -------- | ------------------------------------------------------------- |
| v0.1     | Player: upload, scrub, frame-step, trim, loop                  |
| **v0.2** | MediaPipe pose landmarks, skeleton overlay                     |
| v0.3     | P1/P4/P7 detection, filmstrip, slow-motion factor inference    |
| v0.4     | Nine metrics, plane and butt reference lines, fault thresholds |
| v0.5     | Claude coaching, curated drill library                         |
| v0.6     | IndexedDB history, side-by-side compare, trend lines           |
| v0.7     | Clubhead tracer                                                |
