import type { ReactNode } from 'react';
import { KEI_PATH, TAG_HEIGHT, TAG_PATH, WORD_PATH, WORD_WIDTH } from './brandPaths';

function Svg({ size = 18, children, dash }: { size?: number; children: ReactNode; dash?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dash ? '3 2.5' : undefined}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

/** App mark: the kanji 系 (kei, "lineage") with an indigo node. Colors come from --logo-* in app.css. */
export const Logo = ({ size = 28 }: P) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo-svg">
    <rect width="64" height="64" rx="15" fill="var(--logo-bg)" />
    <path fill="#fff" d={KEI_PATH} />
    <circle cx="51" cy="50.5" r="3.8" fill="var(--logo-dot)" />
  </svg>
);

/** Wordmark: "keizu" with a vertical ケイズ tag. Height in px; width follows. */
export const Wordmark = ({ size = 22 }: P) => {
  const w = WORD_WIDTH + 22;
  return (
    <svg height={size} width={(size * w) / 52} viewBox={`0 0 ${w} 52`} role="img" aria-label="keizu">
      <path fill="currentColor" d={WORD_PATH} />
      <g transform={`translate(${WORD_WIDTH + 8} 4)`}>
        <rect width="14" height={TAG_HEIGHT} rx="3.5" fill="var(--logo-tag)" />
        <path fill="var(--logo-tag-ink)" d={TAG_PATH} />
      </g>
    </svg>
  );
};
export const Menu = (p: P) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;
export const Undo = (p: P) => <Svg {...p}><path d="M9 6L4 11l5 5" /><path d="M4 11h10a5 5 0 0 1 0 10h-2" /></Svg>;
export const Redo = (p: P) => <Svg {...p}><path d="M15 6l5 5-5 5" /><path d="M20 11H10a5 5 0 0 0 0 10h2" /></Svg>;
export const TopicIcon = (p: P) => <Svg {...p}><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M12 9v6M9 12h6" /></Svg>;
export const SubtopicIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="9" width="7" height="6" rx="2" />
    <rect x="15" y="4" width="7" height="5" rx="2" />
    <rect x="15" y="15" width="7" height="5" rx="2" />
    <path d="M9 12h3v-5.5h3M12 12v5.5h3" />
  </Svg>
);
export const MarkerIcon = (p: P) => <Svg {...p}><path d="M5 21V4h11l-2 4 2 4H5" /></Svg>;
export const NoteIcon = (p: P) => <Svg {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M9 11h7M9 15h7" /></Svg>;
export const Trash = (p: P) => <Svg {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Svg>;
export const Export = (p: P) => <Svg {...p}><path d="M12 15V3M8 7l4-4 4 4" /><path d="M5 13v7h14v-7" /></Svg>;
export const Panel = (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></Svg>;
export const Minus = (p: P) => <Svg {...p}><path d="M5 12h14" /></Svg>;
export const Plus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const Target = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /></Svg>;
export const Collapse = (p: P) => <Svg {...p}><path d="M8 10l4-4 4 4M8 14l4 4 4-4" /></Svg>;
export const Search = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></Svg>;
export const Import = (p: P) => <Svg {...p}><path d="M12 3v12M8 11l4 4 4-4" /><path d="M5 13v7h14v-7" /></Svg>;
export const Check = (p: P) => <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
export const Keyboard = (p: P) => <Svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></Svg>;
export const RelationIcon = (p: P) => <Svg {...p}><path d="M4 19C4 8 20 16 20 5" /><path d="M16.5 4.5L20 5l.5 3.5" /></Svg>;
export const FloatingIcon = (p: P) => <Svg {...p}><rect x="3" y="4" width="9" height="6" rx="2" /><rect x="12" y="14" width="9" height="6" rx="2" strokeDasharray="2.5 2" /></Svg>;
export const Save = (p: P) => <Svg {...p}><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></Svg>;
export const ImageIcon = (p: P) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 18l5-5 4 4 3-3 4 4" /></Svg>;
export const History = (p: P) => <Svg {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" /><path d="M4 4v4.5h4.5M12 8v4.5l3 2" /></Svg>;
