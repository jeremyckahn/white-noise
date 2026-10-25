# Lull · White Noise

A calm, endless noise generator for sleep. An installable, offline-first PWA built with React, Vite and MUI.

- **Six colours** – white, pink, brown, blue, violet and grey noise, synthesised live in an `AudioWorklet`. Nothing is recorded or looped, so it never repeats.
- **Instant switching** – tap a colour, swipe sideways on the main area, or use the lock-screen next/previous controls (arrow keys work on desktop). Colours cross-fade in ~0.2 s.
- **Keeps playing with the screen off** – audio is routed through a media element and the Media Session / Audio Session APIs, so mobile browsers treat it as media playback. It runs until you pause it.
- **Works offline** – the service worker precaches the app, fonts and audio worklet.

## Development

```sh
npm install
npm run dev       # dev server
npm test          # unit tests (spectral checks of each noise colour)
npm run build     # production build in dist/
npm run preview   # serve the production build (needed to test the service worker)
```

The icons in `public/icons` are rendered from `public/icon.svg` with `npm run icons` (requires Playwright's Chromium to be available).

## Layout

- `src/audio/generators.js` – the noise algorithms (pure, shared by the worklet and tests)
- `src/audio/noise-processor.js` – the `AudioWorkletProcessor`
- `src/audio/NoiseEngine.js` – audio graph, cross-fading, play/pause lifecycle
- `src/hooks/useNoisePlayer.js` – React state, persistence and Media Session wiring
- `src/components/` – play button, swipeable stage, colour picker
