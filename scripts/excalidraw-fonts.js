import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The drawing canvas (Excalidraw) loads its hand-drawn fonts from
// <base>excalidraw/fonts/. Ship them with the app so drawing works offline.
// The Chinese/Japanese fallback font (Xiaolai, ~200 files) is left out.
const FONT_DIR = 'node_modules/@excalidraw/excalidraw/dist/prod/fonts';
const FONT_FAMILIES = ['Excalifont', 'Nunito', 'Lilita', 'ComicShanns', 'Virgil', 'Liberation', 'Cascadia', 'Assistant'];
/** @returns {import('vite').Plugin} */
export function excalidrawFonts() {
  const files = () =>
    FONT_FAMILIES.flatMap((f) => (existsSync(join(FONT_DIR, f)) ? readdirSync(join(FONT_DIR, f)).map((n) => `${f}/${n}`) : []));
  return {
    name: 'keizu-excalidraw-fonts',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/excalidraw\/fonts\/([A-Za-z]+\/[\w.-]+\.woff2)$/);
        if (!m || !FONT_FAMILIES.includes(m[1].split('/')[0]) || !existsSync(join(FONT_DIR, m[1]))) return next();
        res.setHeader('Content-Type', 'font/woff2');
        createReadStream(join(FONT_DIR, m[1])).pipe(res);
      });
    },
    generateBundle() {
      for (const f of files()) this.emitFile({ type: 'asset', fileName: `excalidraw/fonts/${f}`, source: readFileSync(join(FONT_DIR, f)) });
    },
  };
}

