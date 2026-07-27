import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Pinned to IPv4: `localhost` resolves to ::1 first on macOS, which the
    // capture script's readiness probe (and Playwright) would miss.
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
});
