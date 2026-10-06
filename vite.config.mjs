import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        configure: (proxy) => {
          proxy.on('proxyReq', (request) => {
            request.setHeader('origin', 'http://127.0.0.1:3000');
          });
        },
      },
    },
  },
});
