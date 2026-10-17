// Teachers: a starting list of YouTube yoga, stretching, mobility and Pilates teachers (data/teachers.js), to find people worth trying.
// Each one can be searched on YouTube, have their videos added (with a YouTube key), be marked as a favourite, and be told apart by
// whether a woman or a man teaches. Nothing here is needed by the rest of the app: it is a map, not a gate.

import { h, fill } from '../dom.js';
import { ctx, importInputs } from '../ctx.js';
import { CATALOGUE_DATE } from '../../data/teachers.js';
import { CATALOGUE, FOCUS_LABELS, searchCatalogue, levelText, lengthText, sizeText } from '../catalogue.js';
import { STYLE_LIST, STYLE_BY_ID } from '../style.js';
import { normName } from '../channel.js';
import { voiceFor, voiceBadge, voiceMenu } from './voice.js';
import { favoriteButton } from './favorite.js';
import { toast } from '../modal.js';
import { emptyBlock } from './placeholders.js';
import { aiGate } from './aiblock.js';
import { teacherLink } from './teacherlink.js';
import { suggestTeachers, keepTeacher, dropTeacher } from '../aiwork.js';
import { levelText as lvl } from '../catalogue.js';
import { voiceText as voiceTextOf } from '../teacher.js';

const PAGE = 36;
const youtubeUrl = (t) => (t.handle ? `https://www.youtube.com/${t.handle}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${t.name} yoga stretching`)}`);

export function mountTeachers(root) {
  const { state } = ctx;
  const f = (ctx.ui.teachers ??= { q: '', style: '', voice: '', focus: '', level: '', sort: 'name', show: PAGE });
  const listSlot = h('div', { id: 't-list' });
  const aiSlot = h('div', { id: 't-ai' });
  let searching = false;   // Gemini is looking: the button says so, whatever else is redrawn meanwhile
  const all = () => [...CATALOGUE, ...(state.myTeachers ?? [])];
  const countEl = h('p', { class: 'hint', id: 't-count', 'aria-live': 'polite' });

  const sel = (id, label, opts, key) => h('label', { class: 'field' }, h('span', null, label),
    h('select', { id, onchange: (e) => { f[key] = e.target.value; f.show = PAGE; draw(); } }, opts.map(([v, t]) => h('option', { value: v, selected: f[key] === v }, t))));
  const focusTags = [...new Set(CATALOGUE.flatMap((t) => t.focus ?? []))].filter((x) => FOCUS_LABELS[x]).sort((a, b) => FOCUS_LABELS[a].localeCompare(FOCUS_LABELS[b]));
  const usedStyles = new Set(CATALOGUE.flatMap((t) => t.styles ?? []));
  const search = h('input', { type: 'search', id: 't-q', value: f.q, autocomplete: 'off', spellcheck: 'false', placeholder: 'Search names, styles, what they are good for…', 'aria-label': 'Search teachers',
    oninput: (e) => { f.q = e.target.value; f.show = PAGE; draw(); } });
  const controls = h('div', { class: 'controls' },
    h('label', { class: 'field grow' }, h('span', null, 'Search'), search),
    sel('t-style', 'Style', [['', 'Any'], ...STYLE_LIST.filter((s) => usedStyles.has(s.id)).map((s) => [s.id, s.name])], 'style'),
    sel('t-voice', 'Teacher', [['', 'Any'], ['female', 'Female'], ['male', 'Male'], ['mixed', 'Several'], ['unknown', 'Not known']], 'voice'),
    sel('t-focus', 'Good for', [['', 'Anything'], ...focusTags.map((x) => [x, FOCUS_LABELS[x]])], 'focus'),
    sel('t-level', 'Level', [['', 'Any'], ['beginner', 'Beginner-friendly'], ['advanced', 'Advanced']], 'level'),
    sel('t-sort', 'Order', [['name', 'By name'], ['size', 'Biggest channels first']], 'sort'));

  const card = (t, have) => {
    const as = { channel: t.name, id: '' };   // what the menus need to know which channel this is
    const styles = (t.styles ?? []).map((s) => STYLE_BY_ID[s]?.name).filter(Boolean).slice(0, 4);
    const bits = [levelText(t.level) !== 'All levels' ? levelText(t.level) : '', lengthText(t.length), sizeText(t.size)].filter(Boolean);
    const focus = (t.focus ?? []).map((x) => FOCUS_LABELS[x]).filter(Boolean);
    const hasKey = !!ctx.hasKey;
    const mine = t.by === 'gemini';
    const add = h('button', { class: 'btn small', type: 'button', 'data-action': 'add-teacher', disabled: !hasKey,
      title: hasKey ? 'Look up this teacher on YouTube and add their videos to “Discovered” (uses part of today’s free YouTube allowance)' : 'Needs a YouTube key (Settings)',
      onclick: async () => {
        add.disabled = true; add.textContent = 'Reading…';
        try {
          const out = await importInputs(t.handle || t.name, { progress: (m) => { add.textContent = String(m).slice(0, 26); } });
          toast(out.imported ? `Added ${out.imported} videos from “${out.names[0] ?? t.name}” to Discovered.` : (out.problems[0] ?? 'Nothing was added.'), out.imported ? 'success' : 'error');
          ctx.hooks.renderResults?.();
        } catch (e) { toast(e.message, 'error'); }
        add.disabled = !hasKey; add.textContent = '＋ Add their videos';
      } }, '＋ Add their videos');
    return h('article', { class: 't-card', 'data-teacher': t.name },
      h('h3', null, teacherLink(t.name)),
      h('div', { class: 'badges' }, voiceBadge(as), mine && h('span', { class: 'badge warn', title: 'Found by Gemini searching the web and kept by you. Not checked: open the YouTube link to see for yourself.' }, 'Found by Gemini · unchecked'), styles.map((s) => h('span', { class: 'badge kind' }, s)), bits.map((b) => h('span', { class: 'badge' }, b))),
      t.note ? h('p', { class: 't-note' }, t.note) : null,
      focus.length ? h('p', { class: 'hint' }, `Good for: ${focus.join(', ')}`) : null,
      have ? h('p', { class: 'hint' }, `${have} of their videos ${have === 1 ? 'is' : 'are'} already known to the app.`) : null,
      h('div', { class: 'row-actions' },
        teacherLink(t.name, { cls: 'btn small primary', text: 'Videos & analysis →' }),
        h('a', { class: 'btn small ghost', href: youtubeUrl(t), target: '_blank', rel: 'noopener noreferrer' }, 'On YouTube ↗'),
        mine && t.source ? h('a', { class: 'btn small ghost', href: t.source, target: '_blank', rel: 'noopener noreferrer', title: 'The page Gemini found it on' }, 'Source ↗') : null,
        mine ? h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'drop-teacher', onclick: () => { dropTeacher(t.name); toast(`Removed “${t.name}” from your list.`, 'info'); draw(); } }, 'Remove') : null,
        add, favoriteButton(as, { cls: 'btn small ghost', onChange: () => draw() }), voiceMenu(as, { onChange: () => draw() })));
  };

  /** "Find more with Gemini": a web search by Gemini for teachers that are not in the list yet, checked and shown as unverified. */
  function drawAi() {
    const gate = aiGate();
    if (!gate) { fill(aiSlot); return; }
    if (gate === 'setup') { fill(aiSlot, h('p', { class: 'hint', id: 't-ai-setup' }, '✨ Gemini can search the web for more teachers. ', h('a', { href: '#settings', onclick: (e) => { e.preventDefault(); ctx.hooks.navigate('settings'); } }, 'Set up the AI helper'), ' (free) to use it.')); return; }
    const sug = ctx.ui.teacherSuggest;
    const asked = [f.style && STYLE_BY_ID[f.style]?.name, f.focus && FOCUS_LABELS[f.focus], f.voice === 'female' || f.voice === 'male' ? `${f.voice} teachers` : null].filter(Boolean);
    const go = h('button', { class: 'btn', type: 'button', id: 't-ai-find', disabled: searching, onclick: async () => {
      searching = true; drawAi();
      try {
        const known = all().map((t) => t.name);
        const res = await suggestTeachers({ styles: f.style ? [f.style] : [], focus: f.focus ? [f.focus] : [], voice: f.voice === 'female' || f.voice === 'male' ? f.voice : '' });
        ctx.ui.teacherSuggest = { ...res, teachers: res.teachers.filter((t) => !known.some((n) => n.toLowerCase() === t.name.toLowerCase())) };
        toast(res.teachers.length ? `Gemini suggests ${res.teachers.length} teachers. Check them before you trust them.` : 'Gemini found nobody new for that.', res.teachers.length ? 'success' : 'info');
      } catch (e) { toast(e.message, 'error', 9000); }
      searching = false; drawAi();
    } }, searching ? '✨ Gemini is searching… (about half a minute)' : '✨ Find more with Gemini');
    fill(aiSlot, h('section', { class: 'panel', id: 't-ai-panel' },
      h('div', { class: 'actions' }, go, h('small', { class: 'hint' }, asked.length ? `Asks for teachers matching: ${asked.join(' · ')}.` : 'Uses the filters above if you set any (style, good for, teacher).')),
      sug ? h('div', { class: 'ai-suggestions', id: 't-ai-results' },
        h('p', { class: 'hint' }, 'From an AI searching the web: names and details are unchecked, and a voice is only given where a page said so. Open each one on YouTube to see for yourself.'),
        sug.teachers.length ? h('div', { class: 't-list' }, sug.teachers.map((t) => h('article', { class: 't-card', 'data-suggestion': t.name },
          h('h3', null, t.name),
          h('div', { class: 'badges' }, t.voice && h('span', { class: 'badge voice unsure', title: t.voiceSource }, `${voiceTextOf(t.voice)}?`), t.styles.map((s) => h('span', { class: 'badge kind' }, STYLE_BY_ID[s]?.name ?? s)), lvl(t.level) && t.level !== 'all' ? h('span', { class: 'badge' }, lvl(t.level)) : null),
          t.note ? h('p', { class: 't-note' }, t.note) : null,
          t.voiceSource ? h('p', { class: 'hint' }, `Why “${voiceTextOf(t.voice)?.toLowerCase()}”: ${t.voiceSource}`) : null,
          h('div', { class: 'row-actions' },
            h('a', { class: 'btn small ghost', href: youtubeUrl(t), target: '_blank', rel: 'noopener noreferrer' }, 'On YouTube ↗'),
            t.source ? h('a', { class: 'btn small ghost', href: t.source, target: '_blank', rel: 'noopener noreferrer' }, 'Where it was found ↗') : null,
            h('button', { class: 'btn small primary', type: 'button', 'data-action': 'keep-teacher', onclick: () => { keepTeacher(t); sug.teachers = sug.teachers.filter((x) => x !== t); toast(`Kept “${t.name}” in your list (unchecked).`, 'success'); drawAi(); draw(); } }, 'Keep'),
            h('button', { class: 'btn small ghost', type: 'button', 'data-action': 'dismiss-teacher', onclick: () => { sug.teachers = sug.teachers.filter((x) => x !== t); drawAi(); } }, 'Dismiss'))))) : h('p', { class: 'hint' }, 'Nothing new this time.'),
        sug.sources?.length ? h('details', { class: 'tips' }, h('summary', null, `Pages Gemini used (${sug.sources.length})`),
          h('ul', null, sug.sources.slice(0, 12).map((x) => h('li', null, h('a', { href: x.uri, target: '_blank', rel: 'noopener noreferrer' }, x.title || x.uri))))) : null) : null));
  }

  function draw() {
    drawAi();   // (what it will ask for follows the filters)
    const counts = new Map();
    for (const v of Object.values(state.videos)) { const k = normName(v.channel); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
    const list = searchCatalogue(f, (t) => voiceFor({ channel: t.name, id: '' }), all());
    fill(countEl, `${list.length} of ${all().length} teachers`);
    fill(listSlot,
      list.length
        ? h('div', { class: 't-list' }, list.slice(0, f.show).map((t) => card(t, counts.get(normName(t.name)) ?? 0)))
        : emptyBlock({ kind: 'mat', title: 'No teacher matches that.', body: h('p', null, 'Try fewer filters, or a different word.'),
          actions: [h('button', { class: 'btn', type: 'button', onclick: () => { Object.assign(f, { q: '', style: '', voice: '', focus: '', level: '', show: PAGE }); mountTeachers(root); } }, 'Clear the filters')] }),
      list.length > f.show ? h('button', { class: 'btn', type: 'button', id: 't-more', onclick: () => { f.show += PAGE; draw(); } }, `Show more (${list.length - f.show} left)`) : null);
  }

  fill(root,
    h('h1', null, 'Teachers'),
    h('p', { class: 'sub' }, 'A starting list of YouTube teachers for yoga, stretching, mobility and Pilates, to find people worth trying. Search them on YouTube, add their videos, mark the ones you love, and say whether a woman or a man teaches.'),
    h('section', { class: 'panel' }, controls,
      h('details', { class: 'tips', id: 't-about' }, h('summary', null, 'How was this list made, and how far can it be trusted?'),
        h('p', { class: 'hint' }, `It was put together in ${new Date(CATALOGUE_DATE).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} from web search results, because YouTube’s own pages weren’t readable then. So names can differ slightly from the exact YouTube title, most entries have no @handle (the YouTube link then searches for the name), and the descriptions are short. Whether a woman or a man teaches is only filled in where a source said so with a pronoun or a role, never from a name; a “?” marks a reading from a single source. Anything you set yourself with “Teacher ▾” wins. It is a map, not a guarantee.`))),
    aiSlot, countEl, listSlot);
  draw();
}
