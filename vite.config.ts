import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same build works on the web and inside a Tauri webview.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
  },
});
