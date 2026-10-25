# Lull · White Noise

A calm, endless noise generator for sleep. An installable, offline-first PWA built with React, Vite and MUI.

- **Six colours** – white, pink, brown, blue, violet and grey noise, generated procedurally on your device (in a Web Worker) each launch. Each colour is a 20-second stereo loop whose seam is cross-faded so there is no click or dip, started at a random point each time; the browser's native audio engine plays it, so no JavaScript runs in real time and there is nothing to glitch.
- **Instant switching** – tap a colour, swipe sideways on the main area, or use the lock-screen next/previous controls (arrow keys work on desktop). Colours cross-fade in ~0.2 s.
- **Keeps playing with the screen off** – a silent `<audio>` element plays alongside the noise, so mobile browsers treat the page as media playback: lock-screen controls (play/pause, next/previous colour) appear and the page stays alive. The Audio Session API is set to `playback` for iOS. It runs until you pause it.
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
- `src/audio/loop.js`, `loop-worker.js`, `generateLoop.js` – render a colour into a seamless loop off the main thread
- `src/audio/NoiseEngine.js` – audio graph, cross-fading, keep-alive media element, play/pause lifecycle
- `src/hooks/useNoisePlayer.js` – React state, persistence and Media Session wiring
- `src/components/` – play button, swipeable stage, colour picker
