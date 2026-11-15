import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' : l'appli est chargée depuis un fichier local (file://) dans Electron
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
