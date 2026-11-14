import { defineConfig } from 'vite';
// Static build into docs/ (GitHub Pages from main /docs). Relative base so it works under /ParisGuessr3JS/.
export default defineConfig({
  base: './',
  build: { outDir: 'docs', emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
});
