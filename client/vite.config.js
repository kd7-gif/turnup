import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': { target: 'http://localhost:5080', changeOrigin: false },
      '/socket.io': { target: 'http://localhost:5080', ws: true },
    },
  },
});
