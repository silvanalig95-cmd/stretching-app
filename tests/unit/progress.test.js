// The training log's numbers: totals, streaks, the weekly goal, the calendar, milestones, per-muscle progress, CSV.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, weekStart, sessionMinutes, totals, streaks, weekly, goalProgress, goalStreak, periods, monthGrid, milestones, areaProgress,
  encouragement, csvCell, historyCsv,
} from '../../js/progress.js';
import { freshState, logSession } from '../../js/state.js';
import { areaLabel } from '../../js/lexicon.js';

const TODAY = '2026-03-11';   // a Wednesday
let n = 0;
const rec = (date, extra = {}) => ({ id: `s${++n}`, at: `${date}T08:00:00.000Z`, date, videoId: extra.videoId ?? 'vvvvvvvvvv1', areas: [], ratings: {}, ...extra });
const days = (...ds) => ds.map((d) => rec(d));
const VIDEOS = { vvvvvvvvvv1: { id: 'vvvvvvvvvv1', title: 'Morning hips', channel: 'Calm', durationSec: 20 * 60 } };

test('dates: weeks start on Monday, day arithmetic survives month ends and daylight-saving changes', () => {
  assert.equal(weekStart('2026-03-11'), '2026-03-09');   // Wednesday -> Monday
  assert.equal(weekStart('2026-03-09'), '2026-03-09');
  assert.equal(weekStart('2026-03-15'), '2026-03-09');   // Sunday belongs to the week before Monday
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');  // EU clocks change that night
  assert.equal(addDays('2026-10-25', -1), '2026-10-24');
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
});

test('minutes: what was recorded when logged wins over the video\'s current length; unknown counts as zero', () => {
  assert.equal(sessionMinutes({ durationSec: 600, videoId: 'vvvvvvvvvv1' }, VIDEOS), 10);
  assert.equal(sessionMinutes({ videoId: 'vvvvvvvvvv1' }, VIDEOS), 20);
  assert.equal(sessionMinutes({ videoId: 'gone' }, VIDEOS), 0);
  const t = totals([rec('2026-03-01'), rec('2026-03-01'), rec('2026-03-09', { durationSec: 600 })], VIDEOS, TODAY);
  assert.deepEqual({ s: t.sessions, m: t.minutes, d: t.activeDays, since: t.since }, { s: 3, m: 50, d: 2, since: '2026-03-01' });
  assert.equal(t.perWeek, 1, '3 routines over the 3 calendar weeks since the first one (Sunday 1 March belongs to the week of 23 Feb)');
  assert.deepEqual(totals([], VIDEOS, TODAY), { sessions: 0, minutes: 0, activeDays: 0, since: null, perWeek: 0 });
});

test('streaks: today not being done yet does not break it, a missed day does, best is remembered, same-day repeats count once', () => {
  assert.equal(streaks(days('2026-03-09', '2026-03-10'), TODAY).current, 2, 'done through yesterday');
  assert.equal(streaks(days('2026-03-09', '2026-03-10', '2026-03-11'), TODAY).current, 3);
  assert.equal(streaks(days('2026-03-08', '2026-03-09'), TODAY).current, 0, 'nothing yesterday or today: broken');
  const s = streaks([...days('2026-02-01', '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-04'), ...days('2026-03-10', '2026-03-11')], TODAY);
  assert.deepEqual({ cur: s.current, best: s.best, last: s.lastDay, since: s.daysSince }, { cur: 2, best: 4, last: '2026-03-11', since: 0 });
  assert.equal(streaks(days('2026-03-12', '2026-04-01'), TODAY).best, 0, 'entries dated in the future are ignored');
  assert.deepEqual(streaks([], TODAY), { current: 0, best: 0, lastDay: null, daysSince: null });
  assert.equal(streaks([{ date: 'yesterday' }, { date: undefined }], TODAY).best, 0, 'malformed dates are ignored, not fatal');
});

test('weeks: the last 12 weeks, Monday to Sunday, oldest first', () => {
  const w = weekly([rec('2026-03-08'), rec('2026-03-09'), rec('2026-03-09'), rec('2026-03-11')], VIDEOS, { today: TODAY, weeks: 12 });
  assert.equal(w.length, 12);
  assert.equal(w.at(-1).start, '2026-03-09');
  assert.deepEqual({ s: w.at(-1).sessions, d: w.at(-1).days, m: w.at(-1).minutes }, { s: 3, d: 2, m: 60 });
  assert.equal(w.at(-2).sessions, 1, 'Sunday the 8th belongs to the previous week');
  assert.equal(w[0].start, '2025-12-22');
});

test('weekly goal: progress this week, and consecutive weeks at the goal where the week in progress never breaks the run', () => {
  const g = goalProgress(days('2026-03-09', '2026-03-10'), 3, TODAY);
  assert.deepEqual({ done: g.done, rem: g.remaining, met: g.met, left: g.daysLeft, ok: g.onTrack }, { done: 2, rem: 1, met: false, left: 5, ok: true });
  assert.equal(goalProgress(days('2026-03-09', '2026-03-10', '2026-03-11'), 3, TODAY).met, true);
  assert.equal(goalProgress([], 5, TODAY).onTrack, true, '5 more in the 5 days left is still possible');
  assert.equal(goalProgress([], 7, TODAY).onTrack, false);
  assert.equal(goalProgress([], 7, '2026-03-15').onTrack, false, 'on Sunday 7 is out of reach');
  assert.equal(goalProgress([], 0, TODAY).met, false, 'no goal, never "met"');

  const hist = [
    ...days('2026-02-09', '2026-02-10', '2026-02-11'),      // week 1: met
    ...days('2026-02-16', '2026-02-17', '2026-02-18'),      // week 2: met
    ...days('2026-02-23'),                                  // week 3: missed
    ...days('2026-03-02', '2026-03-03', '2026-03-04'),      // week 4: met
  ];
  assert.deepEqual(goalStreak(hist, 3, TODAY), { current: 1, best: 2 }, 'this week has nothing yet, but that does not erase last week');
  assert.deepEqual(goalStreak([...hist, ...days('2026-03-09', '2026-03-10', '2026-03-11')], 3, TODAY), { current: 2, best: 2 });
  assert.equal(goalStreak(hist, 0, TODAY), null);
  assert.deepEqual(goalStreak([], 3, TODAY), { current: 0, best: 0 });
});

test('this week and this month against the one before', () => {
  const p = periods([...days('2026-02-10', '2026-02-20', '2026-03-02'), rec('2026-03-10')], VIDEOS, TODAY);
  assert.equal(p.month.now.sessions, 2);
  assert.equal(p.month.before.sessions, 2);
  assert.equal(p.week.now.sessions, 1);
  assert.equal(p.week.before.sessions, 1);
  assert.equal(p.week.now.minutes, 20);
});

test('calendar: Monday-first weeks that cover the month, with your routines on their days', () => {
  const weeks = monthGrid(2026, 2, [rec('2026-03-10', { title: 'Morning hips' }), rec('2026-03-10'), rec('2026-03-02')], VIDEOS, TODAY);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(weeks[0][0].date, '2026-02-23', 'March 2026 starts on a Sunday, so the first row starts the Monday before');
  assert.equal(weeks[0][0].inMonth, false);
  const flat = weeks.flat();
  const d10 = flat.find((c) => c.date === '2026-03-10');
  assert.deepEqual({ s: d10.sessions, m: d10.minutes, t: d10.titles[0] }, { s: 2, m: 40, t: 'Morning hips' });
  assert.equal(flat.find((c) => c.date === '2026-03-11').today, true);
  assert.equal(flat.find((c) => c.date === '2026-03-12').future, true);
  assert.equal(flat.filter((c) => c.inMonth).length, 31);
  assert.equal(flat.at(-1).date, '2026-04-05', 'ends on the Sunday after the 31st');
});

test('milestones are dated by when you actually reached them, and the next ones show how far away they are', () => {
  const hist = [...days('2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07'), rec('2026-03-09'), rec('2026-03-10')];
  const { earned, next } = milestones(hist, VIDEOS, TODAY);
  const on = (id) => earned.find((m) => m.id === id)?.date;
  assert.equal(on('routines:1'), '2026-03-01');
  assert.equal(on('routines:5'), '2026-03-05');
  assert.equal(on('routines:10'), undefined, 'only 9 so far');
  assert.equal(on('streak:3'), '2026-03-03');
  assert.equal(on('streak:7'), '2026-03-07', 'reached on the seventh day, not later');
  assert.equal(on('streak:14'), undefined);
  assert.equal(on('hours:1'), '2026-03-03', 'the third 20-minute routine passes one hour');
  assert.equal(on('hours:5'), undefined);
  assert.equal(on('weeks:2'), '2026-03-02', 'the second calendar week with a routine (1 March is a Sunday)');
  assert.equal(on('weeks:4'), undefined);
  assert.ok(earned.every((m, i) => i === 0 || earned[i - 1].date >= m.date), 'newest first');
  const r10 = next.find((m) => m.id === 'routines:10');
  assert.deepEqual({ have: r10.have, need: r10.need }, { have: 9, need: 10 });
  assert.ok(next.length <= 3);
  assert.ok(next[0].have / next[0].need >= next.at(-1).have / next.at(-1).need, 'closest first');
  assert.deepEqual(milestones([], VIDEOS, TODAY).earned, []);
  const felt = milestones([rec('2026-03-02', { ratings: { hips: 'much', hamstrings: 'some' } })], VIDEOS, TODAY).earned;
  assert.ok(felt.some((m) => m.id === 'felt:1'));
  assert.ok(felt.some((m) => m.id === 'areas:3') === false);
});

test('progress by muscle: needs six answers to call a trend, compares your first answers with your latest, rolls specific areas up', () => {
  const ratings = ['none', 'none', 'some', 'some', 'much', 'much', 'much'];
  const hist = ratings.map((r, i) => rec(addDays('2026-03-01', i), { areas: [{ id: 'hamstrings', mode: 'tight' }], ratings: { hamstrings: r } }));
  const ap = areaProgress(hist, { today: TODAY });
  const ham = ap.find((a) => a.area === 'hamstrings');
  assert.equal(ham.sessions, 7);
  assert.equal(ham.trend, 'up');
  assert.ok(ham.recent > ham.early);
  const few = areaProgress(hist.slice(0, 4), { today: TODAY }).find((a) => a.area === 'hamstrings');
  assert.equal(few.trend, null, 'four answers is too few to call');
  assert.equal(few.answers, 4);
  const down = areaProgress(ratings.slice().reverse().map((r, i) => rec(addDays('2026-03-01', i), { ratings: { hamstrings: r } })), { today: TODAY }).find((a) => a.area === 'hamstrings');
  assert.equal(down.trend, 'down');
  const rolled = areaProgress([rec('2026-03-02', { areas: [{ id: 'abs_lower', mode: 'weak' }], ratings: { abs_lower: 'much' } })], { today: TODAY });
  assert.ok(rolled.some((a) => a.area === 'abs_lower') && rolled.some((a) => a.area === 'core'), 'lower abs also counts for core');
  assert.equal(rolled.find((a) => a.area === 'core').helped, 1);
});

test('encouragement says only things that are true of your log', () => {
  assert.match(encouragement([], VIDEOS, { goal: 3, today: TODAY })[0], /first routine/i);
  const met = encouragement(days('2026-03-09', '2026-03-10', '2026-03-11'), VIDEOS, { goal: 3, today: TODAY });
  assert.match(met[0], /goal reached: 3 of 3/i);
  assert.ok(met.some((l) => /3 days in a row/.test(l)));
  const short = encouragement(days('2026-03-10'), VIDEOS, { goal: 3, today: TODAY });
  assert.match(short[0], /2 more routines.*1 of 3.*5 days left/);
  const lapsed = encouragement(days('2026-03-05'), VIDEOS, { goal: 3, today: TODAY });
  assert.ok(lapsed.some((l) => /6 days/.test(l)));
  const lost = encouragement(days('2026-03-10'), VIDEOS, { goal: 7, today: '2026-03-15' });
  assert.match(lost[0], /out of reach/);
  assert.ok(encouragement(days('2026-03-10'), VIDEOS, { goal: 0, today: TODAY }).every((l) => !/goal/i.test(l)), 'no goal, no goal talk');
});

test('CSV: quoted when needed, spreadsheet formulas defused, Excel-friendly', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a, b'), '"a, b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell('=HYPERLINK("http://evil")'), '"\'=HYPERLINK(""http://evil"")"');
  assert.equal(csvCell('-5'), "'-5");
  assert.equal(csvCell(null), '');
  const csv = historyCsv([rec('2026-03-02', { title: '=cmd', note: 'felt, "great"', ratings: { hamstrings: 'much' }, areas: [{ id: 'hamstrings', mode: 'tight' }], intensity: 'right' }), rec('2026-03-01')], VIDEOS);
  assert.ok(csv.startsWith('﻿date,title,channel,minutes'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('2026-03-01,Morning hips,Calm,20,'), 'oldest first, title from the video when the entry has none');
  assert.ok(lines[2].includes("'=cmd") && lines[2].includes('"felt, ""great"""') && lines[2].includes(`${areaLabel('hamstrings')}: much`), lines[2]);
});

test('logging a routine records its minutes; an earlier day is allowed, a future or malformed one becomes today', () => {
  const s = freshState();
  s.videos.vvvvvvvvvv1 = { id: 'vvvvvvvvvv1', title: 'Morning hips', channel: 'Calm', durationSec: 1200 };
  const earlier = logSession(s, { videoId: 'vvvvvvvvvv1', date: '2020-01-02' });
  assert.equal(earlier.date, '2020-01-02');
  assert.equal(earlier.durationSec, 1200);
  const today = new Date(); const p = (x) => String(x).padStart(2, '0'); const ymd = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  for (const bad of ['2999-01-01', 'yesterday', '', null, 5]) assert.equal(logSession(s, { videoId: 'vvvvvvvvvv1', date: bad }).date, ymd, String(bad));
  s.videos.vvvvvvvvvv1.durationSec = 60;
  assert.equal(sessionMinutes(earlier, s.videos), 20, 'later changes to the video do not rewrite your log');
});
