import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandIcs, mergeEvents, loadCalendars, wallTimeToUtc, normaliseFeedUrl } from '../lib/calendar.js';

var family = readFileSync(new URL('./fixtures/family.ics', import.meta.url), 'utf8');
var work = readFileSync(new URL('./fixtures/work.ics', import.meta.url), 'utf8');
var from = Date.parse('2026-10-11T00:00:00Z'), to = Date.parse('2026-10-25T00:00:00Z');

test('wall time conversion handles DST on both sides', function () {
  assert.equal(new Date(wallTimeToUtc(2026, 10, 31, 9, 0, 0, 'America/Chicago')).toISOString(), '2026-10-31T14:00:00.000Z');
  assert.equal(new Date(wallTimeToUtc(2026, 11, 2, 9, 0, 0, 'America/Chicago')).toISOString(), '2026-11-02T15:00:00.000Z');
});

test('expands weekly rule with EXDATE and a moved instance', function () {
  var evs = expandIcs(family, { id: 'fam' }, from, to);
  var soccer = evs.filter(function (e) { return /Soccer/.test(e.title); }).map(function (e) { return e.start + ' ' + e.title; }).sort();
  assert.deepEqual(soccer, [
    '2026-10-12T21:30:00.000Z Soccer practice',
    // Oct 15 is excluded by EXDATE
    '2026-10-19T22:00:00.000Z Soccer practice (moved)',
    '2026-10-22T21:30:00.000Z Soccer practice'
  ]);
});

test('all-day, UTC, other-zone and cancelled events', function () {
  var evs = expandIcs(family, { id: 'fam' }, from, to);
  var byTitle = {};
  evs.forEach(function (e) { byTitle[e.title] = e; });
  assert.deepEqual([byTitle['No school'].allDay, byTitle['No school'].start, byTitle['No school'].end], [true, '2026-10-12', '2026-10-13']);
  assert.equal(byTitle.Dentist.start, '2026-10-13T14:00:00.000Z');
  assert.equal(byTitle.Dentist.notes, 'Bring insurance card');
  assert.equal(byTitle['Call with NY office'].start, '2026-10-14T13:00:00.000Z');
  assert.equal(byTitle['Cancelled thing'], undefined);
});

test('daily series keeps wall time across the DST change', function () {
  var evs = expandIcs(work, { id: 'work' }, Date.parse('2026-10-30T00:00:00Z'), Date.parse('2026-11-05T00:00:00Z'));
  assert.deepEqual(evs.filter(function (e) { return e.title === 'Across DST'; }).map(function (e) { return e.start; }),
    ['2026-10-31T14:00:00.000Z', '2026-11-01T15:00:00.000Z', '2026-11-02T15:00:00.000Z']);
});

test('the same invite on two calendars merges into one event', function () {
  var merged = mergeEvents([expandIcs(family, { id: 'fam' }, from, to), expandIcs(work, { id: 'work' }, from, to)]);
  var dentist = merged.filter(function (e) { return e.title === 'Dentist'; });
  assert.equal(dentist.length, 1);
  assert.deepEqual(dentist[0].cals, ['fam', 'work']);
  for (var i = 1; i < merged.length; i++) assert.ok(merged[i - 1].start <= merged[i].start);
});

test('one bad feed reports an error without hiding the others', async function () {
  var fakeFetch = async function (url) {
    if (url.indexOf('good') > -1) return new Response(family, { status: 200 });
    return new Response('nope', { status: 404 });
  };
  var r = await loadCalendars([{ id: 'a', url: 'https://x/good.ics' }, { id: 'b', url: 'webcal://x/bad.ics' }], from, to, 'America/Chicago', fakeFetch);
  assert.ok(r.events.length > 0);
  var b = r.status.filter(function (s) { return s.id === 'b'; })[0];
  assert.equal(b.ok, false);
  assert.match(b.error, /404/);
});

test('feed URLs', function () {
  assert.equal(normaliseFeedUrl('webcal://calendar.google.com/x.ics'), 'https://calendar.google.com/x.ics');
  assert.throws(function () { normaliseFeedUrl('http://insecure/x.ics'); });
});
