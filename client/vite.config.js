import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser talks only to Vite (port 5173); /api is proxied to Express.
// That keeps everything same-origin, so session cookies and CSRF need no special CORS setup.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:5000', changeOrigin: false } },
  },
});
