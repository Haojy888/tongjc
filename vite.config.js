import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/analyze': 'http://127.0.0.1:8765',
      '/frameworks': 'http://127.0.0.1:8765',
      '/search': 'http://127.0.0.1:8765',
      '/api-config': 'http://127.0.0.1:8765'
    }
  }
});
