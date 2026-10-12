import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../lib/api.js';

var dir = mkdtempSync(join(tmpdir(), 'hub-'));
var api = createApi({ ACCESS_KEY: 'sesame', DATA_FILE: join(dir, 'db.json') });
var family = readFileSync(new URL('./fixtures/family.ics', import.meta.url), 'utf8');

async function call(method, path, body, key) {
  var res = await api(new Request('http://hub.test' + path, {
    method: method,
    headers: { 'x-hub-key': key === undefined ? 'sesame' : key, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }));
  return { status: res.status, body: await res.json() };
}

test('the household key is required', async function () {
  assert.equal((await call('GET', '/api/state?date=2026-10-12', null, 'wrong')).status, 401);
  assert.equal((await call('GET', '/api/health', null, '')).status, 200);
});

test('settings: validation, and calendar addresses never leave the server', async function () {
  var bad = await call('PUT', '/api/settings', { settings: { calendars: [{ name: 'X', url: 'http://evil.example/x.ics' }] } });
  assert.equal(bad.status, 400);

  var put = await call('PUT', '/api/settings', { settings: {
    familyName: 'Test', timezone: 'America/Chicago',
    people: [{ name: 'Ava', color: '#00A36C', stars: true }, { name: 'Dad', color: '#2F6BFF' }],
    calendars: [{ name: 'Family', url: 'webcal://calendar.google.com/secret/basic.ics', color: '#8A4DFF', person: 'ava' }]
  } });
  assert.equal(put.status, 200);
  assert.equal(JSON.stringify(put.body).indexOf('secret'), -1);

  var got = await call('GET', '/api/settings');
  assert.equal(got.body.settings.calendars[0].url, '••••••••');
  // Saving the masked value back keeps the real address.
  got.body.settings.calendars[0].name = 'Family (renamed)';
  await call('PUT', '/api/settings', { settings: got.body.settings });
  var stored = JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8'));
  assert.equal(stored.settings.calendars[0].url, 'https://calendar.google.com/secret/basic.ics');
  assert.equal(stored.settings.calendars[0].name, 'Family (renamed)');
});

test('to-dos: create, tick off with stars, undo, edit, delete', async function () {
  var created = await call('POST', '/api/tasks', { today: '2026-10-12', task: { title: 'Make bed', assignee: 'ava', stars: 2, schedule: { type: 'daily' } } });
  assert.equal(created.status, 201);
  var id = created.body.task.id;
  var once = await call('POST', '/api/tasks', { today: '2026-10-12', task: { title: 'Call plumber', assignee: 'nobody-by-that-id', schedule: { type: 'once', due: '2026-10-11' } } });
  assert.equal(once.body.task.assignee, 'any');

  assert.equal((await call('POST', '/api/tasks/' + id + '/done', { date: '2026-10-12' })).status, 200);
  var state = await call('GET', '/api/state?date=2026-10-12');
  var bed = state.body.tasks.filter(function (t) { return t.id === id; })[0];
  assert.equal(bed.done, true);
  assert.equal(bed.repeat, 'Every day');
  assert.equal(state.body.stars.ava, 2);
  assert.equal(state.body.tasks.filter(function (t) { return t.title === 'Call plumber'; })[0].overdue, true);

  // Tomorrow it's due again and not done.
  var tomorrow = await call('GET', '/api/state?date=2026-10-13');
  assert.equal(tomorrow.body.tasks.filter(function (t) { return t.id === id; })[0].done, false);

  await call('DELETE', '/api/tasks/' + id + '/done?date=2026-10-12');
  state = await call('GET', '/api/state?date=2026-10-12');
  assert.equal(state.body.stars.ava, undefined);

  var edited = await call('PUT', '/api/tasks/' + id, { today: '2026-10-12', task: { title: 'Make bed', assignee: 'ava', schedule: { type: 'weekly', days: [6] } } });
  assert.equal(edited.body.task.schedule.type, 'weekly');
  assert.equal((await call('DELETE', '/api/tasks/' + id)).status, 200);
  var all = await call('GET', '/api/tasks?today=2026-10-12');
  assert.equal(all.body.tasks.some(function (t) { return t.id === id; }), false);
  assert.equal((await call('POST', '/api/tasks', { today: '2026-10-12', task: { title: '  ' } })).status, 400);
});

test('events endpoint reports a broken feed instead of failing', async function () {
  var realFetch = globalThis.fetch;
  globalThis.fetch = async function () { return new Response(family, { status: 200 }); };
  try {
    var r = await call('GET', '/api/events?from=2026-10-11T00:00:00Z&to=2026-10-25T00:00:00Z');
    assert.equal(r.status, 200);
    assert.ok(r.body.events.length >= 5);
    assert.equal(r.body.status[0].ok, true);
    assert.equal((await call('GET', '/api/events?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z')).status, 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Vercel entry restores the original path from the rewrite', async function () {
  process.env.ACCESS_KEY = 'sesame';
  process.env.DATA_FILE = join(dir, 'vercel.json');
  var mod = await import('../api/index.js');
  var res = await mod.GET(new Request('http://hub.test/api/index?path=health'));
  assert.equal((await res.json()).ok, true);
  res = await mod.GET(new Request('http://hub.test/api/index?path=state&date=2026-10-12', { headers: { 'x-hub-key': 'sesame' } }));
  assert.equal(res.status, 200);
});
