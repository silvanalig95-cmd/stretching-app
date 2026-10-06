// Settings: the optional AI coach. Your Anthropic key is handed to the server and kept there; this page never sees it again.

import { h, fill } from '../dom.js';
import { ctx } from '../ctx.js';
import { toast } from '../modal.js';
import { APP_NAME } from '../brand.js';
import { llmStatus, llmSave, CoachError } from '../llm.js';
import { MODEL_NAMES } from './strength-coach.js';

const MODEL_BLURB = {
  'claude-opus-5-5': 'Claude Opus 5.5: the best results; roughly 3 to 8 US cents per request',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5: about half the price; usually plenty for workouts',
};

export function aiPanel() {
  const root = h('section', { class: 'panel', id: 'ai-panel' }, h('h2', null, 'AI coach (optional)'), h('p', { class: 'loading' }, 'Checking…'));

  /** Tell the Strength page (if it is open in this session) what changed. */
  const share = (st) => { const u = ctx.ui.strength; if (u) { u.coach = st; u.coachLoaded = true; } };

  const draw = (st) => {
    const status = h('p', { class: 'hint', id: 'llm-status', 'aria-live': 'polite' });
    const say = (m) => { status.textContent = m; };
    const keyInput = h('input', { type: 'password', id: 'llm-key', placeholder: 'Paste your Anthropic API key (starts with sk-ant-)', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Anthropic API key' });
    const save = async (patch, done) => {
      try { const next = await llmSave(patch); share(next); draw(next); done?.(next); }
      catch (e) { say(e instanceof CoachError ? e.message : 'Could not save that.'); }
    };
    const intro = h('p', null, 'In Strength, ', h('strong', null, '✨ Ask the coach'), ' can design a workout or a whole plan from your description, or round off one you are building, and it explains its choices. It uses Claude, an AI model by Anthropic, with your own Anthropic API key. Without it everything else works the same; the simple built-in rules stay available.');
    const body = !st
      ? [intro, h('p', { class: 'hint', id: 'llm-offline' }, `The coach needs the ${APP_NAME} server (serve.py), which keeps the key safe. This page is not connected to it, so there is nothing to set up here.`)]
      : [intro,
        st.ready
          ? h('p', { id: 'llm-ready' }, `✓ Ready, using ${st.source === 'own' ? `your key (${st.ownKey})` : 'the key the server owner set up'}. `, h('span', { class: 'muted' }, st.dailyCap ? `Today: ${st.usedToday ?? 0} of ${st.dailyCap} requests used.` : `Today: ${st.usedToday ?? 0} requests.`))
          : h('p', { id: 'llm-ready' }, 'Not set up yet: add your key below.'),
        h('form', { class: 'key-form', onsubmit: (e) => { e.preventDefault(); const k = keyInput.value.trim(); if (!k) { say('Paste your key first.'); return; } save({ key: k }, () => toast('Anthropic key saved on the server.', 'success')); } },
          keyInput, h('button', { class: 'btn primary', id: 'save-llm-key', type: 'submit' }, 'Save key'),
          st.ownKey ? h('button', { class: 'btn ghost danger', id: 'remove-llm-key', type: 'button', onclick: () => save({ key: '' }, () => toast('Key removed.', 'info')) }, 'Remove my key') : null),
        status,
        h('label', { class: 'field' }, h('span', null, 'Model'),
          h('select', { id: 'llm-model', onchange: (e) => save({ model: e.target.value }, () => toast(`The coach will use ${MODEL_NAMES[e.target.value]}.`, 'info')) },
            (st.models ?? []).map((m) => h('option', { value: m, selected: m === st.model }, MODEL_BLURB[m] ?? m)))),
        h('details', { class: 'steps', id: 'llm-details' }, h('summary', null, 'What is sent, what it costs, where the key lives'),
          h('ul', null,
            h('li', null, h('strong', null, 'Sent to Anthropic, only when you press a coach button: '), 'your request text; the exercises you can do (your equipment and “avoid” settings already applied); your goal, level, usual session length, weekly goal and weak spots; and the exercises, sets and weights of your strength sessions from the last 14 days. ',
              h('strong', null, 'Never sent: '), 'your video library, notes, channels, YouTube key or stretching history.'),
            h('li', null, h('strong', null, 'Cost: '), 'you pay Anthropic per request, from your own account (a Claude chat subscription does not cover API use). Create a key and add a little credit at ', h('a', { href: 'https://platform.claude.com/', target: '_blank', rel: 'noopener noreferrer' }, 'the Anthropic Console'), '. A request is typically a few thousand tokens in and out, so cents; the long, repeated part is cached, which makes follow-up requests cheaper. The server also limits how many requests each person can make per day.'),
            h('li', null, h('strong', null, 'The key: '), 'is stored in a private file on the server (llm.json), is never sent back to this page, and travels with your backups like your YouTube key. Only Claude’s answers come back, and every exercise in them is checked against your catalogue before it is shown.'),
            h('li', null, h('strong', null, 'Limits: '), 'Claude works from its general training. It does not search the web, and it is not a doctor or a physiotherapist: treat its workouts as a well-informed draft, and start light.')))];
    fill(root, h('h2', null, 'AI coach (optional)'), body);
  };

  llmStatus({ fresh: true }).then((st) => { share(st); draw(st); });
  return root;
}
