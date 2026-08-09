import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const dir = import.meta.dirname;

/**
 * Two scenes, two entries.
 *
 * Each entry is a tiny gate (a few hundred bytes) that dynamically imports its
 * own scene chunk when the reader nears the section. React and three.js end up
 * in a shared chunk, so a visitor who sees both pages downloads them once.
 *
 * Filenames are stable — no content hashes — because the site is plain files on
 * GitHub Pages; the HTML busts cache with a ?v= query instead.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(dir, '../assets/scenes'),
    emptyOutDir: true,
    target: 'es2020',
    minify: 'terser',
    sourcemap: false,
    cssCodeSplit: true,
    // The scene chunks are dynamically imported; preload hints only resolve
    // against the wrong base here and 404. Nothing to gain, so turn them off.
    modulePreload: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        pmhc: resolve(dir, 'src/main.jsx'),
        tts: resolve(dir, 'src/tts/ttsMain.jsx'),
      },
      output: {
        format: 'es',
        // Entries keep stable names because the HTML references them and
        // busts cache with ?v=. Lazy chunks are content-hashed: they are
        // fetched by dynamic import, so a fixed name means a browser that
        // cached a broken build keeps serving it.
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name].[ext]',
        // Without this the shared chunk gets named after whichever module
        // happened to be first into it.
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
