// Storage. Two interchangeable backends behind the same small table API:
//   - Postgres on Neon (production): set DATABASE_URL (Vercel's Neon integration does this). Tables
//     (each table here is `hub_<name>` there) are created on first use from supabase/schema.sql.
//   - Supabase: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and run supabase/schema.sql once.
//   - A JSON file (local dev, or an always-on box at home): used when Supabase isn't configured.
//
// Table API (all async):
//   list(table, { eq, gte, lte, in, order, desc, limit })   -> rows
//   insert(table, row)                                      -> row (id/created_at filled in)
//   update(table, eq, patch)                                -> updated rows
//   upsert(table, row, keyCols)                             -> row
//   remove(table, eq)
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export var DEFAULT_SETTINGS = {
  familyName: 'Our Family',
  timezone: 'America/Chicago',
  location: null, // { name, lat, lon } — enables weather
  units: 'fahrenheit',
  weekStartsOn: 0, // 0 = Sunday, 1 = Monday
  // Sleep: the screen dims (or shows only a clock) between these hours.
  nightStart: 22,
  nightEnd: 6,
  // Weekdays before this hour the home screen shows only the morning to-dos, after it the rest (0 = off).
  morningUntil: 12,
  sleepStyle: 'dim', // 'dim' | 'clock' | 'off'
  // Brightness through the day, 10–100. Applied by the Home Hub kiosk app to the backlight, or as
  // a dimming layer in any other browser. 'auto' uses the frame's light sensor when it has one.
  brightness: { mode: 'schedule', day: 100, evening: 70, night: 15, eveningStart: 19 },
  mealSlots: ['dinner'], // which meals the planner shows: breakfast, lunch, dinner, snack
  rewards: [], // [{ id, title, emoji, stars }]
  celebration: 'confetti', // 'confetti' | 'stars' | 'off'
  dailyStarGoal: 5,
  parentPinHash: null, // set through the API; never sent to clients
  // Teams for the sports tiles (ESPN league + team id).
  sports: [
    { league: 'college-football', id: '2', name: 'Auburn' },
    { league: 'college-football', id: '2633', name: 'Tennessee' }
  ],
  people: [], // [{ id, name, color, stars, phone }]
  calendars: [] // [{ id, name, url, color, person, hidden }]
};

// Columns that get an id / created_at automatically, per table.
var AUTO_ID = { tasks: 1, meals: 1, groceries: 1, redemptions: 1 };

export function createStore(env) {
  env = env || process.env;
  if (env.DATABASE_URL || env.POSTGRES_URL) return withHelpers(neonTables(env.DATABASE_URL || env.POSTGRES_URL), 'neon');
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return withHelpers(supabaseTables(env), 'supabase');
  return withHelpers(fileTables(env.DATA_FILE || '.data/home-hub.json'), 'file');
}

// ------------------------------------------------------------------ helpers shared by both backends
function withHelpers(t, kind) {
  return Object.assign(t, {
    kind: kind,
    async getSettings() {
      var rows = await t.list('settings', { eq: { key: 'settings' } });
      return Object.assign({}, DEFAULT_SETTINGS, rows[0] ? rows[0].value : {});
    },
    async putSettings(s) {
      await t.upsert('settings', { key: 'settings', value: s }, ['key']);
      return s;
    },
    async listTasks() { return t.list('tasks', { eq: { archived: false }, order: 'created_at' }); },
    async getTask(id) { return (await t.list('tasks', { eq: { id: id } }))[0] || null; },
    async createTask(row) { return t.insert('tasks', Object.assign({ archived: false }, row)); },
    async updateTask(id, patch) {
      return (await t.update('tasks', { id: id }, Object.assign({}, patch, { updated_at: new Date().toISOString() })))[0] || null;
    },
    // Completions on or after `since`, plus every one-time completion (those decide whether a
    // one-time to-do still shows).
    async listCompletions(opts) {
      var since = opts && opts.since;
      if (!since) return t.list('completions', {});
      var a = await t.list('completions', { gte: { day: since } });
      var b = await t.list('completions', { eq: { occ: 'once' } });
      var seen = {};
      return a.concat(b).filter(function (c) {
        var k = c.task_id + '|' + c.occ;
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
    },
    async addCompletion(c) {
      await t.upsert('completions', Object.assign({ at: new Date().toISOString() }, c), ['task_id', 'occ']);
    },
    async removeCompletion(taskId, occ) { await t.remove('completions', { task_id: taskId, occ: occ }); },
    async allCompletionsForStars() { return t.list('completions', { gte: { stars: 1 } }); }
  });
}

function matches(row, q) {
  q = q || {};
  var k;
  for (k in q.eq || {}) if (row[k] !== q.eq[k]) return false;
  for (k in q.gte || {}) if (!(row[k] >= q.gte[k])) return false;
  for (k in q.lte || {}) if (!(row[k] <= q.lte[k])) return false;
  for (k in q.in || {}) if (q.in[k].indexOf(row[k]) < 0) return false;
  return true;
}

// ------------------------------------------------------------------ JSON file
export function fileTables(path) {
  var cache = null, writing = Promise.resolve();

  async function load() {
    if (cache) return cache;
    try {
      cache = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      cache = {};
    }
    // Older files stored settings as a bare object.
    if (cache.settings && !Array.isArray(cache.settings)) cache.settings = [{ key: 'settings', value: cache.settings }];
    return cache;
  }
  async function table(name) {
    var db = await load();
    return db[name] || (db[name] = []);
  }
  function save() {
    var snapshot = JSON.stringify(cache, null, 2);
    // Serialise writes and swap the file in atomically so a crash can't leave half a file.
    writing = writing.then(async function () {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path + '.tmp', snapshot);
      await rename(path + '.tmp', path);
    });
    return writing;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  return {
    async list(name, q) {
      q = q || {};
      var rows = (await table(name)).filter(function (r) { return matches(r, q); });
      if (q.order) {
        rows.sort(function (a, b) {
          var x = a[q.order], y = b[q.order];
          var c = x < y ? -1 : x > y ? 1 : 0;
          return q.desc ? -c : c;
        });
      }
      if (q.limit) rows = rows.slice(0, q.limit);
      return clone(rows);
    },
    async insert(name, row) {
      var r = Object.assign({}, row);
      if (AUTO_ID[name] && !r.id) r.id = randomUUID();
      if (!r.created_at) r.created_at = new Date().toISOString();
      (await table(name)).push(r);
      await save();
      return clone(r);
    },
    async update(name, eq, patch) {
      var hit = (await table(name)).filter(function (r) { return matches(r, { eq: eq }); });
      hit.forEach(function (r) { Object.assign(r, patch); });
      if (hit.length) await save();
      return clone(hit);
    },
    async upsert(name, row, keys) {
      var rows = await table(name);
      var i = rows.findIndex(function (r) { return keys.every(function (k) { return r[k] === row[k]; }); });
      if (i > -1) rows[i] = Object.assign({}, rows[i], row);
      else rows.push(Object.assign({ created_at: new Date().toISOString() }, row));
      await save();
      return clone(rows[i > -1 ? i : rows.length - 1]);
    },
    async remove(name, eq) {
      var db = await load();
      db[name] = (db[name] || []).filter(function (r) { return !matches(r, { eq: eq }); });
      await save();
    }
  };
}

// ------------------------------------------------------------------ Supabase
function supabaseTables(env) {
  var clientPromise = import('@supabase/supabase-js').then(function (m) {
    return m.createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  });
  async function run(build) {
    var sb = await clientPromise;
    var r = await build(sb);
    if (r.error) throw new Error('Database: ' + r.error.message);
    return r.data;
  }
  function filter(query, q) {
    q = q || {};
    var k;
    for (k in q.eq || {}) query = query.eq(k, q.eq[k]);
    for (k in q.gte || {}) query = query.gte(k, q.gte[k]);
    for (k in q.lte || {}) query = query.lte(k, q.lte[k]);
    for (k in q.in || {}) query = query.in(k, q.in[k]);
    return query;
  }

  return {
    list(name, q) {
      q = q || {};
      return run(function (sb) {
        var query = filter(sb.from('hub_' + name).select('*'), q);
        if (q.order) query = query.order(q.order, { ascending: !q.desc });
        if (q.limit) query = query.limit(q.limit);
        return query;
      });
    },
    async insert(name, row) {
      return (await run(function (sb) { return sb.from('hub_' + name).insert(row).select('*'); }))[0];
    },
    update(name, eq, patch) {
      return run(function (sb) { return filter(sb.from('hub_' + name).update(patch), { eq: eq }).select('*'); });
    },
    async upsert(name, row, keys) {
      return (await run(function (sb) { return sb.from('hub_' + name).upsert(row, { onConflict: keys.join(',') }).select('*'); }))[0];
    },
    async remove(name, eq) {
      await run(function (sb) { return filter(sb.from('hub_' + name).delete(), { eq: eq }); });
    }
  };
}

// ------------------------------------------------------------------ Postgres (Neon serverless driver)
var DATE_COLS = { day: 1, date: 1 };
var IDENT = /^[a-z_]+$/;
function ident(x) {
  if (!IDENT.test(x)) throw new Error('Bad column name: ' + x);
  return '"' + x + '"';
}

export function neonTables(url, sqlImpl) {
  var ready = null;
  function client() {
    if (!ready) {
      ready = (async function () {
        var sql = sqlImpl || (await import('@neondatabase/serverless')).neon(url);
        // Create the tables the first time (every statement is IF NOT EXISTS / idempotent).
        var have = await sql.query("select to_regclass('hub_conversations') as t");
        if (!have[0] || !have[0].t) {
          var schema = await readFile(fileURLToPath(new URL('../supabase/schema.sql', import.meta.url)), 'utf8');
          var stmts = schema.replace(/--.*$/gm, '').split(';').map(function (x) { return x.trim(); }).filter(Boolean);
          for (var i = 0; i < stmts.length; i++) await sql.query(stmts[i]);
        }
        return sql;
      })();
      ready.catch(function () { ready = null; });
    }
    return ready;
  }
  function out(rows) {
    return rows.map(function (r) {
      var o = {};
      for (var k in r) {
        var v = r[k];
        o[k] = v instanceof Date ? (DATE_COLS[k] ? v.toISOString().slice(0, 10) : v.toISOString()) : v;
      }
      return o;
    });
  }
  function val(v) { return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v; }
  function where(q, params) {
    q = q || {};
    var parts = [], k;
    function add(op, col, v) { params.push(val(v)); parts.push(ident(col) + op + '$' + params.length); }
    for (k in q.eq || {}) add(' = ', k, q.eq[k]);
    for (k in q.gte || {}) add(' >= ', k, q.gte[k]);
    for (k in q.lte || {}) add(' <= ', k, q.lte[k]);
    for (k in q.in || {}) { params.push(q.in[k]); parts.push(ident(k) + ' = any($' + params.length + ')'); }
    return parts.length ? ' where ' + parts.join(' and ') : '';
  }
  async function run(text, params) { return out(await (await client()).query(text, params)); }

  return {
    list(name, q) {
      q = q || {};
      var params = [];
      var text = 'select * from ' + ident('hub_' + name) + where(q, params);
      if (q.order) text += ' order by ' + ident(q.order) + (q.desc ? ' desc' : ' asc');
      if (q.limit) text += ' limit ' + (q.limit | 0);
      return run(text, params);
    },
    async insert(name, row) {
      var cols = Object.keys(row);
      var text = 'insert into ' + ident('hub_' + name) + ' (' + cols.map(ident).join(', ') + ') values (' +
        cols.map(function (_, i) { return '$' + (i + 1); }).join(', ') + ') returning *';
      return (await run(text, cols.map(function (c) { return val(row[c]); })))[0];
    },
    update(name, eq, patch) {
      var cols = Object.keys(patch);
      var params = cols.map(function (c) { return val(patch[c]); });
      var text = 'update ' + ident('hub_' + name) + ' set ' +
        cols.map(function (c, i) { return ident(c) + ' = $' + (i + 1); }).join(', ') + where({ eq: eq }, params) + ' returning *';
      return run(text, params);
    },
    async upsert(name, row, keys) {
      var cols = Object.keys(row);
      var rest = cols.filter(function (c) { return keys.indexOf(c) < 0; });
      var text = 'insert into ' + ident('hub_' + name) + ' (' + cols.map(ident).join(', ') + ') values (' +
        cols.map(function (_, i) { return '$' + (i + 1); }).join(', ') + ') on conflict (' + keys.map(ident).join(', ') + ') do ' +
        (rest.length ? 'update set ' + rest.map(function (c) { return ident(c) + ' = excluded.' + ident(c); }).join(', ') : 'nothing') +
        ' returning *';
      return (await run(text, cols.map(function (c) { return val(row[c]); })))[0];
    },
    async remove(name, eq) {
      var params = [];
      await run('delete from ' + ident('hub_' + name) + where({ eq: eq }, params), params);
    }
  };
}
