import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ preprocess: vitePreprocess() })],
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
