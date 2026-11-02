import type { Measure } from '../core/layout';

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

/** Measures text with the browser's real font metrics (cached). */
export const canvasMeasure: Measure = (text, font) => {
  const key = font + '|' + text;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * 8;
  ctx.font = font;
  const w = ctx.measureText(text).width;
  cache.set(key, w);
  return w;
};

/** Call after web fonts finish loading so widths are re-measured. */
export function clearMeasureCache() {
  cache.clear();
}
