import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

// Tauri expects a fixed port and doesn't need the dev server to clear the screen.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2021', sourcemap: true },
  // The server has its own tests (node --test, see server/).
  test: { environment: 'node', exclude: [...configDefaults.exclude, 'server/**'] },
});
