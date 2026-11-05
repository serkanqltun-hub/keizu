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
  /**
   * Keizu's own look: every topic boxed, main topics filled with their branch
   * colour, deeper topics in a light tint of it with a leading dot, rounded
   * elbow connectors and a node dot on the central topic.
   */
  signature?: boolean;
  /** The node dot on the central topic (signature themes). */
  rootDot?: string;
}

export const THEMES: Theme[] = [
  {
    id: 'imza',
    name: 'İmza',
    dark: false,
    canvas: '#F7F9FC',
    grid: '#D8DCE2',
    centralFill: '#1F2A37',
    centralText: '#FFFFFF',
    text: '#1D232B',
    palette: ['#3446B8', '#0C7D72', '#B0570A', '#B8326F', '#6A3FB5', '#3D7A2E', '#B42D2D', '#0B6F8A'],
    mono: '#3446B8',
    signature: true,
    rootDot: '#7389FF',
  },
  {
    id: 'imzaNight',
    name: 'İmza Gece',
    dark: true,
    canvas: '#1A1E25',
    grid: '#2C333D',
    centralFill: '#232C38',
    centralText: '#FFFFFF',
    text: '#EEF0F4',
    palette: ['#8197FF', '#38C2B4', '#F0A04B', '#EE7AA8', '#B294FF', '#8FD16A', '#FF7B7B', '#5CC8E6'],
    mono: '#8197FF',
    signature: true,
    rootDot: '#8197FF',
  },
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

/** Mixes a colour toward black (light themes) or white (dark themes): text on a branch tint. */
export function deepen(hex: string, dark: boolean, amount = dark ? 0.62 : 0.45): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const target = dark ? 255 : 0;
  const mix = (c: number) => Math.round(c + (target - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The default theme for a new map: İmza, in its dark version on a dark system. */
export function defaultThemeId(prefersDark: boolean): string {
  return prefersDark ? 'imzaNight' : 'imza';
}

export const FILL_SWATCHES = ['#FDEEE6', '#E7F1FA', '#E8F4EB', '#F5EAF8', '#FFF4D6', '#EEF0F3', '#FFFFFF', '#1F2A37'];
