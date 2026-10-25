import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Vercel serves from the domain root; GitHub Pages serves from /<repo>/, which
// the deploy workflow supplies through BASE_PATH.
const base = process.env.BASE_PATH ?? '/'

// Identifies the running build (shown with ?debug) so it's clear which deploy a device has.
const buildId = (process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)

export default defineConfig({
  base,
  build: { rollupOptions: { input: { main: 'index.html', diag: 'diag.html' } } },
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
      workbox: {
        // Everything the app needs, including the audio worklet, is precached.
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,ico,webmanifest}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/diag\.html$/],
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Lull · White Noise',
        short_name: 'Lull',
        description: 'A calm, endless white noise generator that works offline.',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0d0f12',
        theme_color: '#0d0f12',
        categories: ['health', 'lifestyle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: { include: ['test/**/*.test.js'] },
})
