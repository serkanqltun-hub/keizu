/**
 * Excalidraw draws its dark mode by filtering the canvas (invert 93%, then
 * hue-rotate 180°). For topics to keep their dark-theme colours, give it the
 * colour that this filter turns into the one we want.
 */
export function preInvert(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  // hue-rotate(180deg) is its own inverse (CSS filter matrix, cos = -1, sin = 0).
  const h = [
    [0.213 - 0.787, 0.715 + 0.715, 0.072 + 0.072],
    [0.213 + 0.213, 0.715 - 0.285, 0.072 + 0.072],
    [0.213 + 0.213, 0.715 + 0.715, 0.072 - 0.928],
  ];
  rgb = h.map((row) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
  // invert(0.93): c = 0.93 - 0.86 p, so p = (0.93 - c) / 0.86.
  rgb = rgb.map((c) => Math.min(1, Math.max(0, (0.93 - c) / 0.86)));
  return `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}
