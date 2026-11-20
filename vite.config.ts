import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { viteSingleFile } from 'vite-plugin-singlefile'

// build normale: PWA installabile. build "sim": un solo file HTML con dati e percorsi simulati (anteprima).
export default defineConfig(({ mode }) => ({
  // GitHub Pages serve l'app in una sottocartella: BASE_PATH la indica (es. /shotgun/)
  base: process.env.BASE_PATH || '/',
  plugins: [
    react(),
    ...(mode === 'sim'
      ? [viteSingleFile()]
      : [VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['icon.svg'],
          manifest: {
            name: 'Shotgun', short_name: 'Shotgun', lang: 'it',
            description: 'Chilometri, turni di guida e pedaggi tra amici',
            theme_color: '#16171A', background_color: '#16171A',
            display: 'standalone', start_url: '.', scope: '.',
            icons: [
              { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
              { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: { navigateFallback: 'index.html', globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], importScripts: ['push-sw.js'] },
        })]),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}))
