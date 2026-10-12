// Google Calendar sync through each calendar's "Secret address in iCal format". No OAuth: every
// calendar (yours, a partner's, a shared family one, a kid's school calendar) gives you one URL,
// and they can come from any number of Google accounts.
//
// The feed is parsed here, recurring events are expanded into occurrences for the requested
// window (moved and cancelled instances included), and events that show up in several calendars
// (the same invite on two people's calendars) are merged into one with every calendar listed.
import ICAL from 'ical.js';

var MAX_OCCURRENCES = 25000; // per recurring event (a daily series since the 1960s), guards runaway rules

// Convert a wall-clock time in `tz` to a UTC epoch (ms), via Intl so every IANA zone works even
// when the feed has no VTIMEZONE block for it.
var fmtCache = {};
function tzOffset(utcMs, tz) {
  var f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }));
  var p = {};
  f.formatToParts(new Date(utcMs)).forEach(function (x) { p[x.type] = x.value; });
  var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}
export function wallTimeToUtc(y, mo, d, h, mi, s, tz) {
  var guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!tz || tz === 'UTC') return guess;
  try {
    var off = tzOffset(guess, tz);
    var t = guess - off;
    var off2 = tzOffset(t, tz);
    return off2 === off ? t : guess - off2;
  } catch (e) {
    return guess; // unknown zone name: treat as UTC rather than drop the event
  }
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
function dateString(t) { return t.year + '-' + pad(t.month) + '-' + pad(t.day); }

// ICAL.Time -> epoch ms, honouring its zone. ical.js forgets a TZID that has no VTIMEZONE block
// in the feed (the time comes back "floating"), so callers pass the raw TZID parameter as a hint;
// truly floating times use the calendar's default zone.
function toEpoch(t, defaultTz, tzHint) {
  var tzid = t.zone && t.zone.tzid;
  if (tzid === 'UTC' || tzid === 'Z') return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  if (!tzid || tzid === 'floating') tzid = tzHint || defaultTz;
  return wallTimeToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, tzid);
}

function clip(s, n) {
  s = (s || '').replace(/\r/g, '').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Parse one ICS feed and return the occurrences that overlap [fromMs, toMs).
//   cal: { id, name?, color?, person? }; defaultTz: zone for floating times (e.g. 'America/Chicago')
export function expandIcs(text, cal, fromMs, toMs, defaultTz) {
  var root = new ICAL.Component(ICAL.parse(text));
  var feedTz = root.getFirstPropertyValue('x-wr-timezone') || defaultTz || 'UTC';
  var masters = {}, exceptions = [], singles = [];

  root.getAllSubcomponents('vevent').forEach(function (v) {
    var ev = new ICAL.Event(v);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else if (ev.isRecurring()) masters[ev.uid] = ev;
    else singles.push(ev);
  });
  exceptions.forEach(function (ex) {
    if (masters[ex.uid]) masters[ex.uid].relateException(ex);
    else singles.push(ex); // a moved instance whose series isn't in the feed
  });

  function tzParam(component, name) {
    var p = component.getFirstProperty(name);
    return p ? p.getParameter('tzid') : null;
  }

  var out = [];
  function emit(item, start, end) {
    if (String(item.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    if (!end) {
      end = start.clone();
      if (start.isDate) end.day += 1; // all-day with no DTEND lasts one day
    }
    var allDay = start.isDate;
    var startTz = tzParam(item.component, 'dtstart');
    var s = allDay ? Date.UTC(start.year, start.month - 1, start.day) : toEpoch(start, feedTz, startTz);
    var e = allDay ? Date.UTC(end.year, end.month - 1, end.day) : toEpoch(end, feedTz, tzParam(item.component, 'dtend') || startTz);
    if (e <= s) e = allDay ? s + 864e5 : s;
    // All-day events are compared in UTC-midnight terms; pad the window by a day each side so
    // a client in any zone still gets the days it asked for.
    var lo = allDay ? fromMs - 864e5 : fromMs, hi = allDay ? toMs + 864e5 : toMs;
    if (e <= lo && !(e === s && s >= lo) || s >= hi) return;
    out.push({
      uid: item.uid,
      title: clip(item.summary, 200) || '(No title)',
      allDay: allDay,
      start: allDay ? dateString(start) : new Date(s).toISOString(),
      end: allDay ? dateString(end) : new Date(e).toISOString(),
      location: clip(item.location, 200),
      notes: clip(item.description, 600),
      cals: [cal.id]
    });
  }

  singles.forEach(function (ev) { emit(ev, ev.startDate, ev.endDate); });

  Object.keys(masters).forEach(function (uid) {
    var ev = masters[uid];
    var it = ev.iterator();
    var next, n = 0;
    // Event length, so long events that started before the window still count.
    var tz = tzParam(ev.component, 'dtstart');
    var durMs = ev.endDate ? toEpoch(ev.endDate, feedTz, tzParam(ev.component, 'dtend') || tz) - toEpoch(ev.startDate, feedTz, tz) : 0;
    while ((next = it.next()) && n++ < MAX_OCCURRENCES) {
      var startMs = next.isDate ? Date.UTC(next.year, next.month - 1, next.day) : toEpoch(next, feedTz, tz);
      if (startMs >= toMs + 864e5) break;
      if (startMs + Math.max(durMs, 864e5) < fromMs - 864e5) continue;
      var d = ev.getOccurrenceDetails(next);
      emit(d.item, d.startDate, d.endDate);
    }
  });

  return out;
}

// Merge events from several calendars. The same invite on two calendars (same UID and start)
// becomes one event listing both calendars.
export function mergeEvents(lists) {
  var byKey = {}, out = [];
  lists.forEach(function (list) {
    list.forEach(function (ev) {
      var key = ev.uid + '|' + ev.start;
      var seen = byKey[key];
      if (seen) {
        ev.cals.forEach(function (c) { if (seen.cals.indexOf(c) < 0) seen.cals.push(c); });
        return;
      }
      byKey[key] = ev;
      out.push(ev);
    });
  });
  out.sort(function (a, b) {
    return a.start < b.start ? -1 : a.start > b.start ? 1 : (b.allDay - a.allDay) || a.title.localeCompare(b.title);
  });
  out.forEach(function (ev, i) { ev.id = 'ev' + i; delete ev.uid; });
  return out;
}

// Google's settings page shows "webcal://" for some calendars; fetch() only speaks https.
export function normaliseFeedUrl(url) {
  url = String(url || '').trim();
  if (/^webcals?:\/\//i.test(url)) url = 'https://' + url.replace(/^webcals?:\/\//i, '');
  // Plain http is only allowed for the local demo feed (npm run demo).
  var local = !process.env.VERCEL && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url);
  if (!local && !/^https:\/\//i.test(url)) throw new Error('Calendar address must start with https:// (or webcal://)');
  return url;
}

// Fetch and expand every configured calendar. One broken feed doesn't take the others down:
// its error is reported per calendar and the rest still render.
export async function loadCalendars(calendars, fromMs, toMs, defaultTz, fetchImpl) {
  fetchImpl = fetchImpl || fetch;
  var status = [];
  var lists = await Promise.all(calendars.map(async function (cal) {
    try {
      var res = await fetchImpl(normaliseFeedUrl(cal.url), { headers: { accept: 'text/calendar' } });
      if (!res.ok) throw new Error('HTTP ' + res.status + (res.status === 404 ? ' (was the secret address reset?)' : ''));
      var text = await res.text();
      if (text.indexOf('BEGIN:VCALENDAR') < 0) throw new Error('Not an iCal feed — use the "Secret address in iCal format"');
      var events = expandIcs(text, cal, fromMs, toMs, defaultTz);
      status.push({ id: cal.id, ok: true, count: events.length });
      return events;
    } catch (e) {
      status.push({ id: cal.id, ok: false, error: String(e.message || e) });
      return [];
    }
  }));
  return { events: mergeEvents(lists), status: status };
}
