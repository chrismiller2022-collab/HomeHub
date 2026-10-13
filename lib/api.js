// HTTP API, written against the standard Request/Response so the same code runs in a Vercel
// function (api/index.js) and the local dev server (scripts/dev-server.js).
//
//   GET    /api/health                   no key needed; what's configured
//   GET    /api/state?date=YYYY-MM-DD    settings (no secrets), today's to-dos and meals, stars
//   GET    /api/events?from=ISO&to=ISO   merged events from every calendar, plus per-feed status
//
//   GET    /api/tasks                    every to-do (for the manage list)
//   POST   /api/tasks                    { task, today }            create
//   PUT    /api/tasks/:id                { task, today }            edit
//   DELETE /api/tasks/:id                                           archive (history is kept)
//   POST   /api/tasks/:id/done           { date, by }               tick off
//   DELETE /api/tasks/:id/done?date=                                untick
//
//   GET    /api/meals?from=&to=          planned meals (dates YYYY-MM-DD, inclusive)
//   POST   /api/meals                    { meal }                   add
//   PUT    /api/meals/:id                { meal }                   change
//   DELETE /api/meals/:id
//   GET    /api/sports                   your teams: record, last result, next game, live score
//   GET    /api/sports/search?league=&q= find a team to follow
//   GET    /api/recipe?url=              read a recipe link (title, ingredients)
//   GET    /api/groceries                open items, plus ones ticked off in the last day
//   POST   /api/groceries                { items: [{ name, qty?, note? }], meal_id? }
//   PUT    /api/groceries/:id            { done?, name?, qty?, note? }
//   DELETE /api/groceries/:id
//   DELETE /api/groceries?done=1                                    clear ticked-off items
//
//   POST   /api/redeem                   { person, reward }         spend stars on a reward
//   POST   /api/pin                      { pin }                    check the parent PIN
//   PUT    /api/pin                      { current?, pin }          set or change it ('' removes it)
//   POST   /api/assistant                { message, today }         chat with the meal planner
//   DELETE /api/assistant                                           start a new conversation
//   GET    /api/settings                 full settings, calendar addresses masked
//   PUT    /api/settings                 replace settings (masked addresses keep their old value)
//
//   POST   /api/sms                      Twilio webhook (checked with Twilio's signature, not the key)
//   GET    /api/cron                     daily job (Vercel Cron, checked with CRON_SECRET)
//
// Everything else needs the household key (ACCESS_KEY) in an `x-hub-key` header. An optional
// `x-hub-person` header says which family member is using the device.
import { createStore, DEFAULT_SETTINGS } from './store.js';
import { loadCalendars, normaliseFeedUrl } from './calendar.js';
import { tasksForDate, cleanSchedule, describeSchedule, parseDate, addDays, occurrenceKey, nextDue, isRecurring } from './schedule.js';
import { cleanMeal, mealsBetween, openGroceries, addGroceries, SLOTS } from './meals.js';
import { converse } from './agent.js';
import { fetchRecipe } from './recipes.js';
import { loadTeams, searchTeams, LEAGUES } from './sports.js';
import { smsConfigured, validTwilioSignature, normalisePhone, sendSms, EMPTY_TWIML } from './sms.js';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

var MASK = '••••••••';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
function fail(status, message) { return json({ error: message }, status); }
class ClientError extends Error {}
function bad(message) { return new ClientError(message); }

function sameSecret(got, want) {
  var a = Buffer.from(String(got || '')), b = Buffer.from(String(want || ''));
  return a.length === b.length && b.length > 0 && timingSafeEqual(a, b);
}
function keyOk(request, env) {
  if (!env.ACCESS_KEY) return env.NODE_ENV !== 'production' && !env.VERCEL; // open only for local dev
  return sameSecret(request.headers.get('x-hub-key'), env.ACCESS_KEY);
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x';
}

// ------------------------------------------------------------------ parent PIN
function hashPin(pin) {
  var salt = randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + scryptSync(String(pin), salt, 32).toString('hex');
}
function pinMatches(pin, stored) {
  var p = String(stored || '').split('$');
  if (p.length !== 3) return false;
  return sameSecret(scryptSync(String(pin), p[1], 32).toString('hex'), p[2]);
}
// Slow down guessing: a few wrong tries per minute per server instance.
var pinFails = { count: 0, since: 0 };
function pinThrottled() {
  if (Date.now() - pinFails.since > 60000) pinFails = { count: 0, since: Date.now() };
  return pinFails.count >= 5;
}

// ------------------------------------------------------------------ settings
// What every screen gets: no calendar addresses, phone numbers or PIN hash, ever.
function publicSettings(s, env) {
  return {
    familyName: s.familyName, timezone: s.timezone, location: s.location, units: s.units,
    weekStartsOn: s.weekStartsOn, nightStart: s.nightStart, nightEnd: s.nightEnd, sleepStyle: s.sleepStyle,
    brightness: s.brightness, mealSlots: s.mealSlots, rewards: s.rewards, celebration: s.celebration,
    dailyStarGoal: s.dailyStarGoal, groceryReminder: s.groceryReminder || null,
    sports: s.sports || [],
    hasPin: !!s.parentPinHash,
    assistant: !!env.ANTHROPIC_API_KEY,
    sms: smsConfigured(env),
    people: s.people.map(function (p) { return { id: p.id, name: p.name, color: p.color, stars: !!p.stars }; }),
    calendars: s.calendars.map(function (c) { return { id: c.id, name: c.name, color: c.color, person: c.person || null, hidden: !!c.hidden }; })
  };
}

function clampInt(v, lo, hi, dflt) {
  var n = parseInt(v, 10);
  return isNaN(n) ? dflt : Math.min(hi, Math.max(lo, n));
}

function cleanSettings(input, previous) {
  var s = Object.assign({}, DEFAULT_SETTINGS, previous, input);
  s.parentPinHash = previous.parentPinHash || null; // only changed through PUT /api/pin
  delete s.hasPin;
  var oldCals = {}, oldPeople = {};
  (previous.calendars || []).forEach(function (c) { oldCals[c.id] = c; });
  (previous.people || []).forEach(function (p) { oldPeople[p.id] = p; });
  var color = /^#[0-9a-fA-F]{6}$/;

  s.familyName = String(s.familyName || '').slice(0, 60) || DEFAULT_SETTINGS.familyName;
  try { new Intl.DateTimeFormat('en-US', { timeZone: s.timezone }); } catch (e) { throw bad('Unknown time zone: ' + s.timezone); }
  s.units = s.units === 'celsius' ? 'celsius' : 'fahrenheit';
  s.weekStartsOn = s.weekStartsOn === 1 ? 1 : 0;
  s.nightStart = clampInt(s.nightStart, 0, 24, 22);
  s.nightEnd = clampInt(s.nightEnd, 0, 24, 6);
  s.sleepStyle = ['dim', 'clock', 'off'].indexOf(s.sleepStyle) > -1 ? s.sleepStyle : 'dim';
  var b = s.brightness || {};
  s.brightness = {
    mode: ['schedule', 'auto', 'off'].indexOf(b.mode) > -1 ? b.mode : 'schedule',
    day: clampInt(b.day, 10, 100, 100), evening: clampInt(b.evening, 10, 100, 70), night: clampInt(b.night, 5, 100, 15),
    eveningStart: clampInt(b.eveningStart, 12, 23, 19)
  };
  s.mealSlots = (Array.isArray(s.mealSlots) ? s.mealSlots : []).filter(function (x) { return SLOTS.indexOf(x) > -1; });
  if (!s.mealSlots.length) s.mealSlots = ['dinner'];
  s.celebration = ['confetti', 'stars', 'off'].indexOf(s.celebration) > -1 ? s.celebration : 'confetti';
  s.dailyStarGoal = clampInt(s.dailyStarGoal, 0, 50, 5);
  if (s.location && (s.location.lat === '' || s.location.lat == null)) s.location = null;
  if (s.location) {
    var lat = Number(s.location.lat), lon = Number(s.location.lon);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) throw bad('Location needs a valid latitude and longitude');
    s.location = { name: String(s.location.name || '').slice(0, 60), lat: lat, lon: lon };
  }

  var ids = {};
  s.people = (s.people || []).map(function (p) {
    if (!p.name) throw bad('Every person needs a name');
    var id = p.id || slug(p.name);
    while (ids[id] || id === 'any') id += '-2';
    ids[id] = true;
    // Phone numbers aren't sent to screens; a blank or masked value keeps the saved one.
    var phone = p.phone === MASK || p.phone === undefined ? (oldPeople[p.id] || {}).phone || null : normalisePhone(p.phone);
    if (p.phone && p.phone !== MASK && !phone) throw bad('Couldn’t read the phone number for ' + p.name);
    return { id: id, name: String(p.name).slice(0, 30), color: color.test(p.color) ? p.color : '#5B7FFF', stars: !!p.stars, phone: phone };
  });

  var calIds = {};
  s.calendars = (s.calendars || []).map(function (c) {
    if (!c.name) throw bad('Every calendar needs a name');
    var id = c.id || slug(c.name);
    while (calIds[id]) id += '-2';
    calIds[id] = true;
    var url;
    try { url = c.url === MASK && oldCals[c.id] ? oldCals[c.id].url : normaliseFeedUrl(c.url); } catch (e) { throw bad(e.message); }
    return {
      id: id, name: String(c.name).slice(0, 40), url: url,
      color: color.test(c.color) ? c.color : '#5B7FFF',
      person: c.person && ids[c.person] ? c.person : null,
      hidden: !!c.hidden
    };
  });

  var seenTeams = {};
  s.sports = (Array.isArray(s.sports) ? s.sports : []).filter(function (t) {
    if (!t || !LEAGUES[t.league] || !/^\d{1,8}$/.test(String(t.id))) return false;
    var k = t.league + '/' + t.id;
    if (seenTeams[k]) return false;
    seenTeams[k] = true;
    return true;
  }).slice(0, 8).map(function (t) { return { league: t.league, id: String(t.id), name: String(t.name || '').slice(0, 40) }; });

  var rIds = {};
  s.rewards = (s.rewards || []).filter(function (r) { return r && r.title; }).slice(0, 30).map(function (r) {
    var id = r.id || slug(r.title);
    while (rIds[id]) id += '-2';
    rIds[id] = true;
    return { id: id, title: String(r.title).slice(0, 50), emoji: r.emoji ? String(r.emoji).slice(0, 8) : '🎁', stars: clampInt(r.stars, 1, 999, 10) };
  });

  var g = s.groceryReminder;
  s.groceryReminder = g && g.enabled ? {
    enabled: true, day: clampInt(g.day, 0, 6, 4),
    people: (g.people || []).filter(function (id) { return ids[id]; })
  } : null;
  return s;
}

// ------------------------------------------------------------------ to-dos
function cleanTask(input, today, people) {
  var t = input || {};
  var title = String(t.title || '').trim().slice(0, 120);
  if (!title) throw bad('A to-do needs a title');
  var assignee = t.assignee === 'any' || people.some(function (p) { return p.id === t.assignee; }) ? t.assignee : 'any';
  var schedule;
  try { schedule = cleanSchedule(t.schedule, today); } catch (e) { throw bad(e.message); }
  return {
    title: title,
    emoji: t.emoji ? String(t.emoji).slice(0, 8) : null,
    assignee: assignee,
    slot: ['morning', 'afternoon', 'evening'].indexOf(t.slot) > -1 ? t.slot : null,
    stars: clampInt(t.stars, 0, 10, 0),
    schedule: schedule,
    notes: t.notes ? String(t.notes).slice(0, 500) : null
  };
}

function dateParam(v, name) {
  if (!v || parseDate(v) == null) throw bad(name + ' must be YYYY-MM-DD');
  return v;
}

// Stars per person: earned today / this week / this month / all time, spent, and balance.
function starSummary(earned, spent, today, weekStartsOn) {
  var dow = new Date(parseDate(today)).getUTCDay();
  var weekStart = addDays(today, -((dow - weekStartsOn + 7) % 7));
  var month = today.slice(0, 7);
  var out = {};
  function row(id) { return out[id] || (out[id] = { today: 0, week: 0, month: 0, total: 0, spent: 0, balance: 0 }); }
  earned.forEach(function (c) {
    if (!c.done_by || !c.stars) return;
    var r = row(c.done_by), day = String(c.day).slice(0, 10);
    r.total += c.stars;
    if (day === today) r.today += c.stars;
    if (day >= weekStart && day <= today) r.week += c.stars;
    if (day.slice(0, 7) === month) r.month += c.stars;
  });
  spent.forEach(function (x) { row(x.person).spent += x.stars; });
  Object.keys(out).forEach(function (id) { out[id].balance = out[id].total - out[id].spent; });
  return out;
}

// Calendar feeds are re-fetched at most every few minutes per warm server instance.
var feedCache = new Map();
var FEED_TTL = 5 * 60 * 1000;
function cachedFetch(url, init) {
  var hit = feedCache.get(url);
  if (hit && Date.now() - hit.at < FEED_TTL) return Promise.resolve(new Response(hit.text, { status: 200 }));
  return fetch(url, init).then(async function (res) {
    if (!res.ok) return res;
    var text = await res.text();
    feedCache.set(url, { at: Date.now(), text: text });
    return new Response(text, { status: 200 });
  });
}

function localToday(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// ------------------------------------------------------------------ the API
//   opts.waitUntil(promise): keep working after the response is sent (Vercel's waitUntil).
export function createApi(env, opts) {
  env = env || process.env;
  opts = opts || {};
  var store = createStore(env);
  var waitUntil = opts.waitUntil || function (p) { p.catch(function (e) { console.error(e); }); };

  async function handleSms(request) {
    if (!smsConfigured(env)) return fail(404, 'Texting is not set up');
    var form = new URLSearchParams(await request.text());
    var params = {};
    form.forEach(function (v, k) { params[k] = v; });
    var url = (env.PUBLIC_URL || '').replace(/\/+$/, '') + '/api/sms';
    if (!validTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params, request.headers.get('x-twilio-signature'))) {
      return fail(403, 'Bad signature');
    }
    var twiml = new Response(EMPTY_TWIML, { headers: { 'content-type': 'text/xml' } });
    var settings = await store.getSettings();
    var from = normalisePhone(params.From);
    var person = settings.people.filter(function (p) { return p.phone && p.phone === from; })[0];
    if (!person) return twiml; // only family members' numbers get answers
    var body = String(params.Body || '').trim();
    if (!body) return twiml;
    // Reply after answering Twilio: the assistant can take longer than Twilio's 15 s webhook limit.
    waitUntil((async function () {
      var reply;
      try {
        reply = env.ANTHROPIC_API_KEY ? await converse(body, {
          store: store, settings: settings, env: env, convId: 'sms:' + from,
          personId: person.id, personName: person.name, channel: 'sms', today: localToday(settings.timezone)
        }) : 'The meal planner isn’t set up yet (no ANTHROPIC_API_KEY).';
      } catch (e) {
        console.error(e);
        reply = 'Sorry, something went wrong on my end. Try again in a minute.';
      }
      await sendSms(env, from, reply);
    })());
    return twiml;
  }

  async function handleCron(request) {
    if (!sameSecret((request.headers.get('authorization') || '').replace(/^Bearer /, ''), env.CRON_SECRET)) return fail(401, 'Bad cron secret');
    var settings = await store.getSettings();
    var g = settings.groceryReminder, today = localToday(settings.timezone);
    var dow = new Date(parseDate(today)).getUTCDay(), sent = 0;
    if (g && g.enabled && dow === g.day && smsConfigured(env)) {
      var items = await openGroceries(store);
      var weekMeals = await mealsBetween(store, today, addDays(today, 6));
      var msg = 'Grocery order day! ' + (items.length ? items.length + ' item' + (items.length > 1 ? 's' : '') + ' on the list: ' +
        items.slice(0, 25).map(function (i) { return i.name + (i.qty ? ' (' + i.qty + ')' : ''); }).join(', ') + (items.length > 25 ? ', …' : '') : 'The list is empty.') +
        (weekMeals.length ? '\nThis week: ' + weekMeals.map(function (m) { return m.title; }).slice(0, 7).join(', ') + '.' : '\nNo meals planned yet this week. Text me a meal idea or recipe link.');
      var people = settings.people.filter(function (p) { return p.phone && g.people.indexOf(p.id) > -1; });
      for (var i = 0; i < people.length; i++) { await sendSms(env, people[i].phone, msg); sent++; }
    }
    return json({ ok: true, today: today, groceryReminders: sent });
  }

  async function route(request) {
    var url = new URL(request.url);
    var path = url.pathname.replace(/\/+$/, '');
    var method = request.method;
    var m;

    if (path === '/api/health') {
      return json({ ok: true, storage: store.kind, keyRequired: !!env.ACCESS_KEY, assistant: !!env.ANTHROPIC_API_KEY, sms: smsConfigured(env) });
    }
    if (path === '/api/sms' && method === 'POST') return handleSms(request);
    if (path === '/api/cron') return handleCron(request);
    if (!keyOk(request, env)) return fail(401, 'Wrong or missing household key');

    var body = null;
    if (method === 'POST' || method === 'PUT') {
      try { body = await request.json(); } catch (e) { body = {}; }
    }
    var settingsCache = null;
    async function settings() { return settingsCache || (settingsCache = await store.getSettings()); }
    async function who() {
      var id = request.headers.get('x-hub-person');
      if (!id) return null;
      return (await settings()).people.filter(function (p) { return p.id === id; })[0] || null;
    }

    // -------------------------------------------------------------- state & calendar
    if (path === '/api/state' && method === 'GET') {
      var date = dateParam(url.searchParams.get('date'), 'date');
      var results = await Promise.all([
        settings(), store.listTasks(), store.listCompletions({ since: addDays(date, -1) }),
        store.allCompletionsForStars(), store.list('redemptions', {}),
        mealsBetween(store, date, addDays(date, 1)), openGroceries(store)
      ]);
      var st = results[0];
      var list = tasksForDate(results[1], results[2], date, { upcomingDays: 14 }).map(function (t) {
        return Object.assign(t, { repeat: describeSchedule(t.schedule) });
      });
      var stars = starSummary(results[3], results[4], date, st.weekStartsOn);
      return json({
        settings: publicSettings(st, env), date: date, tasks: list,
        stars: Object.keys(stars).reduce(function (o, k) { o[k] = stars[k].balance; return o; }, {}),
        starDetail: stars,
        meals: results[5], groceryCount: results[6].length
      });
    }

    if (path === '/api/events' && method === 'GET') {
      var from = Date.parse(url.searchParams.get('from')), to = Date.parse(url.searchParams.get('to'));
      if (!(from < to)) return fail(400, 'from and to must be ISO dates, from before to');
      if (to - from > 100 * 864e5) return fail(400, 'Ask for at most 100 days at a time');
      var s0 = await settings();
      var cals = s0.calendars.filter(function (c) { return !c.hidden; });
      return json(await loadCalendars(cals, from, to, s0.timezone, cachedFetch));
    }

    // -------------------------------------------------------------- to-dos
    if (path === '/api/tasks' && method === 'GET') {
      var today = url.searchParams.get('today');
      var all = await store.listTasks();
      return json({
        tasks: all.map(function (t) {
          return Object.assign({}, t, {
            repeat: describeSchedule(t.schedule),
            next: today && isRecurring(t.schedule) ? nextDue(t.schedule, today) : null
          });
        })
      });
    }
    if (path === '/api/tasks' && method === 'POST') {
      var created = await store.createTask(Object.assign({ id: randomUUID() }, cleanTask(body.task, dateParam(body.today, 'today'), (await settings()).people)));
      return json({ task: created }, 201);
    }
    if ((m = /^\/api\/tasks\/([\w-]+)$/.exec(path))) {
      var existing = await store.getTask(m[1]);
      if (!existing || existing.archived) return fail(404, 'No such to-do');
      if (method === 'PUT') return json({ task: await store.updateTask(m[1], cleanTask(body.task, dateParam(body.today, 'today'), (await settings()).people)) });
      if (method === 'DELETE') { await store.updateTask(m[1], { archived: true }); return json({ ok: true }); }
    }
    if ((m = /^\/api\/tasks\/([\w-]+)\/done$/.exec(path))) {
      var task = await store.getTask(m[1]);
      if (!task || task.archived) return fail(404, 'No such to-do');
      if (method === 'POST') {
        var day = dateParam(body.date, 'date');
        var by = body.by || (task.assignee !== 'any' ? task.assignee : null);
        await store.addCompletion({ task_id: task.id, occ: occurrenceKey(task, day), done_by: by, day: day, stars: task.stars || 0 });
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await store.removeCompletion(task.id, occurrenceKey(task, dateParam(url.searchParams.get('date'), 'date')));
        return json({ ok: true });
      }
    }

    // -------------------------------------------------------------- meals
    if (path === '/api/meals' && method === 'GET') {
      var mf = dateParam(url.searchParams.get('from'), 'from'), mt = dateParam(url.searchParams.get('to'), 'to');
      if ((parseDate(mt) - parseDate(mf)) / 864e5 > 62) return fail(400, 'Ask for at most 62 days at a time');
      return json({ meals: await mealsBetween(store, mf, mt) });
    }
    if (path === '/api/meals' && method === 'POST') {
      var meal = cleanMeal(body.meal);
      var me = await who();
      return json({ meal: await store.insert('meals', Object.assign(meal, { created_by: me ? me.id : null })) }, 201);
    }
    if ((m = /^\/api\/meals\/([\w-]+)$/.exec(path))) {
      if (method === 'PUT') {
        var rows = await store.update('meals', { id: m[1] }, cleanMeal(body.meal, true));
        return rows.length ? json({ meal: rows[0] }) : fail(404, 'No such meal');
      }
      if (method === 'DELETE') { await store.remove('meals', { id: m[1] }); return json({ ok: true }); }
    }

    if (path === '/api/sports' && method === 'GET') {
      return json({ teams: await loadTeams((await settings()).sports || []) });
    }
    if (path === '/api/sports/search' && method === 'GET') {
      var league = url.searchParams.get('league') || 'college-football';
      if (!LEAGUES[league]) return fail(400, 'Unknown league');
      try { return json({ teams: await searchTeams(league, url.searchParams.get('q')) }); } catch (e) { return fail(502, 'Team search failed: ' + e.message); }
    }
    if (path === '/api/recipe' && method === 'GET') {
      try { return json({ recipe: await fetchRecipe(url.searchParams.get('url')) }); } catch (e) { throw bad(e.message); }
    }

    // -------------------------------------------------------------- groceries
    if (path === '/api/groceries' && method === 'GET') {
      var recent = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      var done = await store.list('groceries', { eq: { done: true }, gte: { done_at: recent } });
      return json({ items: (await openGroceries(store)).concat(done) });
    }
    if (path === '/api/groceries' && method === 'POST') {
      var me2 = await who();
      var res = await addGroceries(store, Array.isArray(body.items) ? body.items : [], { meal_id: body.meal_id || null, by: me2 ? me2.id : null });
      return json(res, 201);
    }
    if (path === '/api/groceries' && method === 'DELETE' && url.searchParams.get('done')) {
      await store.remove('groceries', { done: true });
      return json({ ok: true });
    }
    if ((m = /^\/api\/groceries\/([\w-]+)$/.exec(path))) {
      if (method === 'PUT') {
        var patch = {};
        if (body.done !== undefined) { patch.done = !!body.done; patch.done_at = body.done ? new Date().toISOString() : null; }
        if (body.name !== undefined) { patch.name = String(body.name).trim().slice(0, 120); if (!patch.name) return fail(400, 'Item needs a name'); }
        if (body.qty !== undefined) patch.qty = body.qty ? String(body.qty).slice(0, 40) : null;
        if (body.note !== undefined) patch.note = body.note ? String(body.note).slice(0, 160) : null;
        var g = await store.update('groceries', { id: m[1] }, patch);
        return g.length ? json({ item: g[0] }) : fail(404, 'No such item');
      }
      if (method === 'DELETE') { await store.remove('groceries', { id: m[1] }); return json({ ok: true }); }
    }

    // -------------------------------------------------------------- stars, PIN
    if (path === '/api/redeem' && method === 'POST') {
      var s1 = await settings();
      var reward = s1.rewards.filter(function (r) { return r.id === body.reward; })[0];
      var kid = s1.people.filter(function (p) { return p.id === body.person; })[0];
      if (!reward || !kid) return fail(400, 'Unknown reward or person');
      var earned = await store.allCompletionsForStars(), spent = await store.list('redemptions', {});
      var bal = starSummary(earned, spent, localToday(s1.timezone), s1.weekStartsOn)[kid.id];
      if (!bal || bal.balance < reward.stars) return fail(400, kid.name + ' needs ' + reward.stars + ' stars for that');
      await store.insert('redemptions', { person: kid.id, reward: reward.title, stars: reward.stars });
      return json({ ok: true, balance: bal.balance - reward.stars });
    }
    if (path === '/api/pin' && method === 'POST') {
      var s2 = await settings();
      if (!s2.parentPinHash) return json({ ok: true });
      if (pinThrottled()) return fail(429, 'Too many tries. Wait a minute.');
      if (pinMatches(body.pin, s2.parentPinHash)) return json({ ok: true });
      pinFails.count++;
      return fail(403, 'Wrong PIN');
    }
    if (path === '/api/pin' && method === 'PUT') {
      var s3 = await settings();
      if (s3.parentPinHash) {
        if (pinThrottled()) return fail(429, 'Too many tries. Wait a minute.');
        if (!pinMatches(body.current, s3.parentPinHash)) { pinFails.count++; return fail(403, 'Current PIN is wrong'); }
      }
      var pin = String(body.pin || '');
      if (pin && !/^\d{4,8}$/.test(pin)) return fail(400, 'PIN must be 4–8 digits');
      s3.parentPinHash = pin ? hashPin(pin) : null;
      await store.putSettings(s3);
      return json({ ok: true, hasPin: !!pin });
    }

    // -------------------------------------------------------------- assistant
    if (path === '/api/assistant' && method === 'DELETE') {
      var me3 = await who();
      await store.remove('conversations', { id: 'app:' + (me3 ? me3.id : 'family') });
      return json({ ok: true });
    }
    if (path === '/api/assistant' && method === 'POST') {
      if (!env.ANTHROPIC_API_KEY) return fail(400, 'The meal planner needs ANTHROPIC_API_KEY set on the server');
      var s4 = await settings();
      var person = await who();
      var text = String(body.message || '').trim();
      if (!text) return fail(400, 'Say something first');
      var reply = await converse(text, {
        store: store, settings: s4, env: env, convId: 'app:' + (person ? person.id : 'family'),
        personId: person ? person.id : null, personName: person ? person.name : null,
        channel: 'app', today: dateParam(body.today, 'today')
      });
      return json({ reply: reply });
    }

    // -------------------------------------------------------------- settings
    if (path === '/api/settings' && method === 'GET') {
      var full = await settings();
      var copy = Object.assign({}, full, {
        calendars: full.calendars.map(function (c) { return Object.assign({}, c, { url: MASK }); }),
        people: full.people.map(function (p) { return Object.assign({}, p, { phone: p.phone ? MASK : '' }); }),
        hasPin: !!full.parentPinHash
      });
      delete copy.parentPinHash;
      return json({ settings: copy, sms: smsConfigured(env), assistant: !!env.ANTHROPIC_API_KEY });
    }
    if (path === '/api/settings' && method === 'PUT') {
      var next = cleanSettings(body.settings || {}, await settings());
      await store.putSettings(next);
      return json({ settings: publicSettings(next, env) });
    }

    return fail(404, 'Not found');
  }

  return async function handle(request) {
    try {
      return await route(request);
    } catch (e) {
      var msg = String(e && e.message || e);
      if (e instanceof ClientError || /must be|needs a|Unknown|must start|A meal|Meal must/.test(msg)) return fail(400, msg);
      console.error(e);
      return fail(500, msg);
    }
  };
}
