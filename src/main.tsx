import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/400-italic.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles/app.css';
import './ui/motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { PublicView, viewToken } from './ui/PublicView';

// The drawing canvas loads its fonts from the app itself (see vite.config.ts), never a CDN.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL(`${import.meta.env.BASE_URL}excalidraw/`, location.href).href;

// No browser / webview context menu (Back, Reload, Inspect…): Keizu shows
// its own on the map. Text fields keep the native one for copy, paste and
// spelling.
document.addEventListener('contextmenu', (e) => {
  const el = e.target as Element | null;
  if (el?.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"], a[href]')) return;
  e.preventDefault();
});

// A read-only share link (…/#view=<token>) opens just that map, no library.
const token = viewToken();

createRoot(document.getElementById('root')!).render(
  <StrictMode>{token ? <PublicView token={token} /> : <App />}</StrictMode>,
);
