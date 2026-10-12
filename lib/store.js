// Storage. Two interchangeable backends with the same methods:
//   - Supabase (production): set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Tables: supabase/schema.sql
//   - A JSON file (local dev, or a always-on box at home): used when Supabase isn't configured.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export var DEFAULT_SETTINGS = {
  familyName: 'Our Family',
  timezone: 'America/Chicago',
  location: null, // { name, lat, lon } — enables weather
  units: 'fahrenheit',
  weekStartsOn: 0, // 0 = Sunday, 1 = Monday
  nightStart: 22,
  nightEnd: 6,
  people: [],
  calendars: []
};

export function createStore(env) {
  env = env || process.env;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return supabaseStore(env);
  return fileStore(env.DATA_FILE || '.data/home-hub.json');
}

// ------------------------------------------------------------------ JSON file
export function fileStore(path) {
  var cache = null, writing = Promise.resolve();

  async function load() {
    if (cache) return cache;
    try {
      cache = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      cache = { settings: {}, tasks: [], completions: [] };
    }
    return cache;
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

  return {
    kind: 'file',
    async getSettings() { return Object.assign({}, DEFAULT_SETTINGS, (await load()).settings); },
    async putSettings(s) { (await load()).settings = s; await save(); return s; },

    async listTasks() { return (await load()).tasks.filter(function (t) { return !t.archived; }); },
    async getTask(id) { return (await load()).tasks.filter(function (t) { return t.id === id; })[0] || null; },
    async createTask(t) {
      var db = await load();
      var row = Object.assign({ id: randomUUID(), archived: false, created_at: new Date().toISOString() }, t);
      db.tasks.push(row);
      await save();
      return row;
    },
    async updateTask(id, patch) {
      var t = await this.getTask(id);
      if (!t) return null;
      Object.assign(t, patch, { updated_at: new Date().toISOString() });
      await save();
      return t;
    },

    async listCompletions(opts) {
      var since = opts && opts.since;
      return (await load()).completions.filter(function (c) { return !since || c.day >= since || c.occ === 'once'; });
    },
    async addCompletion(c) {
      var db = await load();
      db.completions = db.completions.filter(function (x) { return !(x.task_id === c.task_id && x.occ === c.occ); });
      db.completions.push(Object.assign({ at: new Date().toISOString() }, c));
      await save();
    },
    async removeCompletion(taskId, occ) {
      var db = await load();
      db.completions = db.completions.filter(function (x) { return !(x.task_id === taskId && x.occ === occ); });
      await save();
    },
    async allCompletionsForStars() {
      return (await load()).completions.filter(function (c) { return c.stars > 0; });
    }
  };
}

// ------------------------------------------------------------------ Supabase
function supabaseStore(env) {
  var clientPromise = import('@supabase/supabase-js').then(function (m) {
    return m.createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  });
  async function q(build) {
    var sb = await clientPromise;
    var r = await build(sb);
    if (r.error) throw new Error('Database: ' + r.error.message);
    return r.data;
  }
  var TASK_COLS = 'id,title,emoji,assignee,slot,stars,schedule,notes,archived,created_at,updated_at';

  return {
    kind: 'supabase',
    async getSettings() {
      var rows = await q(function (sb) { return sb.from('hub_settings').select('value').eq('key', 'settings'); });
      return Object.assign({}, DEFAULT_SETTINGS, rows[0] ? rows[0].value : {});
    },
    async putSettings(s) {
      await q(function (sb) { return sb.from('hub_settings').upsert({ key: 'settings', value: s }); });
      return s;
    },

    async listTasks() {
      return q(function (sb) { return sb.from('hub_tasks').select(TASK_COLS).eq('archived', false).order('created_at'); });
    },
    async getTask(id) {
      var rows = await q(function (sb) { return sb.from('hub_tasks').select(TASK_COLS).eq('id', id); });
      return rows[0] || null;
    },
    async createTask(t) {
      var rows = await q(function (sb) { return sb.from('hub_tasks').insert(t).select(TASK_COLS); });
      return rows[0];
    },
    async updateTask(id, patch) {
      var rows = await q(function (sb) {
        return sb.from('hub_tasks').update(Object.assign({}, patch, { updated_at: new Date().toISOString() })).eq('id', id).select(TASK_COLS);
      });
      return rows[0] || null;
    },

    async listCompletions(opts) {
      var since = opts && opts.since;
      return q(function (sb) {
        var query = sb.from('hub_completions').select('task_id,occ,done_by,day,stars,at');
        if (since) query = query.or('day.gte.' + since + ',occ.eq.once');
        return query;
      });
    },
    async addCompletion(c) {
      await q(function (sb) { return sb.from('hub_completions').upsert(c); });
    },
    async removeCompletion(taskId, occ) {
      await q(function (sb) { return sb.from('hub_completions').delete().eq('task_id', taskId).eq('occ', occ); });
    },
    async allCompletionsForStars() {
      return q(function (sb) { return sb.from('hub_completions').select('done_by,stars').gt('stars', 0); });
    }
  };
}
