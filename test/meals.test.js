import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createApi } from '../lib/api.js';
import { parseRecipeHtml, safeRecipeUrl } from '../lib/recipes.js';
import { validTwilioSignature, normalisePhone, splitForSms } from '../lib/sms.js';

var dir = mkdtempSync(join(tmpdir(), 'hub-meals-'));
var env = { ACCESS_KEY: 'k', DATA_FILE: join(dir, 'db.json') };
var api = createApi(env);
async function call(method, path, body, headers) {
  var res = await api(new Request('http://hub.test' + path, {
    method: method,
    headers: Object.assign({ 'x-hub-key': 'k', 'content-type': 'application/json' }, headers || {}),
    body: body ? JSON.stringify(body) : undefined
  }));
  return { status: res.status, body: await res.json().catch(function () { return null; }) };
}

test('setup people and rewards', async function () {
  var r = await call('PUT', '/api/settings', { settings: {
    people: [{ name: 'Mom', color: '#E4007C', phone: '(555) 123-4567' }, { name: 'Ava', color: '#00A36C', stars: true }],
    rewards: [{ title: 'Movie night', stars: 3, emoji: '🍿' }],
    mealSlots: ['dinner', 'lunch', 'bogus'],
    groceryReminder: { enabled: true, day: 4, people: ['mom', 'ghost'] }
  } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.settings.mealSlots, ['dinner', 'lunch']);
  assert.deepEqual(r.body.settings.groceryReminder, { enabled: true, day: 4, people: ['mom'] });
  assert.equal(JSON.stringify(r.body).indexOf('555'), -1); // phone never sent to screens
  var s = await call('GET', '/api/settings');
  assert.equal(s.body.settings.people[0].phone, '••••••••');
  assert.equal(s.body.settings.parentPinHash, undefined);
  // Saving the masked phone back keeps it.
  await call('PUT', '/api/settings', { settings: s.body.settings });
  var bad = await call('PUT', '/api/settings', { settings: { people: [{ name: 'X', phone: '12' }] } });
  assert.equal(bad.status, 400);
});

test('meals: add, list, move, delete; validation', async function () {
  var a = await call('POST', '/api/meals', { meal: { date: '2026-10-15', slot: 'dinner', title: 'Tacos', ingredients: ['tortillas', 'beef'] } }, { 'x-hub-person': 'mom' });
  assert.equal(a.status, 201);
  assert.equal(a.body.meal.created_by, 'mom');
  assert.equal((await call('POST', '/api/meals', { meal: { date: '2026-02-31', title: 'x' } })).status, 400);
  assert.equal((await call('POST', '/api/meals', { meal: { date: '2026-10-15', slot: 'brunch', title: 'x' } })).status, 400);
  var moved = await call('PUT', '/api/meals/' + a.body.meal.id, { meal: { date: '2026-10-16' } });
  assert.equal(moved.body.meal.date, '2026-10-16');
  assert.equal(moved.body.meal.title, 'Tacos');
  var list = await call('GET', '/api/meals?from=2026-10-12&to=2026-10-18');
  assert.equal(list.body.meals.length, 1);
  await call('DELETE', '/api/meals/' + a.body.meal.id);
  assert.equal((await call('GET', '/api/meals?from=2026-10-12&to=2026-10-18')).body.meals.length, 0);
});

test('groceries: de-duplicates, ticks off, clears', async function () {
  var r = await call('POST', '/api/groceries', { items: [{ name: 'Milk', qty: '1 gal' }, 'Eggs', 'milk!'] });
  assert.deepEqual(r.body.added.map(function (g) { return g.name; }), ['Milk', 'Eggs']);
  assert.deepEqual(r.body.already_on_list, ['milk!']);
  var milk = r.body.added[0];
  await call('PUT', '/api/groceries/' + milk.id, { done: true });
  var list = await call('GET', '/api/groceries');
  assert.equal(list.body.items.filter(function (g) { return g.done; }).length, 1); // recently ticked still shown
  await call('DELETE', '/api/groceries?done=1');
  list = await call('GET', '/api/groceries');
  assert.deepEqual(list.body.items.map(function (g) { return g.name; }), ['Eggs']);
  var state = await call('GET', '/api/state?date=2026-10-12');
  assert.equal(state.body.groceryCount, 1);
});

test('stars: periods, rewards and balance', async function () {
  var t = await call('POST', '/api/tasks', { today: '2026-10-12', task: { title: 'Make bed', assignee: 'ava', stars: 2, schedule: { type: 'daily' } } });
  var id = t.body.task.id;
  await call('POST', '/api/tasks/' + id + '/done', { date: '2026-10-12' });
  await call('POST', '/api/tasks/' + id + '/done', { date: '2026-10-13' });
  var st = await call('GET', '/api/state?date=2026-10-13');
  assert.deepEqual(st.body.starDetail.ava, { today: 2, week: 4, month: 4, total: 4, spent: 0, balance: 4 });
  var red = await call('POST', '/api/redeem', { person: 'ava', reward: 'movie-night' });
  assert.equal(red.body.balance, 1);
  assert.equal((await call('POST', '/api/redeem', { person: 'ava', reward: 'movie-night' })).status, 400); // not enough left
  st = await call('GET', '/api/state?date=2026-10-13');
  assert.equal(st.body.stars.ava, 1);
});

test('parent PIN: set, check, change, remove', async function () {
  assert.equal((await call('POST', '/api/pin', { pin: '' })).body.ok, true); // no PIN yet: open
  assert.equal((await call('PUT', '/api/pin', { pin: '12' })).status, 400);
  assert.equal((await call('PUT', '/api/pin', { pin: '2468' })).status, 200);
  assert.equal((await call('GET', '/api/state?date=2026-10-12')).body.settings.hasPin, true);
  assert.equal((await call('POST', '/api/pin', { pin: '2468' })).status, 200);
  assert.equal((await call('POST', '/api/pin', { pin: '1111' })).status, 403);
  assert.equal((await call('PUT', '/api/pin', { current: '0000', pin: '1357' })).status, 403);
  // Settings saves can't overwrite the PIN.
  await call('PUT', '/api/settings', { settings: { parentPinHash: null } });
  assert.equal((await call('POST', '/api/pin', { pin: '2468' })).status, 200);
  assert.equal((await call('PUT', '/api/pin', { current: '2468', pin: '' })).body.hasPin, false);
});

test('recipe pages: JSON-LD in @graph, entities, durations; fallback title', function () {
  var html = '<html><head><title>Ignore me</title><script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [{ '@type': 'WebPage' }, { '@type': ['Recipe'], name: 'Chicken &amp; Rice', recipeIngredient: ['2 lb chicken thighs', '1 cup <b>rice</b>'], recipeYield: ['4', '4 servings'], totalTime: 'PT1H5M' }]
  }) + '</script></head></html>';
  var r = parseRecipeHtml(html, 'https://x.test/r');
  assert.equal(r.found, true);
  assert.equal(r.title, 'Chicken & Rice');
  assert.deepEqual(r.ingredients, ['2 lb chicken thighs', '1 cup rice']);
  assert.equal(r.servings, '4');
  assert.equal(r.totalTime, '1 hr 5 min');
  var none = parseRecipeHtml('<meta property="og:title" content="Grandma&#39;s Stew">', 'https://x.test');
  assert.deepEqual([none.found, none.title], [false, "Grandma's Stew"]);
  assert.throws(function () { safeRecipeUrl('http://169.254.169.254/latest'); });
  assert.throws(function () { safeRecipeUrl('http://localhost:3000/'); });
  assert.throws(function () { safeRecipeUrl('file:///etc/passwd'); });
  assert.equal(safeRecipeUrl('https://cooking.nytimes.com/recipes/1'), 'https://cooking.nytimes.com/recipes/1');
});

test('Twilio signature, phone numbers, long replies', function () {
  var url = 'https://hub.test/api/sms', params = { From: '+15551234567', Body: 'tacos thursday' };
  var sig = createHmac('sha1', 'tok').update(url + 'Bodytacos thursdayFrom+15551234567').digest('base64');
  assert.equal(validTwilioSignature('tok', url, params, sig), true);
  assert.equal(validTwilioSignature('tok', url, Object.assign({}, params, { Body: 'x' }), sig), false);
  assert.equal(normalisePhone('(555) 123-4567'), '+15551234567');
  assert.equal(normalisePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalisePhone('123'), null);
  var parts = splitForSms('a'.repeat(1000) + '\n' + 'b'.repeat(1000));
  assert.deepEqual(parts.map(function (p) { return p.length; }), [1000, 1000]);
});

test('SMS webhook rejects unsigned requests and ignores unknown numbers', async function () {
  var smsEnv = Object.assign({}, env, { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15550000000', PUBLIC_URL: 'https://hub.test' });
  var started = [];
  var smsApi = createApi(smsEnv, { waitUntil: function (p) { started.push(p); } });
  function post(params, sig) {
    return smsApi(new Request('https://hub.test/api/sms', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig },
      body: new URLSearchParams(params).toString()
    }));
  }
  assert.equal((await post({ From: '+15551234567', Body: 'hi' }, 'nope')).status, 403);
  var stranger = { From: '+15559999999', Body: 'hi' };
  var sig = createHmac('sha1', 'tok').update('https://hub.test/api/smsBodyhiFrom+15559999999').digest('base64');
  var r = await post(stranger, sig);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<Response><\/Response>/);
  assert.equal(started.length, 0); // nothing sent to strangers
});
