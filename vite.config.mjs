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
    allowedHosts: ['jobs.home.arpa'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        // Preserve the browser host and Origin so JobFinder can enforce the configured
        // canonical URL when Vite is used behind a local reverse proxy.
        changeOrigin: false,
      },
    },
  },
});
