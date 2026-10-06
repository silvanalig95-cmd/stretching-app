// What the page shows while it waits (shimmering outlines instead of a blank space) and when there is nothing yet
// (a small picture and a next step instead of a bare sentence).

import { h, svgEl as svg } from '../dom.js';

const sk = (cls = '') => h('span', { class: `sk ${cls}`, 'aria-hidden': 'true' });

/** The outline of the video card while a routine is being looked for. */
export function skeletonFeatured(message) {
  return h('div', { class: 'card busy', 'aria-busy': 'true', role: 'status' },
    sk('sk-player'),
    h('div', { class: 'info' }, sk('sk-line w70'), sk('sk-line w40'), h('div', { class: 'sk-row' }, sk('sk-pill'), sk('sk-pill'), sk('sk-pill')),
      h('p', { class: 'busy-text' }, message)));
}

/** n outlines of video tiles. */
export function skeletonGrid(n = 4) {
  return h('div', { class: 'grid', 'aria-hidden': 'true' }, Array.from({ length: n }, () => h('div', { class: 'vcard sk-card' }, sk('sk-thumb'), sk('sk-line w80'), sk('sk-line w50'))));
}

/** The outline of an analysis report while it is being read. */
export function skeletonReport(message) {
  return h('div', { class: 'analysis skeleton-report', 'aria-busy': 'true', role: 'status' },
    h('div', { class: 'a-head' }, sk('sk-thumb a'), h('div', { class: 'sk-col' }, sk('sk-line w70'), sk('sk-line w40'))),
    sk('sk-line w90'), sk('sk-line w60'), sk('sk-bar'), sk('sk-bar'), sk('sk-bar'),
    message ? h('p', { class: 'busy-text' }, message) : null);
}

// ---------------------------------------------------------------- empty states

const ART = {
  // a rolled-up mat: "start your collection"
  mat: () => [
    svg('rect', { x: 18, y: 44, width: 84, height: 24, rx: 12, class: 'ea-fill' }),
    svg('circle', { cx: 30, cy: 56, r: 12, class: 'ea-fill ea-line' }), svg('circle', { cx: 30, cy: 56, r: 6, class: 'ea-line' }), svg('circle', { cx: 30, cy: 56, r: 2, class: 'ea-dot' }),
    svg('path', { d: 'M44 46 L44 66 M72 46 L72 66', class: 'ea-line' }),
    svg('path', { d: 'M90 22 v12 M84 28 h12', class: 'ea-spark' }), svg('path', { d: 'M104 36 v8 M100 40 h8', class: 'ea-spark' }), svg('path', { d: 'M18 26 v8 M14 30 h8', class: 'ea-spark' }),
  ],
  // a calendar with one day ticked: "your first routine goes here"
  calendar: () => [
    svg('rect', { x: 30, y: 16, width: 60, height: 58, rx: 9, class: 'ea-fill ea-line' }),
    svg('path', { d: 'M30 32 H90', class: 'ea-line' }), svg('path', { d: 'M44 10 v12 M76 10 v12', class: 'ea-line ea-thick' }),
    [0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => svg('circle', { cx: 42 + c * 12, cy: 44 + r * 10, r: 2, class: 'ea-dot soft' }))),
    svg('circle', { cx: 78, cy: 54, r: 7, class: 'ea-badge' }), svg('path', { d: 'M74.5 54 l2.6 2.8 l5-5.6', class: 'ea-tick' }),
  ],
  // a magnifier over a mat: "nothing found"
  search: () => [
    svg('rect', { x: 14, y: 62, width: 70, height: 14, rx: 7, class: 'ea-fill' }),
    svg('circle', { cx: 56, cy: 38, r: 20, class: 'ea-fill ea-line ea-thick' }), svg('path', { d: 'M71 53 L90 72', class: 'ea-line ea-thick' }),
    svg('path', { d: 'M48 38 H64', class: 'ea-line' }),
  ],
};

/** A small picture (decorative: hidden from screen readers). */
export function emptyArt(kind = 'mat') {
  return svg('svg', { viewBox: '0 0 120 84', class: 'empty-art', 'aria-hidden': 'true', focusable: 'false' }, (ART[kind] ?? ART.mat)());
}

/** A friendly "nothing here yet": a picture, a headline, what to do, and buttons. Keeps `.empty-note` so the page still treats it as one. */
export function emptyBlock({ kind = 'mat', title, body = null, actions = null, id = null }) {
  return h('div', { class: 'empty-note empty-block', id }, emptyArt(kind), h('strong', { class: 'eb-title' }, title), body, actions ? h('div', { class: 'actions' }, actions) : null);
}
