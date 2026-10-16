// To-do schedules. Every date here is a local calendar date string, 'YYYY-MM-DD'. The wall
// display sends its own "today", so the server never has to know the household's time zone.
//
// Schedule shapes (stored as JSON on each task):
//   { type: 'once', due?: 'YYYY-MM-DD' }                 one-time; stays on the list until done
//   { type: 'daily',   every: 1, start }                  every N days
//   { type: 'weekly',  every: 1, days: [0..6], start }    on these weekdays (0 = Sunday), every N weeks
//   { type: 'monthly', every: 1, day: 1..31 | -1, start } day of month; -1 (or past month end) = last day
//   { type: 'yearly',  start }                            same month and day as `start` each year
// Recurring schedules may also carry `until: 'YYYY-MM-DD'` (inclusive).

var DAY_MS = 864e5;

export function parseDate(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  var d = new Date(t);
  // Reject 2026-02-31 and friends instead of silently rolling over.
  if (d.getUTCMonth() !== +m[2] - 1) return null;
  return t;
}

export function formatDate(t) {
  return new Date(t).toISOString().slice(0, 10);
}

export function addDays(s, n) {
  return formatDate(parseDate(s) + n * DAY_MS);
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

export function isRecurring(schedule) {
  return !!schedule && schedule.type !== 'once';
}

// Is a recurring schedule due on `date`? One-time tasks are never "due on" a day in this sense;
// tasksForDate() handles them.
export function isDueOn(schedule, date) {
  if (!isRecurring(schedule)) return false;
  var t = parseDate(date), start = parseDate(schedule.start);
  if (t == null || start == null || t < start) return false;
  if (schedule.until && t > parseDate(schedule.until)) return false;
  var every = Math.max(1, schedule.every | 0 || 1);
  var d = new Date(t), s = new Date(start);

  switch (schedule.type) {
    case 'daily':
      return Math.round((t - start) / DAY_MS) % every === 0;

    case 'weekly': {
      var days = schedule.days && schedule.days.length ? schedule.days : [s.getUTCDay()];
      if (days.indexOf(d.getUTCDay()) < 0) return false;
      // Count whole weeks between the Sundays that start each date's week.
      var w0 = start - s.getUTCDay() * DAY_MS, w1 = t - d.getUTCDay() * DAY_MS;
      return Math.round((w1 - w0) / (7 * DAY_MS)) % every === 0;
    }

    case 'monthly': {
      var months = (d.getUTCFullYear() - s.getUTCFullYear()) * 12 + d.getUTCMonth() - s.getUTCMonth();
      if (months % every !== 0) return false;
      var want = schedule.day == null ? s.getUTCDate() : schedule.day | 0;
      var last = daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
      if (want === -1 || want > last) want = last;
      return d.getUTCDate() === want;
    }

    case 'yearly': {
      var years = d.getUTCFullYear() - s.getUTCFullYear();
      if (years % every !== 0 || d.getUTCMonth() !== s.getUTCMonth()) return false;
      // Feb 29 falls back to Feb 28 in common years.
      return d.getUTCDate() === Math.min(s.getUTCDate(), daysInMonth(d.getUTCFullYear(), d.getUTCMonth()));
    }
  }
  return false;
}

// The next date on or after `from` that a recurring schedule is due (searches ~2 years).
export function nextDue(schedule, from) {
  if (!isRecurring(schedule)) return null;
  var t = parseDate(from), start = parseDate(schedule.start);
  if (start != null && start > t) t = start;
  for (var i = 0; i < 800; i++) {
    var s = formatDate(t + i * DAY_MS);
    if (isDueOn(schedule, s)) return s;
    if (schedule.until && s > schedule.until) return null;
  }
  return null;
}

// Occurrence key used to record a completion. Each day of a recurring task is its own occurrence;
// a one-time task has exactly one.
// The times of day a to-do repeats within one day (['morning', 'afternoon'] = twice a day).
export function taskSlots(task) {
  var s = task.schedule && task.schedule.slots;
  return Array.isArray(s) && s.length > 1 && isRecurring(task.schedule) ? s : null;
}

export function occurrenceKey(task, date, slot) {
  if (!isRecurring(task.schedule)) return 'once';
  var slots = taskSlots(task);
  return slots && slots.indexOf(slot) > -1 ? date + '@' + slot : date;
}

// Build the list a display shows for `date`.
//   tasks:       [{ id, title, assignee, schedule, ... }]
//   completions: [{ task_id, occ, done_by, day }]
// Returns tasks with { occ, done, doneBy, due, overdue } added.
//   - Recurring tasks appear only on the days they're due.
//   - Open one-time tasks always appear (flagged overdue once their due date has passed), except
//     ones due in the future when `upcomingDays` is set and the due date is further out than that.
//   - Finished one-time tasks appear only on the day they were finished, so they show as ticked
//     off today and then drop away.
export function tasksForDate(tasks, completions, date, opts) {
  opts = opts || {};
  var byKey = {};
  completions.forEach(function (c) { byKey[c.task_id + '|' + c.occ] = c; });
  var out = [];
  tasks.forEach(function (task) {
    if (task.archived) return;
    var sch = task.schedule || { type: 'once' };
    var occ = occurrenceKey(task, date);
    var c = byKey[task.id + '|' + occ];
    var item;
    if (isRecurring(sch)) {
      if (!isDueOn(sch, date)) return;
      var slots = taskSlots(task);
      if (slots) {
        // One entry per time of day, each ticked off on its own.
        slots.forEach(function (slot) {
          var o = date + '@' + slot, cs = byKey[task.id + '|' + o];
          out.push(Object.assign({}, task, { due: date, overdue: false, slot: slot, key: task.id + '@' + slot, occ: o, done: !!cs, doneBy: cs ? cs.done_by : null }));
        });
        return;
      }
      item = { due: date, overdue: false };
    } else {
      if (c) {
        if (c.day !== date) return;
      } else if (sch.due && opts.upcomingDays != null && sch.due > addDays(date, opts.upcomingDays)) {
        return;
      }
      item = { due: sch.due || null, overdue: !c && !!sch.due && sch.due < date };
    }
    out.push(Object.assign({}, task, item, { key: task.id, occ: occ, done: !!c, doneBy: c ? c.done_by : null }));
  });
  return out.sort(compareTasks);
}

var SLOT_ORDER = { morning: 0, afternoon: 1, evening: 2 };
function compareTasks(a, b) {
  return (a.done - b.done) ||
    (b.overdue - a.overdue) ||
    (slotRank(a) - slotRank(b)) ||
    ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) ||
    String(a.title).localeCompare(String(b.title));
}
function slotRank(t) { return t.slot in SLOT_ORDER ? SLOT_ORDER[t.slot] : 3; }

// Stars earned per person, from completions (each records the stars it was worth at the time).
export function starTotals(completions) {
  var totals = {};
  completions.forEach(function (c) {
    if (c.done_by && c.stars) totals[c.done_by] = (totals[c.done_by] || 0) + c.stars;
  });
  return totals;
}

// Validate and normalise a schedule coming from a client. Throws with a readable message.
export function cleanSchedule(input, today) {
  var s = input || { type: 'once' };
  var type = s.type || 'once';
  if (type === 'once') {
    if (s.due && parseDate(s.due) == null) throw new Error('Due date must be YYYY-MM-DD');
    return s.due ? { type: 'once', due: s.due } : { type: 'once' };
  }
  if (['daily', 'weekly', 'monthly', 'yearly'].indexOf(type) < 0) throw new Error('Unknown repeat type: ' + type);
  var start = s.start || today;
  if (parseDate(start) == null) throw new Error('Start date must be YYYY-MM-DD');
  var out = { type: type, every: Math.min(99, Math.max(1, parseInt(s.every, 10) || 1)), start: start };
  if (s.until) {
    if (parseDate(s.until) == null) throw new Error('End date must be YYYY-MM-DD');
    out.until = s.until;
  }
  if (type === 'weekly') {
    var days = (s.days || []).map(Number).filter(function (d) { return d >= 0 && d <= 6; });
    days = days.filter(function (d, i) { return days.indexOf(d) === i; }).sort();
    out.days = days.length ? days : [new Date(parseDate(start)).getUTCDay()];
  }
  if (type === 'monthly') {
    var day = parseInt(s.day, 10);
    out.day = day === -1 || (day >= 1 && day <= 31) ? day : new Date(parseDate(start)).getUTCDate();
  }
  return out;
}

// "Every Mon, Wed", "Every 2 weeks on Sat", "Monthly on the last day", "Due Fri, Oct 16" ...
var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ordinal(n) {
  var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
export function describeSchedule(s) {
  if (!s || s.type === 'once') {
    if (!s || !s.due) return 'One-time';
    var d = new Date(parseDate(s.due));
    return 'Due ' + DOW[d.getUTCDay()] + ', ' + MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }
  var n = s.every || 1;
  switch (s.type) {
    case 'daily': return n === 1 ? 'Every day' : 'Every ' + n + ' days';
    case 'weekly': {
      var days = s.days || [];
      var label = days.length === 7 ? 'day' :
        days.join() === '1,2,3,4,5' ? 'weekday' :
        days.join() === '0,6' ? 'weekend day' :
        days.map(function (x) { return DOW[x]; }).join(', ');
      return n === 1 ? 'Every ' + label : 'Every ' + n + ' weeks on ' + label;
    }
    case 'monthly': {
      var on = s.day === -1 ? 'the last day' : 'the ' + ordinal(s.day);
      return (n === 1 ? 'Monthly' : 'Every ' + n + ' months') + ' on ' + on;
    }
    case 'yearly': {
      var y = new Date(parseDate(s.start));
      return 'Every year on ' + MON[y.getUTCMonth()] + ' ' + y.getUTCDate();
    }
  }
  return '';
}
