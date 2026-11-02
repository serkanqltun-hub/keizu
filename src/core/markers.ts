// Marker catalogue. A marker id is "<group>-<value>"; a topic holds at most
// one marker per group.

export interface MarkerDef {
  id: string;
  group: 'priority' | 'task' | 'flag' | 'symbol';
  label: string;
}

export const MARKERS: MarkerDef[] = [
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `priority-${n}`, group: 'priority' as const, label: `Öncelik ${n}` })),
  { id: 'task-0', group: 'task', label: 'Başlanmadı' },
  { id: 'task-25', group: 'task', label: '%25' },
  { id: 'task-50', group: 'task', label: '%50' },
  { id: 'task-75', group: 'task', label: '%75' },
  { id: 'task-100', group: 'task', label: 'Tamamlandı' },
  { id: 'flag-red', group: 'flag', label: 'Kırmızı bayrak' },
  { id: 'flag-blue', group: 'flag', label: 'Mavi bayrak' },
  { id: 'flag-green', group: 'flag', label: 'Yeşil bayrak' },
  { id: 'symbol-star', group: 'symbol', label: 'Yıldız' },
  { id: 'symbol-question', group: 'symbol', label: 'Soru' },
  { id: 'symbol-idea', group: 'symbol', label: 'Fikir' },
];

export const PRIORITY_COLORS = ['#E03131', '#E8590C', '#F08C00', '#1971C2', '#5C7CFA'];
export const FLAG_COLORS: Record<string, string> = { red: '#E03131', blue: '#1971C2', green: '#2B8A3E' };

export const MARKER_SIZE = 18;
export const MARKER_GAP = 4;
