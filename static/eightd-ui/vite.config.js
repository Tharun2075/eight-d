import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Forge serves Custom UI from a relative path, so assets must use base './'.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'build', emptyOutDir: true },
});
