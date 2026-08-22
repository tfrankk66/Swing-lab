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
  lib/analysis.ts     Streaming + fill detection pass over a frame range
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

`analyzeRange` builds a `SwingTrack` of 33 landmarks per frame in both
normalised image space and hip-centred world space. It runs in two passes.

The **streaming pass** plays the clip and takes frames from
`requestVideoFrameCallback` — the decoder's linear path, one decode per frame
in stored order, with no seek and no pipeline flush. Playback is slowed to a
rate the model can keep up with, and re-tuned every 100ms from the measured
cost of a model call.

The **fill pass** then seeks to whatever the streaming pass missed, and that is
what makes streaming safe to use at all. The objection to playing a clip
through is that it silently thins the sample, and finding impact within a frame
or two depends on having every frame. But a frame the streaming pass skipped is
simply one it never marked settled, and the fill pass seeks to every unsettled
frame before the track is returned. Nothing is inferred about *why* a frame was
skipped — a dropped presentation and a frame rate that overshoots the clip's
real one are indistinguishable from the callback, and both want the same
answer. The result is gapless either way, and the panel reports the split
between streamed and seeked back for.

Seeking to every frame is what v0.2 did, and on a long clip it is brutal: a
seek flushes the decode pipeline, so the per-frame cost is dominated by
re-decoding from the last keyframe rather than by the model. The fill pass
still pays that price, but only for the frames it has to.

The cost that no decode path gets past is the model itself. One call is tens
of milliseconds, so a range of ten thousand frames takes minutes whatever we
do about seeking. Trim to the swing — it is about 1.5 seconds — and the panel
warns when the range is long enough that the trim is clearly still around the
whole clip.

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
