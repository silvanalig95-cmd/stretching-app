// How the kind of routine is shown: a small badge on cards, and a way to correct it.

import { h } from '../dom.js';
import { ctx, fixStyle } from '../ctx.js';
import { toast } from '../modal.js';
import { STYLE_LIST } from '../style.js';

/** A badge such as "Yin yoga", with the evidence as its tooltip. Nothing when the app can't tell. */
export function styleBadge(video) {
  const k = video.profile?.kind;
  if (!k) return null;
  const why = k.fixed ? 'You set this.' : `${k.certainty[0].toUpperCase()}${k.certainty.slice(1)} (${Math.round(k.confidence * 100)}%): ${k.evidence.join('; ')}`;
  return h('span', { class: `badge kind${k.fixed ? ' fixed' : k.confidence < 0.45 ? ' unsure' : ''}`, title: why, 'data-kind': k.id }, k.confidence < 0.45 && !k.fixed ? `${k.label}?` : k.label);
}

/** "Not right? Change it": pick what kind of routine it really is, or hand it back to the app. */
export function styleEditor(video, { onChange = () => {} } = {}) {
  const fixed = ctx.state.styleFixes?.[video.id] ?? '';
  const select = h('select', { id: 'style-fix', 'aria-label': 'What kind of routine is this?', onchange: (e) => {
    fixStyle(video.id, e.target.value || null);
    toast(e.target.value ? 'Thanks, I’ll remember that for this video.' : 'Back to my own estimate.', 'info');
    onChange();
  } }, [h('option', { value: '' }, fixed ? 'Let the app decide' : 'Not right? Choose the real kind…'),
    ...STYLE_LIST.map((s) => h('option', { value: s.id, selected: s.id === fixed }, s.name))]);
  return h('label', { class: 'field inline-field style-fix' }, h('span', null, 'Kind of routine'), select);
}
