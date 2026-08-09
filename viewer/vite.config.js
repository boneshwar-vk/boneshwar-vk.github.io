import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const dir = import.meta.dirname;

/**
 * Builds to stably-named files that the hand-written static pages include
 * directly. No content hashes: the site is plain files on GitHub Pages, so the
 * HTML busts cache with a ?v= query instead.
 *
 * Two outputs by design — a tiny eager entry (pmhc.js + pmhc.css) and a lazy
 * chunk holding React/three, fetched only when the reader nears the section.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(dir, '../assets/pmhc'),
    emptyOutDir: true,
    target: 'es2020',
    minify: 'terser',
    sourcemap: false,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: resolve(dir, 'src/main.jsx'),
      output: {
        format: 'es',
        entryFileNames: 'pmhc.js',
        chunkFileNames: 'pmhc-viewer.js',
        assetFileNames: 'pmhc.[ext]',
      },
    },
  },
});
