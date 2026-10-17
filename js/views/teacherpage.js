// A teacher's page (#teacher/<name>): who they are, what they usually teach (worked out from their videos), their videos to browse,
// and finding more of them on YouTube. Reached by clicking a teacher's name anywhere in the app. Nothing here changes anything by itself:
// reading a channel from YouTube, following, and asking Gemini are each one press.

import { h, fill, thumb, fmtViews } from '../dom.js';
import { ctx, play, importInputs, quotaInfo, refreshFollowedNow, findTeacherChannels } from '../ctx.js';
import { favoriteButton } from './favorite.js';
import { blockMenu } from './blockmenu.js';
import { voiceBadge, voiceMenu } from './voice.js';
import { styleBadge } from './stylebadge.js';
import { aiLibrarySection } from './aiblock.js';
import { aiCandidates, dropTeacher } from '../aiwork.js';
import { toast } from '../modal.js';
import { followChannel, unfollowChannel, toggleLibrary, hiddenReason, linkTeacherChannel, unblockChannel, isFavoriteChannel } from '../state.js';
import { channelMatcher, normName } from '../channel.js';
import { levelText, lengthText, sizeText, FOCUS_LABELS } from '../catalogue.js';
import { STYLE_BY_ID } from '../style.js';
import { areaLabel } from '../lexicon.js';
import { resolveTeacher, teacherVideos, teacherYoutubeUrl, teacherImportInput, teacherProfile, teacherSummary, teacherBasis, browseVideos, browseChoices, lengthLabel, SORTS, LENGTH_CHOICES } from '../teacherinfo.js';

const PAGE = 24;
const TAB_NAMES = { today: 'Today', library: 'Library', teachers: 'Teachers', journal: 'Journal', settings: 'Settings' };
const subsText = (n) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const when = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : ''; };
const badge = (text, cls = '', title = '') => h('span', { class: `badge ${cls}`.trim(), ...(title ? { title } : {}) }, text);
/** What reading a channel costs in YouTube's daily allowance: two list calls per 50 videos, comments (1 each, up to 300), and a name lookup (a search: 100). */
const costOf = (videos, lookup) => (lookup ? 100 : 0) + 2 * Math.ceil(videos / 50) + Math.min(videos, 300);

export function mountTeacherPage(root, nameArg) {
  const { state, store } = ctx;
  const f = { q: '', area: '', kind: '', length: '', mine: false, sort: 'mine', show: PAGE };
  let busy = false;       // reading from YouTube: buttons are off and the progress line says what is happening
  let pending = null;     // channels YouTube offered for this name, waiting for a pick
  let followBox = true;   // "also follow them" ticked when reading
  const slots = { head: h('div'), find: h('div'), analysis: h('div'), ai: h('div'), controls: h('div'), list: h('div') };

  const who = () => resolveTeacher(nameArg, { videos: state.videos, channels: state.channels, following: state.following, myTeachers: state.myTeachers, aliases: state.teacherChannels });
  const as = (ref) => ({ id: '', channel: ref.name, ...(ref.channelId ? { channelId: ref.channelId } : {}) });   // what the shared menus need to know which channel this is
  const theirs = () => teacherVideos(who(), state.videos);
  const all = () => { drawHead(); drawFind(); drawAnalysis(); drawAi(); drawControls(); drawList(); };

  // ---------------------------------------------------------------- header
  function drawHead() {
    const ref = who(), vids = theirs(), v = as(ref), entry = ref.entry;
    const blockedEntry = state.blockedChannels.find((c) => channelMatcher([c])(v));
    const subs = ref.channelId ? state.channels[ref.channelId]?.subscribers : null;
    const styles = (entry?.styles ?? []).map((s) => STYLE_BY_ID[s]?.name).filter(Boolean).slice(0, 4);
    const bits = entry ? [levelText(entry.level) !== 'All levels' ? levelText(entry.level) : '', lengthText(entry.length), sizeText(entry.size)].filter(Boolean) : [];
    const focus = (entry?.focus ?? []).map((x) => FOCUS_LABELS[x]).filter(Boolean);
    const from = TAB_NAMES[ctx.ui.teacherFrom] ? ctx.ui.teacherFrom : 'teachers';
    const ytName = ref.channelId ? vids.find((x) => x.channelId === ref.channelId)?.channel : null;
    fill(slots.head, h('section', { class: 'panel teacher-head', id: 'teacher-head', 'data-teacher': ref.name },
      h('button', { class: 'link', type: 'button', id: 'teacher-back', onclick: () => ctx.hooks.navigate(from) }, `← ${TAB_NAMES[from]}`),
      h('h1', { id: 'teacher-name' }, ref.name),
      h('div', { class: 'badges' },
        voiceBadge(v),
        ref.mine && badge('Found by Gemini · unchecked', 'warn', 'Found by Gemini searching the web and kept by you. Not checked: open the YouTube link to see for yourself.'),
        isFavoriteChannel(state, v) && badge('★ Favourite', 'fav'),
        ref.followed && badge('✓ Following', 'new', 'The app checks this teacher for new uploads when you press “Check for new uploads”'),
        blockedEntry && badge('Blocked', 'warn', 'You told the app never to suggest this teacher'),
        styles.map((s) => badge(s, 'kind')), bits.map((b) => badge(b))),
      entry?.note ? h('p', { class: 't-note' }, entry.note) : null,
      focus.length ? h('p', { class: 'hint' }, `Good for: ${focus.join(', ')}`) : null,
      h('p', { class: 'hint facts' }, [subs ? `${subsText(subs)} subscribers` : null, ytName && normName(ytName) !== normName(ref.name) ? `On YouTube: “${ytName}”` : null,
        vids.length ? `${vids.length} of their videos known to the app` : 'None of their videos are known to the app yet'].filter(Boolean).join(' · ')),
      blockedEntry ? h('p', { class: 'hint', id: 'teacher-blocked' }, 'You blocked this teacher, so their videos are never suggested. ',
        h('button', { class: 'link', type: 'button', id: 'teacher-unblock', onclick: () => { unblockChannel(state, blockedEntry.key); store.save(); toast(`“${ref.name}” is allowed again.`, 'info'); all(); } }, 'Allow them again')) : null,
      h('div', { class: 'actions' },
        h('a', { class: 'btn small ghost', href: teacherYoutubeUrl(ref), target: '_blank', rel: 'noopener noreferrer' }, 'On YouTube ↗'),
        favoriteButton(v, { cls: 'btn small ghost', onChange: all }),
        h('button', { class: 'btn small ghost', type: 'button', id: 'teacher-follow', disabled: !ref.channelId && !ref.followed, 'aria-pressed': !!ref.followed,
          title: ref.followed ? 'Stop checking this teacher for new uploads' : ref.channelId ? 'Check this teacher for new uploads whenever you press “Check for new uploads”' : 'Read their channel from YouTube first (below)',
          onclick: () => {
            if (ref.followed) { unfollowChannel(state, ref.followed.channelId); toast(`Stopped following “${ref.name}”.`, 'info'); } else { followChannel(state, { channelId: ref.channelId, name: ref.name }); toast(`Following “${ref.name}”.`, 'success'); }
            store.save(); all();
          } }, ref.followed ? '✓ Following' : 'Follow'),
        voiceMenu(v, { cls: 'btn small ghost', onChange: all }),
        blockMenu(v, { channelOnly: true, cls: 'btn small ghost', onChange: all }),
        ref.mine ? h('button', { class: 'btn small ghost', type: 'button', id: 'teacher-drop', onclick: () => { dropTeacher(ref.name); toast(`Removed “${ref.name}” from your list.`, 'info'); ctx.hooks.navigate(from); } }, 'Remove from my list') : null)));
  }

  // ---------------------------------------------------------------- finding more of them
  async function read({ input, max, label }) {
    const ref = who();
    busy = true; pending = null; drawFind();
    const progress = (m) => { const el = document.getElementById('teacher-progress'); if (el) el.textContent = String(m); };
    progress(label);
    try {
      const out = await importInputs(input, { follow: followBox, maxVideos: max, progress });
      const ch = out.channels[0];
      if (ch && linkTeacherChannel(state, ref.name, ch.id)) store.save();
      toast(out.imported ? `Read ${out.imported} videos from “${out.names[0] ?? ref.name}”.${out.followed.length ? ' You are following them now.' : ''}` : (out.problems[0] ?? 'Nothing was added.'), out.imported ? 'success' : 'error', 7000);
      for (const p of out.problems.slice(out.imported ? 0 : 1, 3)) toast(p, 'info', 9000);
      ctx.hooks.renderResults?.();
    } catch (e) { toast(e.message, 'error', 9000); }
    busy = false; all();
  }

  async function lookup() {
    const ref = who();
    busy = true; pending = null; drawFind();
    const progress = (m) => { const el = document.getElementById('teacher-progress'); if (el) el.textContent = m; };
    progress('Looking for them on YouTube…');
    let found = [];
    try { found = await findTeacherChannels(ref.name); } catch (e) { toast(e.message, 'error', 9000); busy = false; drawFind(); return; }
    busy = false;
    if (!found.length) { toast(`YouTube has no channel called “${ref.name}”.`, 'error'); drawFind(); return; }
    if (normName(found[0].name) === normName(ref.name)) { await read({ input: found[0].id, max: 150, label: 'Reading their uploads…' }); return; }
    pending = found.slice(0, 5);   // no channel has exactly this name: the person picks
    drawFind();
  }

  function drawFind() {
    const ref = who(), vids = theirs();
    const unit = (n) => `${n.toLocaleString()} unit${n === 1 ? '' : 's'}`;
    const left = ctx.hasKey ? quotaInfo().left : 0;
    const needsLookup = !ref.channelId && !ref.handle;
    const input = teacherImportInput(ref);
    const btn = (id, text, onclick, { primary = false, title = '', off = false } = {}) => h('button', { class: `btn small${primary ? ' primary' : ''}`, type: 'button', id, disabled: busy || off, title, onclick }, text);
    fill(slots.find, h('section', { class: 'panel', id: 'teacher-find' },
      h('h2', null, 'Find more of their videos'),
      !ctx.hasKey
        ? h('p', { class: 'hint', id: 'teacher-nokey' }, 'Reading a teacher’s whole channel needs a free YouTube key (Settings → YouTube search). Until then you can open them on YouTube, and everything the app already knows about them is below.')
        : [
          h('p', { class: 'hint' }, ref.channelId || ref.handle
            ? 'Reads their uploads from YouTube (newest first), together with what viewers say about them, so the app can tell what each video is good for. Videos it already knows are not duplicated.'
            : 'The app doesn’t know this teacher’s channel yet. It will look for them on YouTube first (a search: 100 units), and asks you if it is not sure which channel is theirs.'),
          pending ? h('div', { id: 'teacher-candidates' },
            h('p', null, `No channel on YouTube is called exactly “${ref.name}”. Which one is theirs?`),
            h('ul', { class: 't-cands' }, pending.map((c) => h('li', { 'data-channel': c.id },
              h('strong', null, c.name), c.subscribers ? h('span', { class: 'hint' }, `${subsText(c.subscribers)} subscribers`) : null,
              h('a', { class: 'btn small ghost', href: `https://www.youtube.com/channel/${c.id}`, target: '_blank', rel: 'noopener noreferrer' }, 'Look ↗'),
              h('button', { class: 'btn small primary', type: 'button', 'data-action': 'pick-channel', disabled: busy, onclick: () => read({ input: c.id, max: 150, label: 'Reading their uploads…' }) }, 'That’s them'))) ),
            h('button', { class: 'link', type: 'button', id: 'teacher-none', onclick: () => { pending = null; drawFind(); } }, 'None of these')) : null,
          !pending ? h('div', { class: 'actions' },
            needsLookup
              ? btn('teacher-find-btn', 'Find them on YouTube', lookup, { primary: true, title: `Looks for the channel, then reads about 150 videos: roughly ${unit(costOf(150, true))} of today’s ${left.toLocaleString()} left`, off: left < costOf(150, true) })
              : [btn('teacher-find-btn', 'Read their newest 150 videos', () => read({ input, max: 150, label: 'Reading their uploads…' }), { primary: true, title: `Roughly ${unit(costOf(150, false))} of today’s ${left.toLocaleString()} left`, off: left < costOf(150, false) }),
                btn('teacher-find-deeper', 'Read up to 500 (older ones too)', () => read({ input, max: 500, label: 'Reading further back…' }), { title: `Roughly ${unit(costOf(500, false))} of today’s ${left.toLocaleString()} left; videos you already have are not read twice`, off: left < costOf(500, false) }),
                ref.followed ? btn('teacher-check-new', 'Check for new uploads', async () => {
                  busy = true; drawFind();
                  try { const r = await refreshFollowedNow((m) => { const el = document.getElementById('teacher-progress'); if (el) el.textContent = String(m); }, { only: ref.followed.channelId }); toast(r.added ? `${r.added} new video${r.added === 1 ? '' : 's'} from “${ref.name}”.` : `Nothing new from “${ref.name}”.`, r.added ? 'success' : 'info'); ctx.hooks.renderResults?.(); }
                  catch (e) { toast(e.message, 'error', 9000); }
                  busy = false; all();
                }, { title: 'Looks at their latest uploads (about 2 units)' }) : null]) : null,
          !pending && !ref.followed ? h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'teacher-follow-box', checked: followBox, onchange: (e) => { followBox = e.target.checked; } }), ' Also follow them, so I can check for new uploads later') : null,
          h('p', { class: 'hint', id: 'teacher-progress', 'aria-live': 'polite' }, busy ? 'Starting…' : (vids.length ? '' : ''))]));
  }

  // ---------------------------------------------------------------- what they teach
  function drawAnalysis() {
    const vids = theirs();
    const p = teacherProfile(vids, { library: state.library, history: state.history, spots: state.prefs.focus ?? [] });
    if (!p.n) { fill(slots.analysis, h('section', { class: 'panel', id: 'teacher-analysis' }, h('h2', null, 'What they teach'), h('p', { class: 'hint' }, 'The app has not read any of their videos yet. Once it has, this shows what they usually teach: the kinds of routine, how long, and which muscles.'))); return; }
    const bar = (label, share, extra) => { const b = h('span', { class: 'bar' }, h('i')); b.firstChild.style.width = `${Math.max(3, Math.round(share * 100))}%`; return h('div', { class: 't-bar' }, h('span', null, label), b, h('span', { class: 'hint' }, extra)); };
    const maxBucket = Math.max(1, ...Object.values(p.length.buckets));
    const fits = p.fits.filter((x) => x.share >= 0.2), gaps = p.fits.filter((x) => x.share < 0.2);
    fill(slots.analysis, h('section', { class: 'panel', id: 'teacher-analysis' },
      h('h2', null, 'What they teach'),
      h('ul', { class: 't-sum', id: 'teacher-summary' }, teacherSummary(p).map((l) => h('li', null, l))),
      h('p', { class: 'hint', id: 'teacher-basis' }, teacherBasis(p)),
      h('div', { class: 't-cols' },
        p.areas.length ? h('div', { id: 'teacher-areas' }, h('h3', null, 'Muscles they work most'), p.areas.map((a) => bar(a.label, a.share, `${a.videos} of ${p.n}`))) : null,
        h('div', null,
          p.kinds.length ? [h('h3', null, 'Kinds of routine'), h('div', { class: 'badges' }, p.kinds.map((k) => badge(`${k.name} · ${k.n}`, 'kind')))] : null,
          h('h3', null, 'How long'), Object.entries(p.length.buckets).filter(([, n]) => n).length
            ? LENGTH_CHOICES.map(([id, label]) => (p.length.buckets[id] ? bar(label, p.length.buckets[id] / maxBucket, String(p.length.buckets[id])) : null)) : h('p', { class: 'hint' }, 'Lengths unknown.'),
          p.poses.length ? [h('h3', null, 'Poses and exercises they name'), h('div', { class: 'badges' }, p.poses.map((x) => badge(`${x.label} · ${x.n}`)))] : null,
          p.props.length ? h('p', { class: 'hint' }, `Props they mention: ${p.props.map((x) => x.id).join(', ')}`) : null),
        p.fits.length ? h('div', { id: 'teacher-fit' }, h('h3', null, 'For your tight and weak spots'),
          fits.length ? h('ul', { class: 't-fit' }, fits.map((x) => h('li', null, `✓ ${x.label} (${x.mode}): a focus of ${Math.round(x.share * 100)}% of their videos`))) : h('p', { class: 'hint' }, 'None of your standing spots is a main focus of theirs.'),
          gaps.length ? h('p', { class: 'hint' }, `Rarely covered: ${gaps.map((x) => x.label).join(', ')}.`) : null) : null)));
  }

  function drawAi() {
    const ids = theirs().map((v) => v.id);
    const sec = ids.length ? aiLibrarySection({ candidates: (mode) => aiCandidates(mode, { only: ids }), title: '✨ Let Gemini read their videos', rootId: 'ai-teacher', perWatch: 10, perRead: 40, onDone: all }) : null;
    fill(slots.ai, sec ? h('section', { class: 'panel', id: 'teacher-ai' }, sec) : null);
  }

  // ---------------------------------------------------------------- their videos
  function drawControls() {
    const vids = theirs();
    if (!vids.length) { fill(slots.controls); return; }
    const c = browseChoices(vids);
    const sel = (id, label, opts, key) => h('label', { class: 'field' }, h('span', null, label),
      h('select', { id, onchange: (e) => { f[key] = e.target.value; f.show = PAGE; drawList(); } }, opts.map(([v, t]) => h('option', { value: v, selected: f[key] === v }, t))));
    fill(slots.controls, h('div', { class: 'controls' },
      h('label', { class: 'field grow' }, h('span', null, 'Search their videos'), h('input', { type: 'search', id: 'teacher-q', value: f.q, autocomplete: 'off', spellcheck: 'false', placeholder: 'A pose, a muscle, a word in the title…', 'aria-label': 'Search their videos',
        oninput: (e) => { f.q = e.target.value; f.show = PAGE; drawList(); } })),
      sel('teacher-area', 'Muscles', [['', 'Any'], ...c.areas.map((a) => [a.id, `${a.label} (${a.n})`])], 'area'),
      sel('teacher-kind', 'Kind', [['', 'Any'], ...c.kinds.map((k) => [k.id, `${k.name} (${k.n})`])], 'kind'),
      sel('teacher-length', 'Length', [['', 'Any'], ...c.lengths.map((l) => [l.id, `${l.label} (${l.n})`])], 'length'),
      sel('teacher-sort', 'Order', SORTS, 'sort'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'teacher-mine', checked: f.mine, onchange: (e) => { f.mine = e.target.checked; f.show = PAGE; drawList(); } }), ' Only my library')));
  }

  function card(v) {
    const lib = state.library[v.id], reason = hiddenReason(state, v);
    const top = Object.entries(v.profile?.areas ?? {}).filter(([a, s]) => s >= 0.5 && a !== 'full_body').sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a);
    return h('article', { class: 'vcard', 'data-video': v.id },
      h('span', { class: 'thumb' }, h('img', { src: thumb(v.id), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }), h('span', { class: 'len' }, lengthLabel(v))),
      h('span', { class: 'vtitle' }, h('button', { class: 'vplay', type: 'button', onclick: () => play(v.id), 'aria-label': `Play ${v.title}` }, v.title)),
      h('span', { class: 'vmeta' }, [fmtViews(v.views), when(v.publishedAt)].filter(Boolean).join(' · ') || ' '),
      h('span', { class: 'badges' }, styleBadge(v), top.map((a) => badge(areaLabel(a))), lib && badge('In library', 'lib'), v.ai && badge('✨ Gemini read', '', 'Gemini watched or read this video'),
        reason && badge(reason === 'channel' ? 'channel blocked' : 'hidden', 'warn')),
      h('span', { class: 'vactions' },
        h('button', { class: 'btn small', type: 'button', 'data-action': 'toggle-library', onclick: () => { toggleLibrary(state, v.id); store.save(); drawHead(); drawAnalysis(); drawAi(); drawList(); } }, lib ? '✓ In library' : '＋ Library')));
  }

  function drawList() {
    const vids = theirs();
    if (!vids.length) { fill(slots.list, h('section', { class: 'panel', id: 'teacher-videos' }, h('h2', null, 'Their videos'), h('p', { class: 'hint', id: 'teacher-none-known' }, 'None known yet. Use “Find more of their videos” above' + (ctx.hasKey ? '.' : ' (needs a free YouTube key), or paste a link to one of their videos under Library → Add.')))); return; }
    const list = browseVideos(vids, f, { library: state.library });
    fill(slots.list, h('section', { id: 'teacher-videos' },
      h('h2', null, 'Their videos'),
      h('p', { class: 'hint', id: 'teacher-count', 'aria-live': 'polite' }, `${list.length} of ${vids.length} videos`),
      list.length ? h('div', { class: 'grid' }, list.slice(0, f.show).map(card)) : h('p', { class: 'empty-note' }, 'Nothing matches those filters.'),
      list.length > f.show ? h('button', { class: 'btn', type: 'button', id: 'teacher-more', onclick: () => { f.show += PAGE; drawList(); } }, `Show more (${list.length - f.show} left)`) : null));
  }

  fill(root, slots.head, slots.find, slots.analysis, slots.ai, h('div', { class: 'teacher-browse' }, slots.controls, slots.list));
  all();
}
