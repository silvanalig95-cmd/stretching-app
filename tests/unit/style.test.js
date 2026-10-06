// What kind of routine is it? Yoga (which kind), Pilates, plain stretching, foam rolling ... with evidence, and how it feels to do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyStyle, holdTimes, withFix, stylesWithFix, traitLine, STYLE_LIST, STYLE_BY_ID } from '../../js/style.js';
import { analyzeVideoText, attachComments, reanalyze, ANALYSIS_VERSION } from '../../js/analyze.js';
import { freshState, setStyleFix } from '../../js/state.js';

const kindOf = (v) => analyzeVideoText({ description: '', tags: [], channel: '', durationSec: 900, ...v }).kind;
const label = (v) => kindOf(v)?.label;

test('the title says it: yin, vinyasa, Pilates, foam rolling, tai chi, nidra, chair yoga', () => {
  assert.equal(label({ title: 'Yin Yoga for Hips | 30 min deep holds' }), 'Yin yoga');
  assert.equal(label({ title: 'Morning Vinyasa Flow | 20 min' }), 'Vinyasa / flow yoga');
  assert.equal(label({ title: '10 Min Wall Pilates for Beginners' }), 'Wall Pilates');
  assert.equal(label({ title: 'Reformer Pilates full body' }), 'Reformer Pilates');
  assert.equal(label({ title: 'Mat Pilates core workout' }), 'Pilates');
  assert.equal(label({ title: 'Foam rolling for tight quads and IT band' }), 'Foam rolling / self-massage');
  assert.equal(label({ title: 'Tai chi for beginners' }), 'Tai chi / qigong');
  assert.equal(label({ title: 'Yoga nidra for sleep' }), 'Yoga nidra', 'the more specific kind wins over "restorative"');
  assert.equal(label({ title: 'Chair yoga for seniors' }), 'Chair yoga');
  assert.equal(label({ title: 'Hatha yoga for beginners' }), 'Hatha yoga');
  assert.equal(label({ title: 'Ashtanga primary series' }), 'Ashtanga yoga');
  assert.equal(label({ title: 'Daily hip stretches for runners' }), 'Stretching routine');
  assert.equal(label({ title: 'Hip mobility drills, joint CARs' }), 'Mobility work');
  assert.equal(label({ title: '15 minute strength workout' }), 'Strength / workout');
});

test('without a style word in the title, the channel, the description and the poses still tell', () => {
  assert.equal(label({ title: '15 minute full body routine', channel: 'Pilates by Lottie', description: 'The hundred, roll up, single leg stretch and criss cross. Scoop your belly, neutral spine.' }), 'Pilates');
  assert.equal(label({ title: 'Evening wind down', channel: 'Calm Yin Yoga', description: 'Dragon pose, caterpillar, butterfly, frog. Hold each pose for 3 minutes.' }), 'Yin yoga');
  const yoga = kindOf({ title: '20 minute practice', description: 'Warrior two, downward dog, triangle pose, eagle pose, utkatasana, chaturanga and savasana.' });
  assert.equal(yoga.discipline, 'yoga', 'Sanskrit names and yoga poses add up');
  assert.ok(yoga.evidence.some((e) => /Sanskrit|typical of yoga/.test(e)));
});

test('every label comes with its evidence, a certainty and what else it could be', () => {
  const k = kindOf({ title: 'Yin Yoga for Hips', tags: ['yin'], description: 'Dragon, caterpillar, butterfly.' });
  assert.ok(k.confidence > 0.7 && k.certainty === 'clearly');
  assert.ok(k.evidence.length >= 2 && k.evidence.every((e) => typeof e === 'string' && e.length > 5));
  assert.ok(k.evidence.some((e) => /title/.test(e)), 'says where it found the words');
  const weak = kindOf({ title: 'Morning routine', description: 'Some gentle moves.' });
  assert.ok(!weak || weak.confidence < 0.6, 'a vague video is not claimed with confidence');
  assert.equal(kindOf({ title: 'Untitled 7', description: '' }), null, 'no evidence, no label');
});

test('yoga mixed with Pilates says so; "stretch" words in a yoga video do not turn it into plain stretching', () => {
  const mix = kindOf({ title: 'Yoga Pilates fusion for core', description: 'Pilates roll up, teaser, plus warrior and downward dog.' });
  assert.match(mix.label, /\+/);
  const yoga = kindOf({ title: 'Yoga for tight hips: deep stretch and release', description: 'Stretching the hip flexors.' });
  assert.equal(yoga.discipline, 'yoga');
});

test('how it feels: pace, holds, intensity, position, props, guidance', () => {
  const yin = analyzeVideoText({ title: 'Yin yoga 30 min', description: 'Hold each pose for 3 minutes. Stay for 4 minutes in dragon.\nProps: block, bolster and a blanket.', tags: [], durationSec: 1800, level: null });
  assert.equal(yin.traits.pace, 'slow');
  assert.equal(yin.traits.intensity, 'gentle');
  assert.equal(yin.traits.hold.seconds, 180);
  assert.deepEqual([...yin.traits.props].sort(), ['blanket', 'block', 'bolster']);
  const flow = analyzeVideoText({ title: 'Power yoga flow, advanced', description: 'Sun salutations and warrior sequences.', tags: [], durationSec: 1500 });
  assert.equal(flow.traits.pace, 'flowing');
  assert.equal(flow.traits.intensity, 'challenging');
  const chair = analyzeVideoText({ title: 'Chair yoga for seniors', description: '', tags: [], durationSec: 900 });
  assert.equal(chair.traits.position, 'seated');
  assert.equal(chair.traits.intensity, 'gentle');
  const floor = analyzeVideoText({ title: 'Hips', description: 'Pigeon, figure four, butterfly, frog, happy baby and knees to chest.', tags: [], durationSec: 900 });
  assert.equal(floor.traits.position, 'mostly on the floor');
  assert.equal(analyzeVideoText({ title: 'Stretch, no props needed', description: 'No equipment needed.', tags: [], durationSec: 600 }).traits.noProps, true);
  assert.match(traitLine(yin.traits), /slow · gentle/);
});

test('guidance comes from a transcript that covers the video: words per minute', () => {
  const talky = Array.from({ length: 240 }, (_, i) => `@${i * 5} breathe in and slowly reach your arms up high now`).join('\n');
  const quiet = Array.from({ length: 6 }, (_, i) => `@${i * 100} namaste`).join('\n') + '\n' + 'ok '.repeat(80);
  const a = analyzeVideoText({ title: 'Yoga', description: '', tags: [], durationSec: 1200, transcript: talky });
  assert.ok(a.traits.guidance.wpm >= 80 && /talks you through/.test(a.traits.guidance.label));
  const b = analyzeVideoText({ title: 'Yoga', description: '', tags: [], durationSec: 1200, transcript: quiet });
  assert.match(b.traits.guidance.label, /quiet|some guidance/);
  assert.equal(analyzeVideoText({ title: 'Yoga', description: '', tags: [], durationSec: 1200 }).traits.guidance, null, 'no transcript, no claim');
});

test('what the teacher says counts: spoken cues and hold times', () => {
  const t = ['@10 welcome to this yin practice', '@60 we will hold each pose for three minutes', '@240 stay here for four minutes and let gravity do the work', '@480 soften and melt into it'].join('\n');
  const p = analyzeVideoText({ title: 'Evening practice', description: '', tags: [], durationSec: 1500, transcript: t });
  assert.equal(p.kind.type, 'yin');
  assert.ok(p.kind.evidence.some((e) => /transcript/.test(e)));
  assert.deepEqual(holdTimes('Hold for 30 seconds. hold each pose for 2 minutes, 45 seconds each side, stay for five breaths').sort((a, b) => a - b), [25, 30, 45, 120]);
  assert.deepEqual(holdTimes('hold for 3 days'), [], 'only seconds, minutes and breaths');
});

test('viewers\' comments add a little: "love this yin class"', () => {
  const v = { title: 'Evening practice', description: '', tags: [], durationSec: 1500 };
  const comments = Array.from({ length: 10 }, () => ({ text: 'best yin class ever, those long holds are perfect', likes: 3 }));
  const p = attachComments(v, comments).profile;
  assert.ok((p.styles.yin ?? 0) > 0.3 && p.kind?.discipline === 'yoga');
});

test('the old style scores still work for filters and ranking: yin, flow, restorative, strength, stretch, mobility', () => {
  assert.ok(analyzeVideoText({ title: 'Yin hips', description: '', tags: [] }).styles.yin >= 0.3);
  assert.ok(analyzeVideoText({ title: 'Morning flow', description: '', tags: [] }).styles.flow >= 0.3);
  assert.ok(analyzeVideoText({ title: 'Bedtime wind down', description: '', tags: [] }).styles.restorative >= 0.3);
  assert.ok(analyzeVideoText({ title: 'Glute strength', description: '', tags: [] }).styles.strength >= 0.3);
  assert.ok(analyzeVideoText({ title: 'Calf stretch', description: '', tags: [] }).styles.stretch >= 0.3);
  assert.ok(analyzeVideoText({ title: 'Hip mobility', description: '', tags: [] }).styles.mobility >= 0.3);
  for (const id of Object.keys(analyzeVideoText({ title: 'Yin yoga flow', description: '', tags: [] }).styles)) assert.ok(STYLE_BY_ID[id], `${id} is a known style`);
});

test('a correction is remembered, wins over the estimate, and survives re-analysis', () => {
  const s = freshState();
  const v = { id: 'abcdefghijk', title: 'Morning movement', description: 'Some hips and back.', tags: [], channel: 'Someone', durationSec: 600, verified: true, source: 'search', profile: null };
  v.profile = analyzeVideoText(v);
  s.videos[v.id] = v;
  assert.notEqual(s.videos[v.id].profile.kind?.id, 'wall_pilates');
  assert.equal(setStyleFix(s, v.id, 'wall_pilates'), true);
  assert.equal(s.styleFixes[v.id], 'wall_pilates');
  const k = s.videos[v.id].profile.kind;
  assert.equal(k.fixed, true); assert.equal(k.label, 'Wall Pilates'); assert.equal(k.confidence, 1);
  assert.ok(s.videos[v.id].profile.styles.wall_pilates === 1 && s.videos[v.id].profile.styles.pilates >= 0.9, 'it filters as that style');
  assert.equal(reanalyze(s.videos[v.id]).profile.kind.fixed, true, 'a later re-analysis keeps it');
  assert.equal(setStyleFix(s, v.id, 'not-a-style'), false);
  assert.equal(setStyleFix(s, v.id, null), true);
  assert.ok(!s.styleFixes[v.id] && !s.videos[v.id].profile.kind?.fixed, 'and it can be taken back');
  assert.ok(withFix(null, 'yin').fixed && stylesWithFix({}, 'hatha').yoga >= 0.9);
});

test('the style list is consistent: every style belongs to a known family, main chips are few', () => {
  const ids = new Set(STYLE_LIST.map((s) => s.id));
  assert.equal(ids.size, STYLE_LIST.length);
  for (const s of STYLE_LIST) assert.ok(ids.has(s.discipline), `${s.id} -> ${s.discipline}`);
  assert.ok(STYLE_LIST.filter((s) => s.main).length <= 9);
  assert.ok(ANALYSIS_VERSION >= 5, 'profiles are re-derived from stored text when the analysis changes');
});

test('speed: classifying 2000 videos takes well under a second per hundred', () => {
  const v = { title: 'Yin Yoga for Hips | 30 min deep hold', channel: 'Yoga With Ana', tags: ['yin', 'hips', 'yoga'], description: 'Hold each pose for 3 minutes. '.repeat(20), chapters: [{ t: 0, label: 'Intro' }, { t: 120, label: 'Dragon' }, { t: 400, label: 'Frog' }], poses: [{ id: 'dragon', count: 2 }, { id: 'frog', count: 1 }], durationSec: 1800 };
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) classifyStyle(v);
  assert.ok(performance.now() - t0 < 4000, `${Math.round(performance.now() - t0)} ms`);
});
