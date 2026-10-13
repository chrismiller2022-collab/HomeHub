import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summariseSchedule, loadTeams } from '../lib/sports.js';

var auburn = JSON.parse(readFileSync(new URL('./fixtures/espn-auburn.json', import.meta.url), 'utf8'));
var NOW = Date.parse('2026-10-13T12:00:00Z');

test('summarises record, last result and next game', function () {
  var s = summariseSchedule(auburn, 'college-football', NOW);
  assert.equal(s.team.short, 'Auburn');
  assert.equal(s.team.record, '3-2');
  assert.equal(s.team.standing, '11th in SEC');
  assert.equal(s.team.color, '#002b5c');
  assert.deepEqual([s.last.result, s.last.us, s.last.them, s.last.opponent.abbr, s.last.home], ['L', '14', '24', 'TENN', false]);
  assert.equal(s.next.opponent.abbr, 'UGA');
  assert.equal(s.next.home, false);
  assert.equal(s.next.timeKnown, true);
  assert.deepEqual(s.next.tv, ['ESPN']);
  assert.equal(s.live, null);
  // Later games without a kickoff time are flagged so the tile says "time TBD".
  assert.equal(s.upcoming.filter(function (g) { return g.opponent.abbr === 'ARK'; })[0].timeKnown, false);
});

test('a game in progress shows as live', function () {
  var copy = JSON.parse(JSON.stringify(auburn));
  var g = copy.events.filter(function (e) { return e.date.indexOf('2026-10-17') === 0; })[0];
  g.competitions[0].status.type = { state: 'in', shortDetail: '3rd 5:12' };
  g.competitions[0].competitors.forEach(function (c, i) { c.score = { displayValue: i ? '17' : '21' }; });
  var s = summariseSchedule(copy, 'college-football', Date.parse('2026-10-17T21:00:00Z'));
  assert.equal(s.live.detail, '3rd 5:12');
  assert.ok(s.live.us && s.live.them);
});

test('ESPN outage keeps the last good data, or reports an error', async function () {
  var calls = 0;
  var ok = async function () { calls++; return new Response(JSON.stringify(auburn), { status: 200 }); };
  var down = async function () { return new Response('no', { status: 503 }); };
  var t = [{ league: 'college-football', id: 'fixture-1', name: 'Auburn' }];
  var a = await loadTeams(t, ok, NOW);
  assert.equal(a[0].team.record, '3-2');
  var b = await loadTeams(t, down, NOW + 3600e3); // cache expired, ESPN down: last good data
  assert.equal(b[0].team.record, '3-2');
  var c = await loadTeams([{ league: 'college-football', id: 'fixture-2', name: 'Tennessee' }], down, NOW);
  assert.match(c[0].error, /503/);
  assert.equal(c[0].team.short, 'Tennessee');
});
