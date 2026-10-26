# Lull · White Noise

A calm, endless noise generator for sleep. An installable, offline-first PWA built with React, Vite and MUI.

- **Six colours** – white, pink, brown, blue, violet and grey noise, generated procedurally on your device (in a Web Worker) each launch. Each colour is a 20-second stereo loop with a cross-faded seam, wrapped as a WAV and played by an ordinary `<audio>` element. A second element takes over shortly before each loop ends and the two cross-fade, because native looping leaves a ~100 ms gap. With the screen locked a page's timers stop, so that hand-over can't run; the colour you're hearing is therefore also rendered as a 4-minute loop in the background and swapped in, so the unavoidable native wrap happens only every few minutes.
- **Instant switching** – tap a colour, swipe sideways on the main area, or use the lock-screen next/previous controls (arrow keys work on desktop). Colours cross-fade in a quarter of a second.
- **Keeps playing with the screen off** – because it is real media playback, Android and iOS show lock-screen controls (play/pause, next/previous colour) and keep the page alive. Media Session is told the stream is endless so lock screens don't draw a progress bar. It runs until you pause it. (iOS can't set an `<audio>` element's volume, so there the in-app slider is hidden, use the hardware buttons, and colours switch without a cross-fade.)
- **Works offline** – the service worker precaches the app, fonts and loop worker.

## Development

```sh
npm install
npm run dev       # dev server
npm test          # unit tests (spectral checks of each noise colour)
npm run build     # production build in dist/
npm run preview   # serve the production build (needed to test the service worker)
```

Add `?debug` to the URL to show the build id and audio state on screen.


The icons in `public/icons` are rendered from `public/icon.svg` with `npm run icons` (requires Playwright's Chromium to be available).

## Deployment

- **Vercel** – connected to the repo; it builds with the defaults and serves from the domain root.
- **GitHub Pages** – `.github/workflows/deploy.yml` tests, builds and publishes `dist/` on every push to `main`. The build gets its base path from `BASE_PATH` (e.g. `/white-noise/`), so the same code works at a root domain or a subpath. In the repo settings, set **Pages → Source** to **GitHub Actions** once.
- `.github/workflows/ci.yml` runs the tests and a build on pull requests and non-`main` branches.

## Layout

- `src/audio/generators.js` – the noise algorithms (pure, shared by the worker and tests)
- `src/audio/loop.js`, `wav.js`, `loop-worker.js`, `generateLoop.js` – render a colour into a seamless WAV loop off the main thread
- `src/audio/NoiseEngine.js` – the two-element player: cross-fading, loop hand-over, play/pause lifecycle
- `diag.html` / `src/diag.js` – `/diag.html` runs each audio path in isolation to debug a device
- `src/hooks/useNoisePlayer.js` – React state, persistence and Media Session wiring
- `src/components/` – play button, swipeable stage, colour picker
