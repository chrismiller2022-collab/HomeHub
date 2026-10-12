// Meal plan and grocery list. Shared by the API (the Meals screen) and the meal-planning assistant.
import { parseDate, addDays } from './schedule.js';

export var SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
var DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function str(v, max) {
  if (v == null) return null;
  v = String(v).trim();
  return v ? v.slice(0, max) : null;
}

export function cleanMeal(input, partial) {
  var m = input || {}, out = {};
  if (!partial || m.date !== undefined) {
    if (parseDate(m.date) == null) throw new Error('Meal date must be YYYY-MM-DD');
    out.date = m.date;
  }
  if (!partial || m.slot !== undefined) {
    var slot = m.slot || 'dinner';
    if (SLOTS.indexOf(slot) < 0) throw new Error('Meal must be one of: ' + SLOTS.join(', '));
    out.slot = slot;
  }
  if (!partial || m.title !== undefined) {
    out.title = str(m.title, 120);
    if (!out.title) throw new Error('A meal needs a name');
  }
  if (!partial || m.recipe_url !== undefined) {
    out.recipe_url = str(m.recipe_url, 600);
    if (out.recipe_url && !/^https?:\/\//i.test(out.recipe_url)) throw new Error('Recipe link must start with http');
  }
  if (!partial || m.notes !== undefined) out.notes = str(m.notes, 500);
  if (!partial || m.ingredients !== undefined) {
    out.ingredients = (Array.isArray(m.ingredients) ? m.ingredients : []).map(function (x) { return str(x, 160); }).filter(Boolean).slice(0, 60);
  }
  return out;
}

export async function mealsBetween(store, from, to) {
  var rows = await store.list('meals', { gte: { date: from }, lte: { date: to }, order: 'date' });
  var rank = function (s) { return SLOTS.indexOf(s); };
  return rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : rank(a.slot) - rank(b.slot); });
}

// Day-by-day view of a date range for the planned slots: what's set and what's still open.
export async function planOverview(store, settings, from, to) {
  var meals = await mealsBetween(store, from, to);
  var slots = settings.mealSlots && settings.mealSlots.length ? settings.mealSlots : ['dinner'];
  var days = [];
  for (var d = from; d <= to; d = addDays(d, 1)) {
    var dayMeals = meals.filter(function (m) { return m.date === d; });
    days.push({
      date: d,
      weekday: DOW[new Date(parseDate(d)).getUTCDay()],
      meals: dayMeals.map(function (m) { return { id: m.id, slot: m.slot, title: m.title, recipe_url: m.recipe_url || null, notes: m.notes || null }; }),
      open: slots.filter(function (s) { return !dayMeals.some(function (m) { return m.slot === s; }); })
    });
  }
  return { planned_slots: slots, days: days };
}

// ------------------------------------------------------------------ groceries
function norm(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

export async function openGroceries(store) {
  return store.list('groceries', { eq: { done: false }, order: 'created_at' });
}

// Add items, skipping ones already on the open list (same name, ignoring case and punctuation).
export async function addGroceries(store, items, opts) {
  opts = opts || {};
  var open = await openGroceries(store);
  var have = {};
  open.forEach(function (g) { have[norm(g.name)] = true; });
  var added = [], skipped = [];
  for (var i = 0; i < items.length && i < 60; i++) {
    var it = typeof items[i] === 'string' ? { name: items[i] } : items[i] || {};
    var name = str(it.name, 120);
    if (!name) continue;
    if (have[norm(name)]) { skipped.push(name); continue; }
    have[norm(name)] = true;
    added.push(await store.insert('groceries', {
      name: name, qty: str(it.qty, 40), note: str(it.note, 160),
      meal_id: opts.meal_id || null, done: false, added_by: opts.by || null
    }));
  }
  return { added: added, already_on_list: skipped };
}
