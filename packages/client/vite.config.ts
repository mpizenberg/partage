import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import wasm from 'vite-plugin-wasm';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
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
});
