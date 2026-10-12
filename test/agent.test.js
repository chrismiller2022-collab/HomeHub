// The meal-planning assistant's loop, with a scripted stand-in for the Claude API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.js';
import { converse } from '../lib/agent.js';

function scripted(turns) {
  var calls = [];
  return {
    calls: calls,
    beta: { messages: { create: async function (req) {
      calls.push(JSON.parse(JSON.stringify(req)));
      var t = turns.shift();
      if (!t) throw new Error('no more scripted turns');
      return t;
    } } }
  };
}
var RECIPE_HTML = '<script type="application/ld+json">{"@type":"Recipe","name":"Sheet-pan fajitas","recipeIngredient":["1 lb chicken","2 bell peppers","8 tortillas"]}</script>';
async function fakeFetch(url) { return new Response(RECIPE_HTML, { status: 200 }); }

test('link -> asks a question; answer -> meal planned and groceries added; history kept', async function () {
  var store = createStore({ DATA_FILE: join(mkdtempSync(join(tmpdir(), 'hub-agent-')), 'db.json') });
  var settings = await store.getSettings();
  var base = { store: store, settings: settings, env: { ANTHROPIC_API_KEY: 'x' }, convId: 'sms:+15551234567', personId: 'mom', personName: 'Mom', channel: 'sms', today: '2026-10-12', fetchImpl: fakeFetch };

  var c1 = scripted([
    { stop_reason: 'tool_use', content: [
      { type: 'thinking', thinking: '', signature: 'sig1' },
      { type: 'tool_use', id: 't1', name: 'read_recipe', input: { url: 'https://food.test/fajitas' } },
      { type: 'tool_use', id: 't2', name: 'get_meal_plan', input: { start_date: '2026-10-12', end_date: '2026-10-18' } }
    ] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sheet-pan fajitas! Monday–Sunday dinners are open. Which night? Do you have chicken, peppers or tortillas?' }] }
  ]);
  var r1 = await converse('https://food.test/fajitas', Object.assign({ client: c1 }, base));
  assert.match(r1, /Which night/);
  var req = c1.calls[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.output_config.effort, 'low');
  assert.match(req.messages[0].content[0].text, /^\[Today is Monday, October 12, 2026 \(2026-10-12\)\. From: Mom, by text message\.\]/);
  // Tool results went back in one user message, parallel calls together.
  var results = c1.calls[1].messages[2].content;
  assert.deepEqual(results.map(function (r) { return r.tool_use_id; }), ['t1', 't2']);
  assert.equal(JSON.parse(results[0].content).title, 'Sheet-pan fajitas');
  assert.equal(JSON.parse(results[1].content).days.length, 7);

  var c2 = scripted([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't3', name: 'add_meal', input: { date: '2026-10-15', slot: 'dinner', title: 'Sheet-pan fajitas', recipe_url: 'https://food.test/fajitas' } }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't4', name: 'add_to_grocery_list', input: { items: [{ name: 'Bell peppers', qty: '2' }, { name: 'Tortillas' }] } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done: fajitas Thursday. Added bell peppers and tortillas.' }] }
  ]);
  var r2 = await converse('Thursday. We have chicken.', Object.assign({ client: c2 }, base));
  assert.match(r2, /Thursday/);
  // The second message continued the same conversation, thinking block echoed back unchanged.
  var hist = c2.calls[0].messages;
  assert.equal(hist.length, 5);
  assert.deepEqual(hist[1].content[0], { type: 'thinking', thinking: '', signature: 'sig1' });
  var meals = await store.list('meals', {});
  assert.deepEqual(meals.map(function (m) { return [m.date, m.slot, m.title, m.created_by]; }), [['2026-10-15', 'dinner', 'Sheet-pan fajitas', 'mom']]);
  assert.deepEqual((await store.list('groceries', {})).map(function (g) { return g.name; }), ['Bell peppers', 'Tortillas']);
});

test('tool errors go back to the model; refusals get a polite reply; stale conversations restart', async function () {
  var store = createStore({ DATA_FILE: join(mkdtempSync(join(tmpdir(), 'hub-agent2-')), 'db.json') });
  var settings = await store.getSettings();
  var base = { store: store, settings: settings, env: { ANTHROPIC_API_KEY: 'x' }, convId: 'app:dad', personName: 'Dad', channel: 'app', today: '2026-10-12' };
  var c = scripted([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'e1', name: 'add_meal', input: { date: 'someday', slot: 'dinner', title: 'Soup' } }] },
    { stop_reason: 'refusal', content: [] }
  ]);
  var r = await converse('soup', Object.assign({ client: c }, base));
  assert.match(r, /can’t help/);
  var errResult = c.calls[1].messages[2].content[0];
  assert.equal(errResult.is_error, true);
  assert.match(errResult.content, /YYYY-MM-DD/);

  // Make the saved conversation look old: the next message starts fresh.
  await store.update('conversations', { id: 'app:dad' }, { updated_at: new Date(Date.now() - 9 * 3600e3).toISOString() });
  var c3 = scripted([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi!' }] }]);
  await converse('hello', Object.assign({ client: c3 }, base));
  assert.equal(c3.calls[0].messages.length, 1);
});

test('a run that never finishes is not saved half-done', async function () {
  var store = createStore({ DATA_FILE: join(mkdtempSync(join(tmpdir(), 'hub-agent3-')), 'db.json') });
  var settings = await store.getSettings();
  var loop = [];
  for (var i = 0; i < 12; i++) loop.push({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'l' + i, name: 'get_grocery_list', input: {} }] });
  var r = await converse('list?', { store: store, settings: settings, env: { ANTHROPIC_API_KEY: 'x' }, convId: 'app:x', channel: 'app', today: '2026-10-12', client: scripted(loop) });
  assert.match(r, /stuck/);
  assert.equal((await store.list('conversations', {})).length, 0);
});
