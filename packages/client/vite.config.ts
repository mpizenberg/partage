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
      manifest: {
        name: 'Partage - Bill Splitting',
        short_name: 'Partage',
        description: 'Fully encrypted, local-first bill-splitting application',
        theme_color: '#000000',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB to accommodate Loro WASM
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\./,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 300,
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
      '/api': {
        target: 'http://127.0.0.1:8090', // PocketBase on HTTP
        changeOrigin: true,
        secure: false,
      },
      '/_/': {
        target: 'http://127.0.0.1:8090', // PocketBase realtime endpoint
        changeOrigin: true,
        secure: false,
        ws: true, // WebSocket support for real-time subscriptions
      },
    },
  },
});
