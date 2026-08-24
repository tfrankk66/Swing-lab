# Swing Lab

Down-the-line golf swing analysis that runs entirely in the browser. No upload,
no account, no server holding your video.

**Status: v0.4 — metrics.** Frame-accurate playback and trimming, a skeleton
tracked across the trimmed swing, address/top/impact found automatically, a
contact sheet of the swing, and nine measurements read at those three
positions with reference lines drawn over the picture.

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
  lib/track.ts        SwingTrack storage + accessors
  lib/smooth.ts       Per-landmark smoothing, so peaks are real peaks
  lib/phases.ts       P1/P4/P7 detection from the hand path
  lib/slowmo.ts       Baked-in slow-motion factor, inferred from the downswing
  lib/filmstrip.ts    Contact-sheet frame choice + off-screen thumbnail capture
  lib/geom.ts         Plane geometry in pixels, not normalised coordinates
  lib/metrics.ts      The nine measurements and their bands
  lib/draw.ts         Skeleton and reference-line rendering
  hooks/usePlayhead   Playback position + trim-range enforcement
  hooks/usePoseTrack  Analysis lifecycle: progress, cancel, errors
  hooks/useFilmstrip  Contact sheet, rebuilt when the trim settles
  theme.ts            The palette, as a Mantine theme
  components/         Intake, Timeline, Transport, Filmstrip, CaptureSheet,
                      Overlay, AnalyzePanel, LogBook
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

## UI

Built on [Mantine](https://mantine.dev) 8. Mantine 9 requires React 19 and
this app is on React 18, so 8 is the current line that fits.

The palette is expressed as a Mantine theme in `theme.ts` rather than as two
blocks of hand-written custom properties. The original five colours were
20BF55 green, 0B4F6C deep teal, 01BAEF cyan, FBFBFF near-white and 757575
grey, with roles rather than a swatch each. Mantine wants ten shades per
colour, so `brand` is one scale running from pale cyan up to the deep teal,
with both palette values landing on it exactly — 01BAEF at shade 4, 0B4F6C at
shade 9. `primaryShade: { light: 9, dark: 4 }` then reproduces the old
light/dark switch in a single line, which is what two `prefers-color-scheme`
blocks used to do by hand.

`signal` is the palette green, kept as its own colour because the playhead and
anything meaning "good" should be the one hue that is neither the teal nor the
cyan the rest of the interface is built from. Amber and red are Mantine's
`yellow` and `red`; the old stylesheet derived them by hand because the
five-colour palette had no way to say "needs watching", which is exactly the
sort of thing a component library exists to stop you hand-rolling.

### What is still hand-written

`styles.css` went from 677 lines to about 250, and what survived is the three
things Mantine has no opinion about:

- **The stage** — a video with a canvas measured onto its rendered box.
- **The timeline** — deliberately not a Mantine `Slider`. A Slider is one
  value on one track; this carries a playhead, two trim handles that share a
  hit area and pick a winner by proximity, phase marks, and graduations.
- **The overlay palette** — the canvas draws on video rather than on the page,
  so it must *not* follow the colour scheme: the footage is the background
  either way, and a skeleton that goes dark-on-dark at night is worse than one
  that is always bone white. `readTheme` reads these back out of CSS at draw
  time so they live in one place rather than two.

Everything else routes through Mantine's own CSS variables, so it follows the
theme and the colour scheme without a second copy of the palette.

### Cost, and the CSS import list

Mantine is not free, and this app installs as a PWA meant to work at a range
with no signal — so what it ships has to arrive over a bad connection once and
then live in a cache.

`main.tsx` therefore imports Mantine's stylesheets **one component at a time**
rather than taking `@mantine/core/styles.css`, which is 234KB and carries every
component in the library.

First load, gzipped, is 127KB against the 110KB it was before Mantine existed
in this project — 17KB for a component library, which is the trade this is
happy with.

|                    | Before Mantine | Naive Mantine | Now        |
| ------------------ | -------------- | ------------- | ---------- |
| CSS                | 15.5 KB        | 208 KB        | **84 KB**  |
| CSS (gzip)         | 3.7 KB         | 31 KB         | **13.7 KB**|
| JS, first load     | 333 KB         | 501 KB        | **357 KB** |
| JS (gzip)          | 107 KB         | 157 KB        | **113 KB** |
| JS, deferred       | —              | —             | 155 KB     |
| Deferred (gzip)    | —              | —             | 46 KB      |

Two changes got it there: the per-component CSS list below, and moving
MediaPipe out of the first chunk (see `pose.ts`) so the 155KB of it arrives
only when detection is first run.

The hazard in importing piecemeal is that it fails silently. Leave out a
component's CSS and nothing throws — Mantine renders it with its hashed class
names intact and no rules behind them, so it looks unstyled, and only in
whichever state puts it on screen. The internal dependencies are the part that
actually bites: `Modal` renders ModalBase, Overlay, Paper, CloseButton and
ScrollArea, and nothing in the import statement says so.

`mantine-css.test.tsx` closes that from the other end. Mantine stamps every
styled element with a hashed class (`m_8d3f4000`) that appears in exactly the
stylesheet defining it, so the test renders every panel, collects the hashes
that reached the DOM, works out which file each comes from, and fails if that
file is not imported. It fails on the reverse too — an import nothing renders —
which is what stops the list creeping back toward the full bundle.

`Loader.css` is deliberately absent: `Button` and `ActionIcon` only render a
loader when given `loading`, and nothing here does. The first `loading` button
added to this app will need it, and will need a test that renders one.

### MediaPipe is loaded on demand

`@mediapipe/tasks-vision` is 155KB and none of it is needed to load a clip,
scrub it, trim it or read the contact sheet — only to press *Find the body*. A
static import puts all of it in the first chunk, which is the one that has to
arrive before anything works at all.

`pose.ts` imports it with `import type` (erased at build time) and fetches the
real module inside `build()`, the first time a landmarker is asked for.
Nothing downstream changed: `build()` was already async and already behind the
"loading model" progress stage, and by the time it runs the app is about to
download 15MB of model weights anyway, so one more JS chunk is not what
anybody is waiting for.

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

A **number** is the opposite case. There is no way to print "38 degrees"
faintly enough that nobody acts on it, so `metrics.ts` refuses a reading whose
landmarks fall below a visibility floor and shows an unread light instead.

### The contact sheet

Nine stills spanning the trimmed swing, with address, top and impact
guaranteed to be among them — the shape a coach flips through on paper rather
than scrubs. Frames are chosen by even spacing, then the three phases are
substituted over whichever even frame sits nearest each of them, which keeps
the row evenly spaced instead of wedging phase cells between close neighbours.

Capture runs on a **second, detached video element** sharing the same object
URL. The player owns its own playhead, and driving it from here would fight
playback and leave the readout parked wherever the last thumbnail landed. The
blob is already in memory, so the extra element costs a decoder and nothing
else. Rebuilds wait 400ms for the trim to settle, because dragging a handle
produces a new range on every pointer move.

### The frame-rate problem

No browser API reports a video's frame rate. `requestVideoFrameCallback` gives
us the `mediaTime` of each presented frame, but it fires at the _display_
refresh rate — so a 240fps clip played at 1x on a 60Hz screen presents every
fourth frame and measures as 60fps.

`detectFrameRate` samples quickly at 1x, and if the answer lands suspiciously
close to the measured display refresh rate, re-samples at 0.15x where every
frame gets its own callback. Only frame pairs where `presentedFrames` advanced
by exactly one are counted, so dropped frames contribute nothing.

Firefox has no `requestVideoFrameCallback`, so it falls back to an assumed
30fps and relies on the manual override.

### Slow motion, and the swing as a clock

What no measurement of the container can detect is a slow-motion factor
already baked into the file. A phone that shoots 240fps often writes a 60fps
container with the slowdown rendered in; that file is indistinguishable from
genuine 60fps footage to the browser, and the two are four times apart in real
temporal resolution.

Since v0.4 this is inferred rather than guessed. A golf **downswing** — top of
the backswing to impact — takes about 0.28 seconds, and it takes about 0.28
seconds for everybody: tour players sit nearer 0.25, amateurs nearer 0.32, and
that spread is far narrower than the 2x steps between the factors we have to
choose between. Measure the downswing in container seconds, divide by what a
downswing actually takes, and the quotient is the factor.

The downswing and not the whole swing, because backswing tempo varies
enormously between golfers while the downswing barely does. And an approximate
answer is enough: the supported factors are 1, 2, 4 and 8, so landing on the
right one only needs the estimate within about 40% of the truth.

It fails safe. A clip whose phases do not look like a swing gets no inference
rather than a confident wrong one, and the three sources of the factor rank —
typed beats measured beats assumed — so re-running detection can never
overwrite a number somebody set by hand. The topbar chip marks which it is:
`~` assumed, `=` measured off the swing, unmarked once a human has said.

> An earlier note here claimed a swing runs "about 1.2 seconds from top to
> impact". That is wrong by a factor of four — 1.2s is roughly address to
> impact for the whole swing. The downswing is a quarter of a second, and the
> inference above depends on the correct figure.

## Measurements

Nine readings, taken at address, the top and impact, listed in `metrics.ts`:
spine tilt, posture loss, early extension, head sway, head lift, knee flex,
arm hang, hand plane, and tempo. Each carries a band, a navigation light, what
a reading outside the band means, and — the part that matters — what that
measurement **cannot** see.

All of it is plane geometry done in **pixels**, never in the normalised 0..1
coordinates the track stores. Normalised coordinates divide x by frame width
and y by frame height, so on a 16:9 clip one unit of x is 1.78 units of y: a
true 45° line reads as 60.7°, and by a different amount again on a phone shot
in portrait. `geom.ts` converts first, which is what `videoWidth` and
`videoHeight` are kept on the track for.

Displacements are reported as a percentage of stature — shoulders to ankles at
address — because pixels mean nothing across clips. The same sway is twice the
pixels if the golfer stood half as far from the phone.

**On the thresholds.** They are not measured norms. There is no public dataset
of BlazePose landmarks on down-the-line swings with tour averages attached,
and inventing the precision of one would be worse than useless. What they are
is coaching consensus converted into landmark terms and set deliberately wide.
A green light means "nothing here is obviously wrong", not a certificate.

### Reference lines

Two, both pinned to address, both drawn in brass over the picture so they read
as added rather than found:

- **Butt line** — a vertical through the hips at address. A coach draws this
  touching the golfer's backside; pose landmarks have no backside, so it runs
  through the hip midpoint instead, a few inches in front. The offset is
  constant for a given setup, which is what matters — early extension still
  shows as the hips crossing the line.
- **Plane line** — through the hands at address and the hands at the top,
  carried to both edges of the frame. This is the **hands'** plane, not the
  shaft's. The club sits ten to fifteen degrees steeper, so the `hand-plane`
  number is not comparable to a shaft-plane reading from a system that tracks
  the club. v0.7 adds the clubhead.

## Roadmap

| Version  | Adds                                                          |
| -------- | ------------------------------------------------------------- |
| v0.1     | Player: upload, scrub, frame-step, trim, loop                  |
| v0.2     | MediaPipe pose landmarks, skeleton overlay                     |
| v0.3     | P1/P4/P7 detection, filmstrip, slow-motion factor inference    |
| **v0.4** | Nine metrics, plane and butt reference lines, fault thresholds |
| v0.5     | Claude coaching, curated drill library                         |
| v0.6     | IndexedDB history, side-by-side compare, trend lines           |
| v0.7     | Clubhead tracer                                                |
