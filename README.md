# Swing Lab

Down-the-line golf swing analysis that runs entirely in the browser. No upload,
no account, no server holding your video.

**Status: v0.1 — the player.** Frame-accurate playback and trimming. Pose
overlay, measurements, and coaching come in later phases.

## Running it

```bash
npm install
npm run dev
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
  hooks/usePlayhead   Playback position + trim-range enforcement
  components/         Intake, Timeline, CaptureSheet
```

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
| **v0.1** | Player: upload, scrub, frame-step, trim, loop                  |
| v0.2     | MediaPipe pose landmarks, skeleton overlay                     |
| v0.3     | P1/P4/P7 detection, filmstrip, slow-motion factor inference    |
| v0.4     | Nine metrics, plane and butt reference lines, fault thresholds |
| v0.5     | Claude coaching, curated drill library                         |
| v0.6     | IndexedDB history, side-by-side compare, trend lines           |
| v0.7     | Clubhead tracer                                                |
