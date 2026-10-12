// HTTP API, written against the standard Request/Response so the same code runs in a Vercel
// function (api/index.js) and the local dev server (scripts/dev-server.js).
//
//   GET    /api/state?date=YYYY-MM-DD    settings (no secrets), today's to-dos, star totals
//   GET    /api/events?from=ISO&to=ISO   merged events from every calendar, plus per-feed status
//   GET    /api/tasks                    every to-do (for the manage list)
//   POST   /api/tasks                    { task, today }            create
//   PUT    /api/tasks/:id                { task, today }            edit
//   DELETE /api/tasks/:id                                           archive (history is kept)
//   POST   /api/tasks/:id/done           { date, by }               tick off
//   DELETE /api/tasks/:id/done?date=                                untick
//   GET    /api/settings                 full settings, calendar addresses masked
//   PUT    /api/settings                 replace settings (masked addresses keep their old value)
//   GET    /api/health                   no key needed; says whether storage is configured
//
// Every route except /api/health needs the household key (ACCESS_KEY) in an `x-hub-key` header.
import { createStore, DEFAULT_SETTINGS } from './store.js';
import { loadCalendars, normaliseFeedUrl } from './calendar.js';
import { tasksForDate, cleanSchedule, describeSchedule, starTotals, parseDate, addDays, occurrenceKey, nextDue, isRecurring } from './schedule.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';

var MASK = '••••••••';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
function fail(status, message) { return json({ error: message }, status); }

function keyOk(request, env) {
  var want = env.ACCESS_KEY;
  if (!want) return env.NODE_ENV !== 'production' && !env.VERCEL; // open only for local dev
  var got = request.headers.get('x-hub-key') || '';
  var a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x';
}

// What the wall display gets: no calendar addresses, ever.
function publicSettings(s) {
  return {
    familyName: s.familyName, timezone: s.timezone, location: s.location, units: s.units,
    weekStartsOn: s.weekStartsOn, nightStart: s.nightStart, nightEnd: s.nightEnd,
    people: s.people,
    calendars: s.calendars.map(function (c) { return { id: c.id, name: c.name, color: c.color, person: c.person || null, hidden: !!c.hidden }; })
  };
}

function cleanSettings(input, previous) {
  var s = Object.assign({}, DEFAULT_SETTINGS, previous, input);
  var oldCals = {};
  (previous.calendars || []).forEach(function (c) { oldCals[c.id] = c; });
  var color = /^#[0-9a-fA-F]{6}$/;

  s.familyName = String(s.familyName || '').slice(0, 60) || DEFAULT_SETTINGS.familyName;
  try { new Intl.DateTimeFormat('en-US', { timeZone: s.timezone }); } catch (e) { throw new Error('Unknown time zone: ' + s.timezone); }
  s.units = s.units === 'celsius' ? 'celsius' : 'fahrenheit';
  s.weekStartsOn = s.weekStartsOn === 1 ? 1 : 0;
  s.nightStart = Math.min(24, Math.max(0, parseInt(s.nightStart, 10) || 0));
  s.nightEnd = Math.min(24, Math.max(0, parseInt(s.nightEnd, 10) || 0));
  if (s.location && (s.location.lat === '' || s.location.lat == null)) s.location = null;
  if (s.location) {
    var lat = Number(s.location.lat), lon = Number(s.location.lon);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) throw new Error('Location needs a valid latitude and longitude');
    s.location = { name: String(s.location.name || '').slice(0, 60), lat: lat, lon: lon };
  }

  var ids = {};
  s.people = (s.people || []).map(function (p) {
    var id = p.id || slug(p.name);
    while (ids[id] || id === 'any') id += '-2';
    ids[id] = true;
    if (!p.name) throw new Error('Every person needs a name');
    return { id: id, name: String(p.name).slice(0, 30), color: color.test(p.color) ? p.color : '#5B7FFF', stars: !!p.stars };
  });

  var calIds = {};
  s.calendars = (s.calendars || []).map(function (c) {
    var id = c.id || slug(c.name);
    while (calIds[id]) id += '-2';
    calIds[id] = true;
    var url = c.url === MASK && oldCals[c.id] ? oldCals[c.id].url : normaliseFeedUrl(c.url);
    if (!c.name) throw new Error('Every calendar needs a name');
    return {
      id: id, name: String(c.name).slice(0, 40), url: url,
      color: color.test(c.color) ? c.color : '#5B7FFF',
      person: c.person && ids[c.person] ? c.person : null,
      hidden: !!c.hidden
    };
  });
  return s;
}

function cleanTask(input, today, people) {
  var t = input || {};
  var title = String(t.title || '').trim().slice(0, 120);
  if (!title) throw new Error('A to-do needs a title');
  var assignee = t.assignee === 'any' || people.some(function (p) { return p.id === t.assignee; }) ? t.assignee : 'any';
  return {
    title: title,
    emoji: t.emoji ? String(t.emoji).slice(0, 8) : null,
    assignee: assignee,
    slot: ['morning', 'afternoon', 'evening'].indexOf(t.slot) > -1 ? t.slot : null,
    stars: Math.min(10, Math.max(0, parseInt(t.stars, 10) || 0)),
    schedule: cleanSchedule(t.schedule, today),
    notes: t.notes ? String(t.notes).slice(0, 500) : null
  };
}

function dateParam(v, name) {
  if (!v || parseDate(v) == null) throw new Error(name + ' must be YYYY-MM-DD');
  return v;
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

export function createApi(env) {
  env = env || process.env;
  var store = createStore(env);

  async function route(request) {
    var url = new URL(request.url);
    var path = url.pathname.replace(/\/+$/, '');
    var method = request.method;
    var m;

    if (path === '/api/health') return json({ ok: true, storage: store.kind, keyRequired: !!env.ACCESS_KEY });
    if (!keyOk(request, env)) return fail(401, 'Wrong or missing household key');

    var body = null;
    if (method === 'POST' || method === 'PUT') {
      try { body = await request.json(); } catch (e) { body = {}; }
    }

    if (path === '/api/state' && method === 'GET') {
      var date = dateParam(url.searchParams.get('date'), 'date');
      var results = await Promise.all([
        store.getSettings(), store.listTasks(),
        store.listCompletions({ since: addDays(date, -1) }), store.allCompletionsForStars()
      ]);
      var settings = results[0];
      var list = tasksForDate(results[1], results[2], date, { upcomingDays: 14 }).map(function (t) {
        return Object.assign(t, { repeat: describeSchedule(t.schedule) });
      });
      return json({ settings: publicSettings(settings), date: date, tasks: list, stars: starTotals(results[3]) });
    }

    if (path === '/api/events' && method === 'GET') {
      var from = Date.parse(url.searchParams.get('from')), to = Date.parse(url.searchParams.get('to'));
      if (!(from < to)) return fail(400, 'from and to must be ISO dates, from before to');
      if (to - from > 100 * 864e5) return fail(400, 'Ask for at most 100 days at a time');
      var st = await store.getSettings();
      var cals = st.calendars.filter(function (c) { return !c.hidden; });
      var r = await loadCalendars(cals, from, to, st.timezone, cachedFetch);
      return json(r);
    }

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
      var s1 = await store.getSettings();
      var created = await store.createTask(Object.assign({ id: randomUUID() }, cleanTask(body.task, dateParam(body.today, 'today'), s1.people)));
      return json({ task: created }, 201);
    }

    if ((m = /^\/api\/tasks\/([\w-]+)$/.exec(path))) {
      var existing = await store.getTask(m[1]);
      if (!existing || existing.archived) return fail(404, 'No such to-do');
      if (method === 'PUT') {
        var s2 = await store.getSettings();
        return json({ task: await store.updateTask(m[1], cleanTask(body.task, dateParam(body.today, 'today'), s2.people)) });
      }
      if (method === 'DELETE') {
        await store.updateTask(m[1], { archived: true });
        return json({ ok: true });
      }
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

    if (path === '/api/settings' && method === 'GET') {
      var full = await store.getSettings();
      return json({
        settings: Object.assign({}, full, {
          calendars: full.calendars.map(function (c) { return Object.assign({}, c, { url: MASK }); })
        })
      });
    }

    if (path === '/api/settings' && method === 'PUT') {
      var prev = await store.getSettings();
      var next = cleanSettings(body.settings || {}, prev);
      await store.putSettings(next);
      return json({ settings: publicSettings(next) });
    }

    return fail(404, 'Not found');
  }

  return async function handle(request) {
    try {
      return await route(request);
    } catch (e) {
      var msg = String(e && e.message || e);
      var clientError = /must be|needs|Unknown|must start|A to-do/.test(msg);
      if (!clientError) console.error(e);
      return fail(clientError ? 400 : 500, msg);
    }
  };
}
