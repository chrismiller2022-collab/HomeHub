import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDueOn, nextDue, tasksForDate, cleanSchedule, describeSchedule, starTotals, parseDate } from '../lib/schedule.js';

function dueDays(s, from, n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var d = new Date(parseDate(from) + i * 864e5).toISOString().slice(0, 10);
    if (isDueOn(s, d)) out.push(d);
  }
  return out;
}

test('daily every 2 days', function () {
  assert.deepEqual(dueDays({ type: 'daily', every: 2, start: '2026-10-12' }, '2026-10-10', 7), ['2026-10-12', '2026-10-14', '2026-10-16']);
});

test('weekly on Mon/Thu, and every other week', function () {
  assert.deepEqual(dueDays({ type: 'weekly', every: 1, days: [1, 4], start: '2026-10-12' }, '2026-10-12', 10), ['2026-10-12', '2026-10-15', '2026-10-19']);
  // Every 2 weeks on Saturday starting Mon 12 Oct: first Sat is the 17th, then the 31st.
  assert.deepEqual(dueDays({ type: 'weekly', every: 2, days: [6], start: '2026-10-12' }, '2026-10-12', 21), ['2026-10-17', '2026-10-31']);
});

test('monthly on the 31st falls back to the last day; -1 means last day', function () {
  var s = { type: 'monthly', every: 1, day: 31, start: '2026-01-01' };
  assert.equal(isDueOn(s, '2026-02-28'), true);
  assert.equal(isDueOn(s, '2026-04-30'), true);
  assert.equal(isDueOn(s, '2026-05-31'), true);
  assert.equal(isDueOn({ type: 'monthly', every: 3, day: -1, start: '2026-01-15' }, '2026-04-30'), true);
  assert.equal(isDueOn({ type: 'monthly', every: 3, day: -1, start: '2026-01-15' }, '2026-03-31'), false);
});

test('yearly on Feb 29 uses Feb 28 in common years', function () {
  var s = { type: 'yearly', start: '2028-02-29' };
  assert.equal(isDueOn(s, '2029-02-28'), true);
  assert.equal(isDueOn(s, '2032-02-29'), true);
  assert.equal(isDueOn(s, '2032-02-28'), false);
});

test('until and start bounds', function () {
  var s = { type: 'daily', every: 1, start: '2026-10-12', until: '2026-10-13' };
  assert.deepEqual(dueDays(s, '2026-10-10', 6), ['2026-10-12', '2026-10-13']);
  assert.equal(nextDue({ type: 'weekly', every: 1, days: [0], start: '2026-10-12' }, '2026-10-12'), '2026-10-18');
});

test('tasksForDate: recurring, one-time, overdue, finished today', function () {
  var tasks = [
    { id: 'a', title: 'Feed dog', assignee: 'any', schedule: { type: 'daily', every: 1, start: '2026-10-01' } },
    { id: 'b', title: 'Trash', assignee: 'dad', schedule: { type: 'weekly', every: 1, days: [3], start: '2026-10-01' } },
    { id: 'c', title: 'Renew passport', assignee: 'mom', schedule: { type: 'once', due: '2026-10-10' } },
    { id: 'd', title: 'Call plumber', assignee: 'dad', schedule: { type: 'once' } },
    { id: 'e', title: 'Old errand', assignee: 'dad', schedule: { type: 'once' } },
    { id: 'f', title: 'Far off', assignee: 'dad', schedule: { type: 'once', due: '2026-12-25' } },
    { id: 'g', title: 'Archived', assignee: 'dad', archived: true, schedule: { type: 'daily', every: 1, start: '2026-10-01' } }
  ];
  var completions = [
    { task_id: 'a', occ: '2026-10-11', done_by: 'kid', day: '2026-10-11' }, // yesterday's, not today's
    { task_id: 'd', occ: 'once', done_by: 'dad', day: '2026-10-12' },
    { task_id: 'e', occ: 'once', done_by: 'dad', day: '2026-10-01' }
  ];
  var list = tasksForDate(tasks, completions, '2026-10-12', { upcomingDays: 14 });
  var ids = list.map(function (t) { return t.id; });
  assert.deepEqual(ids.slice().sort(), ['a', 'c', 'd']); // Trash is Wednesdays; e finished earlier; f too far out
  var c = list.filter(function (t) { return t.id === 'c'; })[0];
  assert.equal(c.overdue, true);
  assert.equal(list[list.length - 1].id, 'd'); // done items sort last
  assert.equal(list.filter(function (t) { return t.id === 'a'; })[0].done, false);
});

test('cleanSchedule validates and fills defaults', function () {
  assert.deepEqual(cleanSchedule({ type: 'weekly', days: [5, 1, 1, 9] }, '2026-10-12'), { type: 'weekly', every: 1, start: '2026-10-12', days: [1, 5] });
  assert.deepEqual(cleanSchedule({ type: 'monthly' }, '2026-10-12'), { type: 'monthly', every: 1, start: '2026-10-12', day: 12 });
  assert.throws(function () { cleanSchedule({ type: 'once', due: '2026-02-31' }); });
  assert.throws(function () { cleanSchedule({ type: 'hourly' }); });
});

test('describeSchedule', function () {
  assert.equal(describeSchedule({ type: 'weekly', every: 1, days: [1, 2, 3, 4, 5] }), 'Every weekday');
  assert.equal(describeSchedule({ type: 'weekly', every: 2, days: [6] }), 'Every 2 weeks on Sat');
  assert.equal(describeSchedule({ type: 'monthly', every: 1, day: -1 }), 'Monthly on the last day');
  assert.equal(describeSchedule({ type: 'monthly', every: 1, day: 22 }), 'Monthly on the 22nd');
  assert.equal(describeSchedule({ type: 'once', due: '2026-10-16' }), 'Due Fri, Oct 16');
});

test('starTotals', function () {
  assert.deepEqual(starTotals([{ done_by: 'kid', stars: 2 }, { done_by: 'kid', stars: 1 }, { done_by: 'dad', stars: 0 }]), { kid: 3 });
});
