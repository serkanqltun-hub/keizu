import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

// Tauri expects a fixed port and doesn't need the dev server to clear the screen.
// KEIZU_BASE sets the path the web app is served under (GitHub Pages: /keizu/).
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, '.', 'KEIZU_').KEIZU_BASE || '/',
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2021', sourcemap: true },
  // The server has its own tests (node --test, see server/).
  test: { environment: 'node', exclude: [...configDefaults.exclude, 'server/**'] },
}));
