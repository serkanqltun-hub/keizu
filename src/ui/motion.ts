// Motion settings and helpers: the speed tokens of the signature UI, the
// "reduce motion" switch and how the mouse wheel acts on the canvas.

import { useSyncExternalStore } from 'react';

/** Durations in ms; the same values live in app.css as --dur-* variables. */
export const DUR = { instant: 120, smooth: 220, layout: 360, birth: 420 } as const;

export type WheelMode = 'zoom' | 'pan';
export type MotionMode = 'system' | 'full' | 'reduced';

export interface MotionPrefs {
  wheel: WheelMode;
  motion: MotionMode;
}

const KEY = 'kz.motion';
const DEFAULTS: MotionPrefs = { wheel: 'zoom', motion: 'system' };

function load(): MotionPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<MotionPrefs>;
    return {
      wheel: p.wheel === 'pan' ? 'pan' : 'zoom',
      motion: p.motion === 'full' || p.motion === 'reduced' ? p.motion : 'system',
    };
  } catch {
    return DEFAULTS;
  }
}

let prefs: MotionPrefs = typeof localStorage === 'undefined' ? DEFAULTS : load();
const listeners = new Set<() => void>();

function systemReduces(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** True when animations should be skipped (the setting, or the system's choice). */
export function reducedMotion(p: MotionPrefs = prefs): boolean {
  return p.motion === 'reduced' || (p.motion === 'system' && systemReduces());
}

function apply() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('kz-reduce-motion', reducedMotion());
  // "Full" overrides the system setting for the CSS transitions too.
  document.documentElement.classList.toggle('kz-motion-full', prefs.motion === 'full');
}

export function getMotionPrefs(): MotionPrefs {
  return prefs;
}

export function setMotionPrefs(patch: Partial<MotionPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode: kept for this session only */
  }
  apply();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useMotionPrefs(): MotionPrefs {
  return useSyncExternalStore(subscribe, getMotionPrefs, getMotionPrefs);
}

if (typeof window !== 'undefined') {
  apply();
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => {
    apply();
    listeners.forEach((l) => l());
  });
}

/**
 * Guesses whether a wheel event came from a mouse wheel (zoom) or a
 * touchpad (pan). Mouse wheels move in whole notches: line units, or
 * vertical-only steps of 120 "wheelDelta" (about 100 px in Chrome).
 * Touchpads send small, often fractional, two-axis deltas.
 */
export function isMouseWheel(e: { deltaMode: number; deltaX: number; deltaY: number; wheelDeltaY?: number }): boolean {
  if (e.deltaMode !== 0) return true;
  if (e.deltaX !== 0) return false;
  const wd = e.wheelDeltaY;
  if (typeof wd === 'number' && wd !== 0) return Math.abs(wd) >= 120 && wd % 120 === 0;
  return Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY);
}

/** Zoom factor for one wheel event; pinch gestures arrive as Ctrl + small deltas. */
export function wheelZoomFactor(e: { deltaMode: number; deltaY: number; ctrlKey: boolean }): number {
  const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  // One mouse notch (~100 px) zooms by ~20%; pinch is finer.
  const rate = e.ctrlKey && Math.abs(px) < 50 ? 0.01 : 0.0018;
  return Math.exp(-px * rate);
}

/** cubic-bezier(x1, y1, x2, y2) as an easing function of t in [0, 1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Bisection is plenty precise for animation frames.
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 20; i++) {
      t = (lo + hi) / 2;
      if (bx(t) < x) lo = t;
      else hi = t;
    }
    return by(t);
  };
}

/** The standard ease of the signature UI: quick start, soft landing. */
export const easeStandard = cubicBezier(0.2, 0.8, 0.2, 1);
