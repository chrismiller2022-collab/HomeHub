// Meal-planning assistant. Family members text it (or use the chat on the Meals screen) a meal idea
// or a recipe link; it checks which days are open, asks which day and meal, confirms which
// ingredients you already have, then puts the meal on the plan and the rest on the grocery list.
//
// Claude API (Messages + tool use), with a manual loop so each person's conversation is stored and
// continued across texts. History is append-only (required to keep the model's thinking valid);
// a conversation starts fresh after a quiet spell instead of being trimmed.
import Anthropic from '@anthropic-ai/sdk';
import { planOverview, cleanMeal, openGroceries, addGroceries, SLOTS } from './meals.js';
import { fetchRecipe } from './recipes.js';
import { loadCalendars } from './calendar.js';
import { parseDate, addDays } from './schedule.js';

export var DEFAULT_MODEL = 'claude-opus-5-5';
var FRESH_AFTER_MS = 8 * 60 * 60 * 1000; // a new conversation after 8 quiet hours
var MAX_MESSAGES = 120; // …or once one gets this long
var MAX_STEPS = 10; // tool rounds per incoming message

var SYSTEM = [
  'You are the meal-planning helper for a family\'s kitchen wall display ("Home Hub").',
  'Family members message you by text or from the app with a meal idea or a recipe link. Your job is to get it onto the meal plan and get what they need onto the grocery list.',
  '',
  'How to handle a new meal idea or recipe link:',
  '1. If there is a link, call read_recipe to get the dish name and ingredients.',
  '2. Call get_meal_plan for the next 7–10 days so you know which days already have meals and which are open. Calling get_family_schedule for the same days helps you point out busy evenings (practice, late meetings) where a quick meal fits.',
  '3. Unless they already said, ask which day they want it and which meal (breakfast, lunch, dinner or snack — usually dinner). Name the open days so they can just pick one.',
  '4. List the main ingredients briefly and ask which they already have. Skip pantry staples like salt, pepper, oil and water unless the recipe needs a lot of one.',
  '5. Once you have the day and the answer about ingredients, call add_meal, then add_to_grocery_list with only what they need to buy (link the items to the meal). Call get_grocery_list first if helpful, and skip anything already on it.',
  '6. Confirm in one short message: the day and meal, and what went on the grocery list.',
  'Combine questions into one message when you can, so it takes as few texts back and forth as possible. If they answer only part, ask about the rest.',
  '',
  'You can also move or remove meals, show what\'s planned, add or remove grocery items, and suggest meals for open days when asked. Before replacing a meal that\'s already planned for that day and meal, ask.',
  'Never invent recipe ingredients you could not read. If read_recipe finds none, ask them for the main ingredients or plan the meal without them.',
  '',
  'Style: replies are read as text messages. Keep them short and friendly, plain text only (no markdown, no bullet symbols other than simple dashes), and use day names like "Thursday the 15th" rather than ISO dates.',
  'Each message from the family starts with a bracketed line giving today\'s date, who is writing, and how. Use it for "tomorrow", "this weekend", and so on.'
].join('\n');

function tool(name, description, properties, required) {
  return { name: name, description: description, input_schema: { type: 'object', properties: properties, required: required || [] } };
}
var DATE = { type: 'string', description: 'YYYY-MM-DD' };
var TOOLS = [
  tool('get_meal_plan', 'Meals already planned between two dates (inclusive, at most 31 days), and which of the family\'s planned meals (for example dinner) are still open each day.',
    { start_date: DATE, end_date: DATE }, ['start_date', 'end_date']),
  tool('get_family_schedule', 'Calendar events between two dates (at most 14 days), to see which evenings are busy.',
    { start_date: DATE, end_date: DATE }, ['start_date', 'end_date']),
  tool('read_recipe', 'Read a recipe web page: returns the dish name, ingredient list, servings and total time when the page publishes them.',
    { url: { type: 'string' } }, ['url']),
  tool('add_meal', 'Put a meal on the plan.', {
    date: DATE,
    slot: { type: 'string', enum: SLOTS },
    title: { type: 'string', description: 'Short dish name, e.g. "Sheet-pan chicken fajitas"' },
    recipe_url: { type: 'string', description: 'Recipe link, if there is one' },
    notes: { type: 'string', description: 'Optional short note, e.g. "double it for leftovers"' },
    ingredients: { type: 'array', items: { type: 'string' }, description: 'The recipe\'s ingredients, for reference on the display' }
  }, ['date', 'slot', 'title']),
  tool('update_meal', 'Change a planned meal (move it to another day or meal, rename it, change the note). Only include fields that change.', {
    meal_id: { type: 'string' }, date: DATE, slot: { type: 'string', enum: SLOTS }, title: { type: 'string' }, notes: { type: 'string' }
  }, ['meal_id']),
  tool('remove_meal', 'Take a meal off the plan.', { meal_id: { type: 'string' } }, ['meal_id']),
  tool('get_grocery_list', 'Items currently on the grocery list.', {}, []),
  tool('add_to_grocery_list', 'Add items to the grocery list. Items already on the list are skipped automatically.', {
    items: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'string' }, note: { type: 'string' } }, required: ['name'] }
    },
    meal_id: { type: 'string', description: 'The meal these are for, if any' }
  }, ['items']),
  tool('remove_from_grocery_list', 'Remove items from the grocery list by id.', { item_ids: { type: 'array', items: { type: 'string' } } }, ['item_ids'])
];

function span(start, end, maxDays) {
  if (parseDate(start) == null || parseDate(end) == null) throw new Error('Dates must be YYYY-MM-DD');
  if (end < start) throw new Error('end_date is before start_date');
  if ((parseDate(end) - parseDate(start)) / 864e5 > maxDays) throw new Error('Ask for at most ' + maxDays + ' days at a time');
}

// Run one tool call. Returns a JSON-able result; throws for errors the model should see.
async function runTool(name, input, ctx) {
  var store = ctx.store, settings = ctx.settings;
  switch (name) {
    case 'get_meal_plan':
      span(input.start_date, input.end_date, 31);
      return planOverview(store, settings, input.start_date, input.end_date);

    case 'get_family_schedule': {
      span(input.start_date, input.end_date, 14);
      var cals = (settings.calendars || []).filter(function (c) { return !c.hidden; });
      if (!cals.length) return { note: 'No calendars are connected.' };
      // Pad a day each side so every local day is covered whatever the zone.
      var r = await loadCalendars(cals, parseDate(input.start_date) - 864e5, parseDate(addDays(input.end_date, 1)) + 864e5, settings.timezone, ctx.fetchImpl);
      var fmt = new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      var dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
      return {
        events: r.events.filter(function (e) {
          var d = e.allDay ? e.start : dayOf.format(new Date(e.start));
          return d >= input.start_date && d <= input.end_date;
        }).slice(0, 80).map(function (e) {
          return e.allDay ? { all_day: true, date: e.start, title: e.title } : { when: fmt.format(new Date(e.start)), until: fmt.format(new Date(e.end)), title: e.title };
        })
      };
    }

    case 'read_recipe':
      return fetchRecipe(input.url, ctx.fetchImpl);

    case 'add_meal': {
      var meal = cleanMeal(input);
      var clash = await store.list('meals', { eq: { date: meal.date, slot: meal.slot } });
      var row = await store.insert('meals', Object.assign(meal, { created_by: ctx.personId || null }));
      return { added: { id: row.id, date: row.date, slot: row.slot, title: row.title }, note: clash.length ? 'There was already a ' + meal.slot + ' planned that day: ' + clash.map(function (m) { return m.title; }).join(', ') + '. Both are on the plan now.' : undefined };
    }

    case 'update_meal': {
      var patch = cleanMeal(input, true);
      var rows = await store.update('meals', { id: input.meal_id }, patch);
      if (!rows.length) throw new Error('No meal with that id');
      return { updated: { id: rows[0].id, date: rows[0].date, slot: rows[0].slot, title: rows[0].title } };
    }

    case 'remove_meal': {
      var gone = await store.list('meals', { eq: { id: input.meal_id } });
      if (!gone.length) throw new Error('No meal with that id');
      await store.remove('meals', { id: input.meal_id });
      return { removed: gone[0].title + ' on ' + gone[0].date };
    }

    case 'get_grocery_list':
      return { items: (await openGroceries(store)).map(function (g) { return { id: g.id, name: g.name, qty: g.qty || undefined, note: g.note || undefined }; }) };

    case 'add_to_grocery_list': {
      var res = await addGroceries(store, input.items || [], { meal_id: input.meal_id || null, by: ctx.personId });
      return { added: res.added.map(function (g) { return g.name; }), already_on_list: res.already_on_list };
    }

    case 'remove_from_grocery_list': {
      var ids = input.item_ids || [];
      for (var i = 0; i < ids.length; i++) await store.remove('groceries', { id: ids[i] });
      return { removed: ids.length };
    }
  }
  throw new Error('Unknown tool ' + name);
}

function header(ctx) {
  var d = new Date(parseDate(ctx.today));
  var nice = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return '[Today is ' + nice + ' (' + ctx.today + '). From: ' + (ctx.personName || 'a family member') + ', by ' + (ctx.channel === 'sms' ? 'text message' : 'the Home Hub app') + '.]';
}

// Handle one incoming message and return the reply text.
//   ctx: { store, settings, env, convId, personId, personName, channel, today, client?, fetchImpl? }
export async function converse(text, ctx) {
  var env = ctx.env || process.env;
  var client = ctx.client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  var model = env.HUB_AGENT_MODEL || DEFAULT_MODEL;

  var conv = (await ctx.store.list('conversations', { eq: { id: ctx.convId } }))[0];
  var messages = conv && conv.messages ? conv.messages : [];
  var stale = !conv || Date.now() - Date.parse(conv.updated_at) > FRESH_AFTER_MS || messages.length > MAX_MESSAGES;
  if (stale) messages = [];

  var start = messages.length;
  messages.push({ role: 'user', content: [{ type: 'text', text: header(ctx) + '\n' + String(text).slice(0, 4000) }] });

  var reply = '';
  for (var step = 0; step < MAX_STEPS; step++) {
    var response = await client.beta.messages.create({
      model: model,
      max_tokens: 16000,
      // Short conversational turns: low effort keeps replies quick and inexpensive.
      output_config: { effort: env.HUB_AGENT_EFFORT || 'low' },
      // If a safety classifier declines, retry on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      cache_control: { type: 'ephemeral' },
      system: SYSTEM,
      tools: TOOLS,
      messages: messages
    });

    // Keep the whole assistant turn (thinking blocks included) exactly as returned.
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'refusal') {
      reply = 'Sorry, I can’t help with that one. I can plan meals and keep the grocery list.';
      break;
    }
    var uses = response.content.filter(function (b) { return b.type === 'tool_use'; });
    if (response.stop_reason !== 'tool_use' || !uses.length) {
      reply = response.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
      if (response.stop_reason === 'max_tokens' && !reply) reply = 'Sorry, that got long. Could you ask again more simply?';
      break;
    }

    var results = await Promise.all(uses.map(async function (u) {
      try {
        var out = await runTool(u.name, u.input || {}, ctx);
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) };
      } catch (e) {
        return { type: 'tool_result', tool_use_id: u.id, content: String(e.message || e), is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results });
  }

  if (!reply) {
    // Ran out of tool rounds mid-task. Don't save a history that ends on an unanswered tool call.
    messages.length = start;
    return 'Sorry, I got stuck on that. Could you try again?';
  }

  await ctx.store.upsert('conversations', { id: ctx.convId, messages: messages, updated_at: new Date().toISOString() }, ['id']);
  return reply;
}

export { TOOLS as AGENT_TOOLS, runTool as _runTool };
