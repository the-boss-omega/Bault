import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server + build config for the SPA.
export default defineConfig({
  plugins: [react()],
  // Card photos live in the repo-root assets/ folder, one file per item named by
  // its serial number. Pointing publicDir there serves them at /images/<SERIAL>.jpg
  // in dev and copies them into dist/ on build. Path is relative to this app root.
  publicDir: '../../assets',
  server: {
    port: 5173,
    // Proxy API calls to the NestJS backend during development so the browser
    // talks to one origin (avoids CORS and matches production reverse-proxy setup).
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
