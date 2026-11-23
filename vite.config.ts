/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'שמירות',
        short_name: 'שמירות',
        description: 'מחלק שמירות הוגן שעובד בלי אינטרנט',
        lang: 'he',
        dir: 'rtl',
        display: 'standalone',
        theme_color: '#1f2a1f',
        background_color: '#ffffff',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
  },
})
