// The enter/exit animation of inner maps. Going in, the camera dives toward
// the topic, the topic's box grows until it is the whole canvas, and the
// inner map unfolds out of the spot where the topic was. Going out plays the
// same in reverse. The old view is a frozen copy of the canvas (a "ghost"),
// so the real canvas can already show the new map underneath.

import { reducedMotion } from './motion';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EASE = 'cubic-bezier(.2,.8,.2,1)';
const EASE_IN_OUT = 'cubic-bezier(.65,0,.35,1)';
/** How far the camera dives into the topic. */
const DIVE = 2.6;

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** A frozen copy of the canvas, laid over it. Remove it when done. */
export function ghostOf(canvas: HTMLElement): HTMLElement {
  const g = canvas.cloneNode(true) as HTMLElement;
  g.classList.add('inner-ghost');
  g.removeAttribute('id');
  g.setAttribute('aria-hidden', 'true');
  g.querySelectorAll('textarea, input, button').forEach((n) => n.remove());
  canvas.parentElement?.appendChild(g);
  return g;
}

function portalAt(area: HTMLElement): HTMLElement {
  const p = document.createElement('div');
  p.className = 'inner-portal';
  area.appendChild(p);
  return p;
}

function run(el: HTMLElement, frames: Keyframe[], ms: number, easing: string, delay = 0): Promise<unknown> {
  if (typeof el.animate !== 'function') return Promise.resolve();
  return el.animate(frames, { duration: ms, easing, delay, fill: 'both' }).finished.catch(() => {});
}

function rectFrame(b: Box, extra: Keyframe = {}): Keyframe {
  return { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, ...extra };
}

function grow(b: Box): Box {
  return { x: b.x - 30, y: b.y - 14, w: b.w + 60, h: b.h + 28 };
}

interface Common {
  /** The real canvas, already showing the map we go to. */
  live: HTMLElement;
  /** Frozen copy of the map we leave. */
  ghost: HTMLElement;
  /** The topic's box colour and corner radius. */
  fill: string;
  radius: number;
  canvasColor: string;
}

function finish(live: HTMLElement, ghost: HTMLElement, portal?: HTMLElement) {
  ghost.remove();
  portal?.remove();
  live.getAnimations?.().forEach((a) => a.cancel());
  live.style.zIndex = '';
}

/**
 * Going in. `from`: the topic on the outer map. `to`: the same topic as the
 * main topic of its inner map. Both in canvas pixels.
 */
export async function playEnter(o: Common & { from: Box; to: Box }) {
  const { live, ghost } = o;
  const area = live.parentElement!;
  if (reducedMotion()) {
    await run(ghost, [{ opacity: 1 }, { opacity: 0 }], 120, 'linear');
    return finish(live, ghost);
  }
  const full: Box = { x: 0, y: 0, w: area.clientWidth, h: area.clientHeight };
  const c = centre(o.from), r = centre(o.to);
  const portal = portalAt(area);
  ghost.style.transformOrigin = `${c.x}px ${c.y}px`;
  live.style.transformOrigin = `${r.x}px ${r.y}px`;
  live.style.zIndex = '3';
  const radius = `${o.radius}px`;
  await Promise.all([
    run(ghost, [
      { transform: 'scale(1)', opacity: 1, filter: 'blur(0px)' },
      { transform: `scale(${DIVE})`, opacity: 0, filter: 'blur(2px)' },
    ], 460, EASE_IN_OUT),
    run(portal, [
      rectFrame(o.from, { background: o.fill, borderRadius: radius, opacity: 1 }),
      rectFrame(grow(o.from), { background: o.fill, borderRadius: '14px', opacity: 1, offset: 0.28 }),
      rectFrame(full, { background: o.canvasColor, borderRadius: '0px', opacity: 1, offset: 0.85 }),
      rectFrame(full, { background: o.canvasColor, borderRadius: '0px', opacity: 0 }),
    ], 560, EASE_IN_OUT),
    run(live, [
      { transform: `translate(${c.x - r.x}px, ${c.y - r.y}px) scale(.3)`, opacity: 0 },
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
    ], 420, EASE, 200),
  ]);
  finish(live, ghost, portal);
}

/**
 * Going out. `from`: the inner map's main topic (on the ghost). `to`: the
 * topic on the outer map, now on the live canvas.
 */
export async function playExit(o: Common & { from: Box; to: Box }) {
  const { live, ghost } = o;
  const area = live.parentElement!;
  if (reducedMotion()) {
    await run(ghost, [{ opacity: 1 }, { opacity: 0 }], 120, 'linear');
    return finish(live, ghost);
  }
  const full: Box = { x: 0, y: 0, w: area.clientWidth, h: area.clientHeight };
  const c = centre(o.to), r = centre(o.from);
  const portal = portalAt(area);
  ghost.style.transformOrigin = `${r.x}px ${r.y}px`;
  live.style.transformOrigin = `${c.x}px ${c.y}px`;
  const radius = `${o.radius}px`;
  await Promise.all([
    run(ghost, [
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
      { transform: `translate(${c.x - r.x}px, ${c.y - r.y}px) scale(.3)`, opacity: 0 },
    ], 340, EASE_IN_OUT),
    run(portal, [
      rectFrame(full, { background: o.canvasColor, borderRadius: '0px', opacity: 0 }),
      rectFrame(full, { background: o.canvasColor, borderRadius: '0px', opacity: 1, offset: 0.15 }),
      rectFrame(grow(o.to), { background: o.fill, borderRadius: '14px', opacity: 1, offset: 0.75 }),
      rectFrame(o.to, { background: o.fill, borderRadius: radius, opacity: 1 }),
    ], 540, EASE_IN_OUT),
    run(live, [
      { transform: `scale(${DIVE})`, opacity: 0, filter: 'blur(2px)' },
      { transform: 'scale(1)', opacity: 1, filter: 'blur(0px)' },
    ], 480, EASE, 120),
  ]);
  finish(live, ghost, portal);
}
