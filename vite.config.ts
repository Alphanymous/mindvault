import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Relative base so the same build works on a web host, inside Electron and inside Capacitor.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs}'],
        // The OCR engine is ~12 MB: fetch it on first use instead of on every install.
        globIgnores: ['ocr/**'],
        runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.includes('/ocr/'), handler: 'CacheFirst', options: { cacheName: 'ocr-engine' } }],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: 'Mindvault',
        short_name: 'Mindvault',
        description: 'Your second brain: capture, auto-organise and connect everything you save.',
        theme_color: '#060a12',
        background_color: '#060a12',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        share_target: {
          action: './',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1500 },
  // Keep the watcher off build output so packaging (rename of release/win-unpacked) is never blocked on Windows.
  server: { watch: { ignored: ['**/release/**', '**/android/**', '**/dist/**'] } },
})
