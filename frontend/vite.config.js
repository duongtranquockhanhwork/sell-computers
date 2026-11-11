import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, proxy API and WebSocket traffic to the gateway started by Docker Compose.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
