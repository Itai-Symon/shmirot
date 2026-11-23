/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', lab: 'lab.html' } } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered from src/ui/offline.ts so the app can show whether it is ready offline.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] },
      manifest: {
        name: 'שמירות',
        short_name: 'שמירות',
        description: 'מחלק שמירות הוגן שעובד בלי אינטרנט',
        lang: 'he',
        dir: 'rtl',
        display: 'standalone',
        theme_color: '#1f2a1f',
        background_color: '#ffffff',
        start_url: './',
        scope: './',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
  test: {
    include: process.env.BENCH ? ['bench/**/*.bench.ts'] : ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: process.env.BENCH ? 600_000 : 5_000,
    passWithNoTests: true,
  },
})
