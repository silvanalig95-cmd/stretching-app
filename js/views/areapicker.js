// The muscle picker shared by Today and Settings: general areas always, specific ones (lower abs, psoas, knees...)
// on demand, grouped by body region. A specific area that is currently selected is always shown.

import { h } from '../dom.js';
import { AREAS, GROUPS, parentOf } from '../lexicon.js';
import { bodyMap } from './bodymap.js';

/**
 * @param {{modeOf:(id:string)=>string|undefined, makeChip:(area:object, mode:string|undefined)=>Node, showSpecific:boolean, onToggle:()=>void, skipWhole?:boolean, onPick?:(id:string)=>void}} o
 *   onPick: when given, a closed "pick on a body map" is offered too (it does what a chip tap does)
 */
export function areaPicker({ modeOf, makeChip, showSpecific, onToggle, skipWhole = false, onPick = null }) {
  const visible = (a) => (skipWhole ? a.id !== 'full_body' : true) && (!parentOf(a.id) || showSpecific || !!modeOf(a.id));
  const hiddenSelected = AREAS.filter((a) => parentOf(a.id) && modeOf(a.id)).length;
  const toggle = h('button', {
    type: 'button', class: 'btn small ghost', id: 'toggle-specific', 'aria-pressed': showSpecific, onclick: onToggle,
    title: 'Lower abs, side abs, psoas, piriformis, knees, shins, ankles and more',
  }, showSpecific ? '− Hide specific muscles' : `＋ Specific muscles (lower abs, psoas, knees…)${hiddenSelected ? ` · ${hiddenSelected} selected` : ''}`);
  const groups = h('div', { class: 'groups' }, GROUPS.map((g) => {
    const items = AREAS.filter((a) => a.group === g.id && visible(a));
    if (!items.length) return null;
    return h('fieldset', { class: 'group' }, h('legend', null, g.label),
      h('div', { class: 'chips' }, items.map((a) => makeChip(a, modeOf(a.id)))));
  }));
  return { toggle, groups, map: onPick ? bodyMap({ modeOf, onPick }) : null };
}
