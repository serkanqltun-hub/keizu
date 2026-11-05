import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/400-italic.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { PublicView, viewToken } from './ui/PublicView';

// A read-only share link (…/#view=<token>) opens just that map, no library.
const token = viewToken();

createRoot(document.getElementById('root')!).render(
  <StrictMode>{token ? <PublicView token={token} /> : <App />}</StrictMode>,
);
