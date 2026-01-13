import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import wasm from 'vite-plugin-wasm';
import path from 'path';
import { fileURLToPath } from 'url';
import basicSsl from '@vitejs/plugin-basic-ssl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    basicSsl(),
    solid(),
    wasm(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'icon-maskable.svg'],
      manifest: {
        name: 'Partage - Bill Splitting',
        short_name: 'Partage',
        description: 'Fully encrypted, local-first bill-splitting application for trusted groups',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'en',
        categories: ['finance', 'utilities'],
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Add Expense',
            short_name: 'Expense',
            description: 'Add a new expense to your group',
            url: '/?action=add-expense',
          },
          {
            name: 'View Balance',
            short_name: 'Balance',
            description: 'View your current balance',
            url: '/?tab=balance',
          },
        ],
      },
      injectManifest: {
        injectionPoint: undefined,
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,json}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB to accommodate Loro WASM
        // Skip waiting and claim clients immediately for updates
        skipWaiting: true,
        clientsClaim: true,
        // Navigation fallback for SPA
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/pb/, /^\/api/],
        // Import custom service worker code
        importScripts: ['sw-custom.js'],
        runtimeCaching: [
          {
            // Cache PocketBase API responses
            urlPattern: /^https?:\/\/.*\/pb\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 5, // 5 minutes
              },
              networkTimeoutSeconds: 10,
            },
          },
          {
            // Cache Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          {
            // Cache Google Fonts webfonts
            urlPattern: /^https:\/\/fonts\.gstatic\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@partage/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
    exclude: ['loro-crdt'],
  },
  build: {
    target: 'esnext',
  },
  server: {
    host: '0.0.0.0',
    // host: true, // equivalent to --host
    port: 5173,
    https: true,
    proxy: {
      // requires the following in .env: VITE_POCKETBASE_URL=/pb
      '/pb': {
        target: 'http://127.0.0.1:8090', // PocketBase realtime endpoint
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pb/, ''),
        secure: false,
        ws: true, // WebSocket support for real-time subscriptions
      },
    },
  },
});
