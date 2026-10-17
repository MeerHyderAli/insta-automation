import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The dev server proxies `/api`, `/r` and `/webhooks` to the Express service so
 * the browser only ever talks to one origin. In production the API is served
 * from `VITE_API_BASE_URL` (or a reverse proxy on the same origin).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Sandbox preview domains (https://<port>-<id>.e2b.app) plus localhost.
    // This affects the dev server only; production is static hosting/CDN.
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/r': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
  },
});
