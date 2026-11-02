export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  canvas: string;
  grid: string;
  centralFill: string;
  centralText: string;
  text: string;
  /** Branch colours, used in order for the main topics. */
  palette: string[];
  /** Branch colour when multicolour is off. */
  mono: string;
}

export const THEMES: Theme[] = [
  {
    id: 'fresh',
    name: 'Taze',
    dark: false,
    canvas: '#F4F5F7',
    grid: '#D5D9DF',
    centralFill: '#1F2A37',
    centralText: '#FFFFFF',
    text: '#1D232B',
    palette: ['#E8590C', '#1971C2', '#2B8A3E', '#9C36B5', '#C2255C', '#0B7285', '#E67700', '#5F3DC4'],
    mono: '#4C5FD5',
  },
  {
    id: 'night',
    name: 'Gece',
    dark: true,
    canvas: '#14181E',
    grid: '#262C35',
    centralFill: '#E6E9EE',
    centralText: '#14181E',
    text: '#E6E9EE',
    palette: ['#FF8A4C', '#4DABF7', '#51CF66', '#CC5DE8', '#F06595', '#3BC9DB', '#FCC419', '#9775FA'],
    mono: '#748FFC',
  },
  {
    id: 'paper',
    name: 'Kâğıt',
    dark: false,
    canvas: '#FBF8F1',
    grid: '#E8E1D0',
    centralFill: '#7A4E2D',
    centralText: '#FFFDF8',
    text: '#2D241C',
    palette: ['#B5562B', '#3A6EA5', '#5B7F3A', '#8A4F7D', '#A23B3B', '#2F7A78', '#B07D1A', '#5A5A8C'],
    mono: '#7A4E2D',
  },
  {
    id: 'mono',
    name: 'Sade',
    dark: false,
    canvas: '#FFFFFF',
    grid: '#E9ECEF',
    centralFill: '#111111',
    centralText: '#FFFFFF',
    text: '#111111',
    palette: ['#333333', '#555555', '#333333', '#555555'],
    mono: '#333333',
  },
];

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** A light tint of a branch colour for main-topic fills. */
export function tint(hex: string, dark: boolean, amount = dark ? 0.22 : 0.12): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const base = dark ? 20 : 255;
  const mix = (c: number) => Math.round(base + (c - base) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export const FILL_SWATCHES = ['#FDEEE6', '#E7F1FA', '#E8F4EB', '#F5EAF8', '#FFF4D6', '#EEF0F3', '#FFFFFF', '#1F2A37'];
