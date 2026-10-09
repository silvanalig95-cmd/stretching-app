// Who is teaching: a woman, a man, or both.
//
// YouTube does not say, so the answer is read from what is written down, best evidence first:
//   1. what you told the app about the channel (always wins),
//   2. a short list of well-known teachers,
//   3. what the video's own words say outright ("she/her" in the bio, "female yoga teacher", "husband and wife"),
//   4. what viewers say about the teacher in the comments ("her voice", "love him", "thank you ma'am"), when they agree clearly.
// It never guesses from a name. With no evidence the answer is "unknown", and unknown is never hidden by the filter:
// it only ranks after the teachers that are known to match. Pure functions: no DOM, no network.

import { channelKey, channelMatcher, normName } from './channel.js';
import { CATALOGUE } from '../data/teachers.js';

/** What can be asked for (the empty one means "no preference"). */
export const VOICE_CHOICES = [
  { id: '', label: 'Any teacher' },
  { id: 'female', label: 'Female teacher' },
  { id: 'male', label: 'Male teacher' },
];
export const VOICES = ['female', 'male', 'mixed'];
const TEXT = { female: 'Female teacher', male: 'Male teacher', mixed: 'Several teachers' };
export const voiceText = (gender) => TEXT[gender] ?? '';
const SOURCE_TEXT = { you: 'You marked this channel', known: 'From the app’s teachers list', channel: 'Read from this channel’s videos', video: 'Read from this video' };

/**
 * Teachers in the app's own list (data/teachers.js) for whom a source said who teaches: channel name, compared without spaces or
 * capitals -> {gender, certainty, evidence}. 'sure' where two research passes agreed (or it is a very well-known teacher), else 'probable'.
 * Anything you mark yourself overrides it.
 */
const KNOWN = new Map(CATALOGUE.filter((t) => VOICES.includes(t.voice)).map((t) => [normName(t.name), {
  gender: t.voice, certainty: t.voiceBy === 'sure' ? 'sure' : 'probable', evidence: t.voiceSource || 'the app’s teachers list',
}]));
/** The same list as plain data: normalised channel name -> 'female' | 'male' | 'mixed'. */
export const KNOWN_VOICES = Object.fromEntries([...KNOWN].map(([k, v]) => [k, v.gender]));

// ---------------------------------------------------------------- what the words say

const FIELD = '(?:yoga |pilates |fitness |stretch(?:ing)? |mobility |movement )?';
const ROLE = '(?:teacher|instructor|trainer|coach|guide)';
const first = (re) => `(?:^|[^a-z])(?:i'?m|i am) (?:a |an |the )?(?:[a-z]+,? ){0,6}${re}\\b`;   // "I'm a yoga teacher and a busy mum": a statement about oneself
// [pattern, what it says, certainty]
const TEXT_FEMALE = [
  [/\bshe\s*\/\s*hers?\b/, 'the bio says “she/her”', 'sure'],
  [new RegExp(`\\b(?:female|woman|women|lady) ${FIELD}${ROLE}\\b`), 'it says “female teacher”', 'sure'],
  [new RegExp(first('(?:mom|mum|mother)')), 'the teacher says they are a mum', 'probable'],
];
const TEXT_MALE = [
  [/\bhe\s*\/\s*(?:him|his)\b/, 'the bio says “he/him”', 'sure'],
  [new RegExp(`\\b(?:male|man|men|guy) ${FIELD}${ROLE}\\b`), 'it says “male teacher”', 'sure'],
  [new RegExp(first('(?:dad|father)')), 'the teacher says they are a dad', 'probable'],
];
const TEXT_BOTH = [
  [/\b(?:husband (?:and|&) wife|wife (?:and|&) husband|married couple|couple of (?:yoga )?teachers)\b/, 'it is run by a couple', 'sure'],
];

const clean = (s) => String(s ?? '').toLowerCase().replace(/[’‘]/g, "'");

/** What a video's own text (its channel name and description) says outright about who teaches, or null. */
export function textVoice({ channel = '', description = '' } = {}) {
  const text = clean(`${channel}\n${String(description).slice(0, 3000)}`);
  const hit = (list) => list.map(([re, why, certainty]) => (re.test(text) ? { why, certainty } : null)).filter(Boolean);
  const f = hit(TEXT_FEMALE), m = hit(TEXT_MALE), both = hit(TEXT_BOTH);
  if (both.length || (f.length && m.length)) {
    const why = both[0]?.why ?? 'it mentions both a woman and a man';
    return { gender: 'mixed', certainty: both.length ? 'sure' : 'probable', evidence: why };
  }
  const best = (f.length ? f : m).sort((a, b) => (a.certainty === 'sure' ? 0 : 1) - (b.certainty === 'sure' ? 0 : 1))[0];
  return best ? { gender: f.length ? 'female' : 'male', certainty: best.certainty, evidence: best.why } : null;
}

// ---------------------------------------------------------------- what viewers say

const ATTR = '(?:voice|cues?|cueing|instructions?|teaching|energy|smile|accent|style|pace|tone|classes|class|videos?|personality|presence|humou?r|channel)';
const SHE = '(?:explains|teaches|guides|cues|is (?:such |so |an? |the |really |truly )?(?:amazing|wonderful|great|lovely|awesome|best|angel|gem|inspiration|the best)|has (?:such |an? |the )|makes (?:it|me|this|yoga|everything))';
const FEMALE_CUES = [new RegExp(`\\bher ${ATTR}\\b`), new RegExp(`\\bshe ${SHE}\\b`), /\b(?:love|loved|adore|adored|bless) her\b/, /\bthank(?:s| you)(?: so much)?,? (?:ma'?am|madam|miss)\b/, /\b(?:ma'?am|madam)\b/];
const MALE_CUES = [new RegExp(`\\bhis ${ATTR}\\b`), new RegExp(`\\bhe ${SHE}\\b`), /\b(?:love|loved|adore|adored|bless) him\b/, /\bthank(?:s| you)(?: so much)?,? (?:sir|mister)\b/, /\bgood sir\b/];

const commentText = (c) => clean(typeof c === 'string' ? c : c?.text ?? c?.t ?? '');

/** What viewers say about the teacher: {gender, certainty:'probable', evidence} when they clearly agree, else null. */
export function commentVoice(comments) {
  let f = 0, m = 0;
  for (const c of comments ?? []) {
    const t = commentText(c);
    if (!t) continue;
    if (FEMALE_CUES.some((re) => re.test(t))) f++;
    if (MALE_CUES.some((re) => re.test(t))) m++;
  }
  const total = f + m;
  if (total < 3) return null;
  const gender = f >= m ? 'female' : 'male';
  const top = Math.max(f, m);
  if (top / total < 0.85) return null;   // viewers disagree (or are talking about other people): no answer is better than a wrong one
  return { gender, certainty: 'probable', evidence: `${top} comment${top === 1 ? '' : 's'} say ${gender === 'female' ? '“her / she”' : '“his / he”'} about the teacher${total > top ? ` (${total - top} say the other)` : ''}` };
}

/**
 * The best reading of one video's own text and comments. Stored with the video's analysis.
 * @returns {{gender:'female'|'male'|'mixed', certainty:'sure'|'probable', evidence:string}|null}
 */
export function guessVoice({ channel, description, comments } = {}) {
  const text = textVoice({ channel, description });
  const said = commentVoice(comments);
  if (text && said && text.gender !== said.gender) return text.certainty === 'sure' ? text : null;   // they disagree: only an outright statement wins
  return text ?? said ?? null;
}

// ---------------------------------------------------------------- the answer for a video

/**
 * Builds the function that says who teaches a video.
 * @param {{marks?:{key:string,name?:string,channelId?:string,voice:string}[], videos?:object[]}} o  marks = what you told the app; videos = everything known (a channel's other videos add evidence)
 * @returns {(video:object)=>({gender:string, certainty:'sure'|'probable', source:'you'|'known'|'channel'|'video', evidence:string}|null)}
 */
export function voiceResolver({ marks = [], videos = [] } = {}) {
  const markFor = new Map();
  const matchers = marks.filter((x) => VOICES.includes(x.voice)).map((x) => [channelMatcher([x]), x.voice, x]);
  const tally = new Map();   // channel -> {female, male, mixed, n}
  for (const v of videos) {
    const g = v.profile?.voice?.gender;
    if (!g) continue;
    const key = channelKey(v);
    if (!key) continue;
    const t = tally.get(key) ?? { female: 0, male: 0, mixed: 0, n: 0 };
    t[g]++; t.n++;
    tally.set(key, t);
  }
  return (video) => {
    if (!video) return null;
    const key = channelKey(video);
    if (!markFor.has(key)) markFor.set(key, matchers.find(([is]) => is(video)) ?? null);
    const mark = markFor.get(key);
    if (mark) return { gender: mark[1], certainty: 'sure', source: 'you', evidence: SOURCE_TEXT.you };
    const known = KNOWN.get(normName(video.channel));
    if (known) return { gender: known.gender, certainty: known.certainty, source: 'known', evidence: known.evidence };
    const own = video.profile?.voice ?? null;
    const t = tally.get(key);
    if (t && t.n >= 2) {
      const [g, count] = VOICES.map((x) => [x, t[x]]).sort((a, b) => b[1] - a[1])[0];
      if (count / t.n >= 0.8) return { gender: g, certainty: 'probable', source: 'channel', evidence: `${count} of ${t.n} videos from this channel point to this` };
      if (!own || own.certainty !== 'sure') return null;   // this channel's videos disagree, and this one has nothing outright of its own
    }
    return own ? { gender: own.gender, certainty: own.certainty, source: 'video', evidence: own.evidence } : null;
  };
}

/** Does a teacher fit what was asked for? 'yes' | 'no' | 'unknown' (no preference always fits). */
export function voiceFit(wanted, voice) {
  if (!wanted) return 'yes';
  if (!voice?.gender) return 'unknown';
  return voice.gender === 'mixed' || voice.gender === wanted ? 'yes' : 'no';
}

/** One line for a tooltip: "Female teacher · You marked this channel", or "Female teacher? (a guess) · ...: 5 of 6 videos ...". */
export function voiceNote(voice) {
  if (!voice?.gender) return '';
  const base = voiceText(voice.gender);
  if (voice.source === 'you') return `${base} · ${SOURCE_TEXT.you}`;
  if (voice.source === 'known' && voice.certainty === 'sure') return `${base} · ${SOURCE_TEXT.known}`;
  return `${base}${voice.certainty === 'sure' ? '' : ' (a guess)'} · ${SOURCE_TEXT[voice.source] ?? 'Read from the text'}: ${voice.evidence}`;
}
