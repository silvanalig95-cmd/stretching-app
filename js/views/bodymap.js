// An optional way to pick muscles: a simple body, front and back, where you tap a region instead of finding its chip.
// It is closed by default and does exactly what the chips do (tap once = tight, twice = weak, third = off).
// The figure is a schematic of where things are, not an anatomical drawing.

import { h, svgEl } from '../dom.js';
import { AREAS, AREA_BY_ID } from '../lexicon.js';

const svg = svgEl;

// A region is one or more shapes; [tag, attributes]. `sided` draws the left one and its mirror image on the right.
const path = (d) => ['path', { d }];
const ell = (cx, cy, rx, ry) => ['ellipse', { cx, cy, rx, ry }];
const MIRROR = 'translate(200 0) scale(-1 1)';
const sided = (shape) => [shape, [shape[0], { ...shape[1], transform: MIRROR }]];

/** Front and back: [area id, label, shapes]. Only the general areas appear; a specific one (lower abs, psoas) sits under its general one. */
export const BODY_ZONES = {
  front: [
    ['neck', 'Neck', [path('M89 52 L111 52 L113 74 Q100 84 87 74 Z')]],
    ['shoulders', 'Shoulders', sided(path('M44 101 Q46 86 64 83 Q77 83 81 93 Q66 97 55 113 Z'))],
    ['chest', 'Chest', sided(path('M81 97 Q92 93 99 99 L99 128 Q84 134 71 127 Q68 108 81 97 Z'))],
    ['arms', 'Arms', sided(path('M46 114 L54 126 L47 173 L35 169 Z'))],
    ['wrists', 'Wrists & forearms', sided(path('M34 176 L47 179 L41 246 L26 243 Z'))],
    ['core', 'Core', [path('M72 133 Q100 143 128 133 L126 196 Q100 206 74 196 Z')]],
    ['outer_hip', 'Outer hip & IT band', sided(path('M62 198 L70 202 L69 254 L63 250 Q60 224 62 198 Z'))],
    ['hip_flexors', 'Hip flexors', sided(path('M75 201 Q90 207 98 226 L90 234 Q75 226 69 211 Z'))],
    ['adductors', 'Inner thighs & groin', sided(path('M91 238 L98.5 238 L98.5 302 L91 298 Z'))],
    ['quads', 'Quads', sided(path('M71 208 Q85 214 90 234 L90 306 L69 306 Q66 252 71 208 Z'))],
    ['knees', 'Knees', sided(ell(80, 318, 12, 10))],
    ['calves', 'Calves & shins', sided(path('M70 332 L90 332 L92 398 L73 398 Z'))],
    ['feet', 'Feet & ankles', sided(ell(83, 411, 15, 8))],
  ],
  back: [
    ['neck', 'Neck', [path('M89 52 L111 52 L113 74 Q100 84 87 74 Z')]],
    ['shoulders', 'Shoulders', sided(path('M44 101 Q46 86 64 83 Q77 83 81 93 Q66 97 55 113 Z'))],
    ['upper_back', 'Upper back & posture', [path('M80 96 Q100 90 120 96 L118 134 Q100 140 82 134 Z')]],
    ['lats', 'Lats & side body', sided(path('M72 110 L80 138 L80 170 Q66 166 62 146 Q62 124 72 110 Z'))],
    ['arms', 'Arms', sided(path('M46 114 L54 126 L47 173 L35 169 Z'))],
    ['wrists', 'Wrists & forearms', sided(path('M34 176 L47 179 L41 246 L26 243 Z'))],
    ['lower_back', 'Lower back', [path('M82 142 Q100 148 118 142 L118 190 Q100 196 82 190 Z')]],
    ['glutes', 'Glutes & piriformis', sided(path('M72 196 Q86 190 99 198 L99 232 Q84 240 70 228 Q66 210 72 196 Z'))],
    ['outer_hip', 'Outer hip & IT band', sided(path('M62 198 L70 202 L69 254 L63 250 Q60 224 62 198 Z'))],
    ['hamstrings', 'Hamstrings', sided(path('M71 238 Q85 240 99 238 L99 306 L69 306 Q66 270 71 238 Z'))],
    ['knees', 'Knees', sided(ell(80, 318, 12, 10))],
    ['calves', 'Calves & shins', sided(path('M70 332 L90 332 L92 398 L73 398 Z'))],
    ['feet', 'Feet & ankles', sided(ell(83, 411, 15, 8))],
  ],
};
const SPINE = [path('M97.5 56 L102.5 56 L102.5 192 L97.5 192 Z')];   // back view: a thin strip down the middle, "spine mobility"

// The silhouette behind the regions, so it reads as a person: the left half, and the same mirrored.
const HALF = 'M100 50 L89 50 Q88 70 68 79 Q48 83 43 102 L34 168 L24 235 Q22 250 32 250 L42 248 L47 178 L54 126 Q62 156 63 196 Q60 222 63 252 L66 318 L69 402 Q62 424 76 424 L99 424 L99 318 L99 240 L100 230 Z';
const figure = () => svg('g', { class: 'bm-body', 'aria-hidden': 'true' },
  svg('circle', { cx: 100, cy: 27, r: 22 }), svg('path', { d: HALF }), svg('path', { d: HALF, transform: MIRROR }));

let mapOpen = false;   // stays open while you pick, even though the page around it is redrawn

/**
 * @param {{modeOf:(id:string)=>string|undefined, onPick:(id:string)=>void}} o
 * @returns {HTMLElement} a closed <details>
 */
export function bodyMap({ modeOf, onPick }) {
  const zoneState = (id) => {
    const own = modeOf(id);
    if (own) return own;
    const child = AREAS.some((a) => a.parent === id && modeOf(a.id));   // a specific part of it is selected
    return child ? 'part' : '';
  };
  const zone = (id, label, shapes, extraClass = '') => {
    const st = zoneState(id);
    const word = st === 'weak' ? 'weak spot' : st === 'tight' ? 'tight spot' : st === 'part' ? 'a specific part is selected' : 'not selected';
    return svg('g', { class: `bm-zone ${st}${extraClass}`, 'data-area': id, role: 'button', tabindex: 0, 'aria-label': `${label}: ${word}`, 'aria-pressed': st === 'tight' || st === 'weak' ? 'true' : 'false' },
      svg('title', {}, `${label} (${word})`),
      shapes.map(([tag, a]) => svg(tag, a)));
  };
  const view = (side, title) => {
    const zones = BODY_ZONES[side].filter(([id]) => AREA_BY_ID[id]);
    const root = svg('svg', { viewBox: '0 0 200 430', class: `bm-svg ${side}`, role: 'group', 'aria-label': `${title} view of the body` },
      figure(),
      zones.map(([id, label, shapes]) => zone(id, label, shapes)),
      side === 'back' && AREA_BY_ID.spine ? zone('spine', 'Spine mobility', SPINE, ' bm-spine') : null);
    const activate = (e) => {
      const g = e.target.closest('.bm-zone');
      if (!g) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onPick(g.dataset.area);
    };
    root.addEventListener('click', activate);
    root.addEventListener('keydown', activate);
    return h('figure', { class: 'bm-fig' }, root, h('figcaption', null, title));
  };
  const details = h('details', { class: 'bodymap', id: 'bodymap', open: mapOpen, ontoggle: () => { mapOpen = details.open; } },
    h('summary', null, 'Or pick on a body map'),
    h('p', { class: 'hint' }, 'Tap a region: once for tight (stretch), twice for weak (strengthen), a third time to clear it. It does the same as the chips above.'),
    h('div', { class: 'bm-views' }, view('front', 'Front'), view('back', 'Back')));
  return details;
}
