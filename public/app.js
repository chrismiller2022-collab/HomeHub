// Home Hub wall display. Plain ES2017, no build step, so it runs in the frame's Android WebView
// (target: Chrome/WebView 84+; the wesbos guide upgrades old frames to WebView 106).
(function () {
  'use strict';

  // ================================================================ helpers
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem('hub.' + k));
      localStorage.setItem('hub.' + k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return ymd(a) === ymd(b); }

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function fmtTime(d, short) {
    var h = d.getHours(), m = d.getMinutes();
    var s = (h % 12 || 12) + (m || !short ? ':' + pad(m) : '');
    return s + (short ? (h >= 12 ? 'p' : 'a') : ' ' + (h >= 12 ? 'PM' : 'AM'));
  }
  function fmtDur(ms) {
    var m = Math.round(ms / 60000);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' hr' + (r ? ' ' + r + ' min' : '');
  }

  var ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    check: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7.5 12l3 3 6-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    tick: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'
  };
  function icon(name, size, fill) {
    size = size || 24;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="' + (fill ? 'currentColor' : 'none') +
      '" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  // Lighten a #rrggbb colour toward white (for event backgrounds). No 8-digit hex: old WebViews choke on it.
  function tint(hex, amount) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function mix(c) { return Math.round(c + (255 - c) * amount); }
    return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')';
  }
  function inkOn(hex) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 165 ? '#1D1B18' : '#FFFFFF';
  }

  // ================================================================ state
  var S = {
    view: 'today',
    settings: null,
    tasks: [],
    stars: {},
    events: [],
    eventsRange: null,
    feedStatus: [],
    weather: null,
    calMode: store('calMode') || 'week',
    calAnchor: dayStart(new Date()),
    hiddenCals: store('hiddenCals') || {},
    todoMode: 'today',
    allTasks: null,
    pending: {},
    nightWokenUntil: 0,
    lastTouch: Date.now(),
    online: true
  };

  // ================================================================ API
  // The household key arrives once as ?key=... (bookmark / kiosk URL), then lives in localStorage.
  var urlKey = null; // fallback if this WebView refuses localStorage
  function hubKey() { return store('key') || urlKey || ''; }
  (function takeKeyFromUrl() {
    var m = /[?&]key=([^&#]+)/.exec(location.search);
    if (!m) return;
    urlKey = decodeURIComponent(m[1]);
    store('key', urlKey);
    var clean = location.pathname + location.search.replace(/([?&])key=[^&#]*&?/, '$1').replace(/[?&]$/, '') + location.hash;
    try { history.replaceState(null, '', clean); } catch (e) { /* ignore */ }
  })();

  function api(method, path, body) {
    var opts = { method: method, headers: { 'x-hub-key': hubKey() } };
    if (body) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { showKeyGate(); throw new Error('locked'); }
        if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
        setOnline(true);
        return data;
      });
    }, function (e) { setOnline(false); throw e; });
  }
  function setOnline(on) {
    S.online = on;
    $('#offline').classList.toggle('is-on', !on);
  }

  // ================================================================ people & calendars
  function people() { return (S.settings && S.settings.people) || []; }
  function person(id) {
    var p = people().filter(function (x) { return x.id === id; })[0];
    return p || { id: 'any', name: 'Anyone', color: '#6B655B' };
  }
  function calendars() { return (S.settings && S.settings.calendars) || []; }
  function calById(id) { return calendars().filter(function (c) { return c.id === id; })[0] || { id: id, name: id, color: '#6B655B' }; }
  function evColor(ev) { return calById(ev.cals[0]).color; }
  function evPeople(ev) {
    var ids = [];
    ev.cals.forEach(function (c) { var p = calById(c).person; if (p && ids.indexOf(p) < 0) ids.push(p); });
    return ids;
  }
  function avatar(p, size) {
    size = size || 34;
    return '<span class="avatar" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.45) + 'px;background:' +
      p.color + ';color:' + inkOn(p.color) + '">' + esc(p.id === 'any' ? '★' : p.name.charAt(0)) + '</span>';
  }
  function visibleEvents() {
    return S.events.filter(function (ev) {
      return ev.cals.some(function (c) { return !S.hiddenCals[c]; });
    });
  }

  // Events overlapping a local day. All-day events use date strings (end exclusive); timed use instants.
  function eventsOn(day) {
    var s = dayStart(day), e = addDays(s, 1), key = ymd(s);
    var all = [], timed = [];
    visibleEvents().forEach(function (ev) {
      if (ev.allDay) {
        if (ev.start <= key && ev.end > key) all.push(ev);
      } else {
        var a = new Date(ev.start), b = new Date(ev.end);
        if (a < e && (b > s || (+a === +b && a >= s))) timed.push(ev);
      }
    });
    timed.sort(function (x, y) { return new Date(x.start) - new Date(y.start); });
    return { allDay: all, timed: timed };
  }

  // ================================================================ data loading
  function today() { return ymd(new Date()); }

  function loadState() {
    return api('GET', '/api/state?date=' + today()).then(function (d) {
      var first = !S.settings;
      S.settings = d.settings;
      S.tasks = d.tasks;
      S.stars = d.stars || {};
      if (first) { loadWeather(); }
      render();
    });
  }

  // Fetch a window around what's on screen: the visible week/month plus margin, so paging is instant.
  function wantedRange() {
    var a = S.calMode === 'month' ? new Date(S.calAnchor.getFullYear(), S.calAnchor.getMonth(), 1) : S.calAnchor;
    var from = addDays(dayStart(a), -10), to = addDays(dayStart(a), 45);
    var t = dayStart(new Date());
    if (t < from) from = addDays(t, -1);
    if (addDays(t, 2) > to) to = addDays(t, 3);
    return { from: from, to: to };
  }
  function loadEvents(force) {
    var r = wantedRange();
    if (!force && S.eventsRange && r.from >= S.eventsRange.from && r.to <= S.eventsRange.to) return Promise.resolve();
    return api('GET', '/api/events?from=' + r.from.toISOString() + '&to=' + r.to.toISOString()).then(function (d) {
      S.events = d.events;
      S.feedStatus = d.status || [];
      S.eventsRange = r;
      store('events', { at: Date.now(), range: { from: +r.from, to: +r.to }, events: d.events });
      render();
    });
  }

  var WX = {
    0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Cloudy'],
    45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'], 51: ['🌦️', 'Drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌦️', 'Drizzle'],
    61: ['🌧️', 'Rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
    71: ['🌨️', 'Snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow'],
    80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['🌧️', 'Heavy showers'], 85: ['🌨️', 'Snow showers'], 86: ['🌨️', 'Snow showers'],
    95: ['⛈️', 'Thunderstorms'], 96: ['⛈️', 'Thunderstorms'], 99: ['⛈️', 'Thunderstorms']
  };
  function loadWeather() {
    var loc = S.settings && S.settings.location;
    if (!loc) { S.weather = null; return; }
    var u = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon +
      '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&temperature_unit=' + (S.settings.units === 'celsius' ? 'celsius' : 'fahrenheit') + '&timezone=auto&forecast_days=6';
    fetch(u).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.current) return;
      S.weather = d;
      render();
    }).catch(function () { /* weather is optional */ });
  }

  // ================================================================ rendering
  function render() {
    renderClock();
    $$('.rail-item').forEach(function (b) { b.classList.toggle('is-on', b.dataset.go === S.view); });
    $$('.view').forEach(function (v) { v.classList.toggle('is-on', v.id === 'view-' + S.view); });
    if (!S.settings) return;
    if (S.view === 'today') renderToday();
    if (S.view === 'calendar') renderCalendar();
    if (S.view === 'todos') renderTodos();
    if (S.view === 'settings' && !$('#view-settings').dataset.mounted) renderSettings();
  }

  function renderClock() {
    var n = new Date();
    $('#railClock').innerHTML = fmtTime(n).replace(/ (AM|PM)/, '') + '<small>' + DAYS[n.getDay()].slice(0, 3) + ' ' + n.getDate() + '</small>';
  }

  // ---------------------------------------------------------------- Today
  function weatherBlock() {
    var w = S.weather;
    if (!w) return '';
    var wx = WX[w.current.weather_code] || ['🌡️', ''];
    var d = w.daily;
    return '<div class="weather-now"><div><b class="num">' + Math.round(w.current.temperature_2m) + '°</b>' +
      '<small>' + wx[1] + ' · H ' + Math.round(d.temperature_2m_max[0]) + '° L ' + Math.round(d.temperature_2m_min[0]) + '°' +
      (d.precipitation_probability_max[0] >= 20 ? ' · ' + d.precipitation_probability_max[0] + '% rain' : '') + '</small></div>' +
      '<span class="wx-ico">' + wx[0] + '</span></div>';
  }
  function forecastBlock() {
    var w = S.weather;
    if (!w) return '';
    var d = w.daily;
    var out = '';
    for (var i = 1; i < d.time.length; i++) {
      var wx = WX[d.weather_code[i]] || ['🌡️'];
      out += '<div><span class="faint">' + DAYS[fromYmd(d.time[i]).getDay()].slice(0, 3) + '</span><b>' + wx[0] + '</b>' +
        Math.round(d.temperature_2m_max[i]) + '° <span class="faint">' + Math.round(d.temperature_2m_min[i]) + '°</span></div>';
    }
    return '<div class="forecast">' + out + '</div>';
  }

  function allDayChips(list) {
    if (!list.length) return '';
    return '<div class="allday">' + list.map(function (ev) {
      var c = evColor(ev);
      return '<button class="allday-chip" data-ev="' + ev.id + '" style="background:' + c + ';color:' + inkOn(c) + '">' + esc(ev.title) + '</button>';
    }).join('') + '</div>';
  }

  function evCard(ev, now) {
    var a = new Date(ev.start), b = new Date(ev.end), c = evColor(ev);
    var past = b <= now, live = a <= now && b > now;
    var who = evPeople(ev).map(function (id) { return avatar(person(id), 26); }).join('');
    var meta = [];
    if (ev.location) meta.push(esc(ev.location));
    if (ev.cals.length > 1 || !who) meta.unshift(ev.cals.map(function (id) { return esc(calById(id).name); }).join(' + '));
    return '<button class="ev' + (past ? ' is-past' : '') + (live ? ' is-now' : '') + '" data-ev="' + ev.id + '" style="--c:' + c + '">' +
      '<div class="ev-time num">' + fmtTime(a) + '<small>' + (live ? 'until ' + fmtTime(b) : fmtDur(b - a)) + '</small></div>' +
      '<div class="ev-body"><div class="ev-title">' + esc(ev.title) + '</div>' + (meta.length ? '<div class="ev-meta">' + meta.join(' · ') + '</div>' : '') + '</div>' +
      (who ? '<div class="ev-who">' + who + '</div>' : '') + '</button>';
  }

  function agenda(day, compact) {
    var now = new Date(), on = eventsOn(day);
    if (!on.timed.length && !on.allDay.length) return '<div class="empty">' + (compact ? 'Nothing yet' : 'Nothing on the calendar') + '</div>';
    var html = allDayChips(on.allDay), placedNow = false;
    var timed = compact ? on.timed.slice(0, 4) : on.timed;
    html += '<div class="agenda">';
    timed.forEach(function (ev) {
      if (!compact && sameDay(day, now) && !placedNow && new Date(ev.start) > now) {
        html += '<div class="now-line">' + fmtTime(now) + '</div>';
        placedNow = true;
      }
      html += evCard(ev, now);
    });
    if (compact && on.timed.length > 4) html += '<div class="faint" style="padding:4px 8px">+' + (on.timed.length - 4) + ' more</div>';
    return html + '</div>';
  }

  function renderToday() {
    var now = new Date(), tom = addDays(dayStart(now), 1);
    var el = $('#view-today');
    el.innerHTML =
      '<div class="head"><div class="today-date"><div class="label">' + esc(S.settings.familyName) + '</div>' +
      '<h1>' + DAYS[now.getDay()] + '</h1><div class="sub">' + MONTHS[now.getMonth()] + ' ' + now.getDate() + '</div></div>' + weatherBlock() + '</div>' +
      '<div class="today"><div>' + agenda(now) +
      '<div class="tomorrow"><div class="label" style="margin-bottom:8px">Tomorrow · ' + DAYS[tom.getDay()] + '</div>' + agenda(tom, true) + '</div>' +
      forecastBlock() + '</div>' +
      '<div class="card today-todos"><div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="font-size:24px">To-dos</h2>' +
      '<button class="btn btn--sm btn--dark" data-act="add-todo">' + icon('plus', 18) + 'Add</button></div>' + todoLanes(true) + '</div></div>';
  }

  // ---------------------------------------------------------------- To-dos
  var SLOTS = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']];
  function todoRow(t) {
    var p = person(t.assignee), meta = [];
    if (t.overdue) meta.push('<span class="late">Overdue · ' + esc(t.repeat.replace(/^Due /, 'was due ')) + '</span>');
    else if (t.schedule.type !== 'once') meta.push(esc(t.repeat));
    else if (t.due) meta.push(esc(t.due === today() ? 'Due today' : t.repeat));
    if (t.done && t.doneBy && t.doneBy !== t.assignee) meta.push('by ' + esc(person(t.doneBy).name));
    if (t.stars) meta.push('<span style="color:#C58A00">' + new Array(t.stars + 1).join('★') + '</span>');
    return '<div class="todo' + (t.done ? ' is-done' : '') + (S.pending[t.id] ? ' is-pending' : '') + '" data-hold="' + t.id + '" style="--c:' + p.color + '">' +
      '<button class="todo-check" data-done="' + t.id + '" aria-label="Done">' + '<span style="color:' + inkOn(p.color) + '">' + icon('tick', 22) + '</span></button>' +
      '<button class="todo-text" data-done="' + t.id + '"><div class="todo-title">' + (t.emoji ? esc(t.emoji) + ' ' : '') + esc(t.title) + '</div>' +
      (meta.length ? '<div class="todo-meta">' + meta.join(' · ') + '</div>' : '') + '</button></div>';
  }

  function todoLanes(compact) {
    var lanes = people().map(function (p) { return p.id; }).concat(['any']);
    var html = '';
    lanes.forEach(function (id) {
      var list = S.tasks.filter(function (t) { return t.assignee === id; });
      if (compact && !list.length) return;
      var p = person(id), done = list.filter(function (t) { return t.done; }).length;
      html += '<section class="lane" style="--c:' + p.color + '"><div class="lane-head">' + avatar(p, 40) +
        '<div><b>' + esc(p.name) + '</b><small>' + (list.length ? done + ' of ' + list.length + ' done' : 'Nothing today') + '</small></div>' +
        (p.stars ? '<span class="lane-stars num">' + icon('star', 18, true) + ' ' + (S.stars[id] || 0) + '</span>' : '') + '</div>';
      if (list.length && done === list.length && !compact) html += '<div class="lane-done">All done! 🎉</div>';
      var groups = [['', list.filter(function (t) { return !t.slot; })]].concat(SLOTS.map(function (s) {
        return [s[1], list.filter(function (t) { return t.slot === s[0]; })];
      }));
      groups.forEach(function (g) {
        if (!g[1].length) return;
        if (g[0]) html += '<div class="label slot-label">' + g[0] + '</div>';
        html += g[1].map(todoRow).join('');
      });
      html += '</section>';
    });
    if (!html) html = '<div class="empty">Nothing to do today. Tap <b>Add</b> to create a to-do.</div>';
    return compact ? html : '<div class="lanes">' + html + '</div>';
  }

  function renderTodos() {
    var el = $('#view-todos');
    var left = S.tasks.filter(function (t) { return !t.done; }).length;
    var head = '<div class="head"><div><h1>To-dos</h1><div class="sub">' +
      (S.todoMode === 'today' ? (left ? left + ' left for today' : 'All caught up') + ' · press and hold a to-do to edit it' : 'Everything, including what repeats') + '</div></div>' +
      '<div class="row"><div class="seg"><button data-todo-mode="today" class="' + (S.todoMode === 'today' ? 'is-on' : '') + '">Today</button>' +
      '<button data-todo-mode="all" class="' + (S.todoMode === 'all' ? 'is-on' : '') + '">All</button></div>' +
      '<button class="btn btn--dark" data-act="add-todo">' + icon('plus', 20) + 'Add to-do</button></div></div>';
    if (S.todoMode === 'today') { el.innerHTML = head + todoLanes(false); return; }

    if (!S.allTasks) {
      el.innerHTML = head + '<div class="empty">Loading…</div>';
      api('GET', '/api/tasks?today=' + today()).then(function (d) { S.allTasks = d.tasks; render(); });
      return;
    }
    var order = people().map(function (p) { return p.id; }).concat(['any']);
    var rank = function (id) { var i = order.indexOf(id); return i < 0 ? order.length : i; };
    var rows = S.allTasks.slice().sort(function (a, b) {
      return rank(a.assignee) - rank(b.assignee) || a.title.localeCompare(b.title);
    }).map(function (t) {
      var p = person(t.assignee);
      return '<div class="manage-row">' + avatar(p, 36) + (t.emoji ? '<span class="todo-emoji">' + esc(t.emoji) + '</span>' : '') +
        '<div class="todo-text"><div class="todo-title">' + esc(t.title) + '</div><div class="todo-meta">' + esc(t.repeat) +
        (t.next ? ' · ' + esc(t.next === today() ? 'today' : DAYS[fromYmd(t.next).getDay()].slice(0, 3) + ' ' + MONTHS[fromYmd(t.next).getMonth()].slice(0, 3) + ' ' + fromYmd(t.next).getDate()) : '') +
        (t.slot ? ' · ' + t.slot : '') + '</div></div>' +
        '<button class="btn btn--sm" data-edit="' + t.id + '">Edit</button></div>';
    }).join('');
    el.innerHTML = head + '<div class="card">' + (rows || '<div class="empty">No to-dos yet.</div>') + '</div>';
  }

  function findTask(id) {
    return S.tasks.filter(function (t) { return t.id === id; })[0] || (S.allTasks || []).filter(function (t) { return t.id === id; })[0];
  }

  function toggleDone(id) {
    var t = S.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t || S.pending[id]) return;
    if (t.done) {
      t.done = false;
      render();
      api('DELETE', '/api/tasks/' + id + '/done?date=' + today()).then(loadState, function (e) { toast(e.message); loadState(); });
      return;
    }
    if (t.assignee === 'any' && people().length) return whoDidIt(t);
    complete(t, null);
  }

  function complete(t, by) {
    S.pending[t.id] = true;
    render();
    api('POST', '/api/tasks/' + t.id + '/done', { date: today(), by: by }).then(function () {
      delete S.pending[t.id];
      t.done = true;
      t.doneBy = by || t.assignee;
      var earner = person(t.doneBy);
      toast('<b>' + esc(t.title) + '</b> done' + (t.stars && earner.stars ? ' · +' + t.stars + '★ ' + esc(earner.name) : ''), function () {
        api('DELETE', '/api/tasks/' + t.id + '/done?date=' + today()).then(loadState);
      });
      return loadState();
    }).catch(function (e) {
      delete S.pending[t.id];
      toast(e.message);
      render();
    });
  }

  function whoDidIt(t) {
    sheet('<h2>Who did “' + esc(t.title) + '”?</h2><div class="choice choice--who">' + people().map(function (p) {
      return '<button data-by="' + p.id + '" style="--c:' + p.color + '">' + avatar(p, 28) + ' ' + esc(p.name) + '</button>';
    }).join('') + '</div><div class="sheet-actions"><button class="btn" data-close>Cancel</button></div>', function (root, close) {
      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-by]');
        if (!b) return;
        close();
        complete(t, b.dataset.by);
      });
    });
  }

  // ---------------------------------------------------------------- To-do editor
  var EMOJI = ['🧹', '🍽️', '🧺', '🛏️', '🗑️', '♻️', '🐶', '🐱', '🪴', '📚', '🎹', '🦷', '🚿', '🛒', '💊', '💳', '📞', '🚗', '✉️', '🎁'];
  var DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function editTodo(existing) {
    var t = existing ? JSON.parse(JSON.stringify(existing)) : {
      title: '', emoji: '', assignee: people()[0] ? people()[0].id : 'any', slot: null, stars: 0, notes: '',
      schedule: { type: 'once' }
    };
    var sch = t.schedule;
    var draft = {
      type: sch.type, due: sch.due || '', every: sch.every || 1,
      days: sch.days || [new Date().getDay()], day: sch.day || new Date().getDate(),
      start: sch.start || today(), until: sch.until || ''
    };

    function scheduleFields() {
      var every = function (unit) {
        return '<label class="field" style="max-width:150px"><span>Every</span><select class="input" data-f="every">' +
          [1, 2, 3, 4, 5, 6].map(function (n) { return '<option value="' + n + '"' + (n === +draft.every ? ' selected' : '') + '>' + (n === 1 ? unit : n + ' ' + unit + 's') + '</option>'; }).join('') + '</select></label>';
      };
      var start = '<label class="field"><span>Starting</span><input class="input" type="date" data-f="start" value="' + draft.start + '"></label>' +
        '<label class="field"><span>Until (optional)</span><input class="input" type="date" data-f="until" value="' + draft.until + '"></label>';
      switch (draft.type) {
        case 'once':
          return '<label class="field"><span>Due date (optional — stays on the list until done)</span><input class="input" type="date" data-f="due" value="' + draft.due + '"></label>';
        case 'daily':
          return '<div class="row">' + every('day') + start + '</div>';
        case 'weekly':
          return '<div class="field"><span>On</span><div class="choice" data-days>' + DOW_SHORT.map(function (d, i) {
            return '<button type="button" data-day="' + i + '" class="' + (draft.days.indexOf(i) > -1 ? 'is-on' : '') + '">' + d + '</button>';
          }).join('') + '</div></div><div class="row">' + every('week') + start + '</div>';
        case 'monthly':
          return '<div class="row">' + every('month') + '<label class="field"><span>On day</span><select class="input" data-f="day">' +
            Array.apply(null, Array(31)).map(function (_, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === +draft.day ? ' selected' : '') + '>' + (i + 1) + '</option>'; }).join('') +
            '<option value="-1"' + (+draft.day === -1 ? ' selected' : '') + '>Last day</option></select></label></div><div class="row">' + start + '</div>';
        case 'yearly':
          return '<div class="row"><label class="field"><span>Every year on</span><input class="input" type="date" data-f="start" value="' + draft.start + '"></label></div>';
      }
      return '';
    }

    function body() {
      return '<h2>' + (existing ? 'Edit to-do' : 'New to-do') + '</h2><div class="form">' +
        '<label class="field"><span>What needs doing?</span><input class="input" data-f="title" maxlength="120" value="' + esc(t.title) + '" placeholder="Take out the trash"></label>' +
        '<div class="field"><span>Icon</span><div class="choice emoji-pick">' + ['' ].concat(EMOJI).map(function (e) {
          return '<button type="button" data-emoji="' + e + '" class="' + ((t.emoji || '') === e ? 'is-on' : '') + '">' + (e || '–') + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><span>Who</span><div class="choice choice--who">' + people().concat([person('any')]).map(function (p) {
          return '<button type="button" data-who="' + p.id + '" style="--c:' + p.color + '" class="' + (t.assignee === p.id ? 'is-on' : '') + '">' + esc(p.name) + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><span>Repeat</span><div class="choice">' + [['once', 'One-time'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']].map(function (o) {
          return '<button type="button" data-type="' + o[0] + '" class="' + (draft.type === o[0] ? 'is-on' : '') + '">' + o[1] + '</button>';
        }).join('') + '</div></div>' +
        '<div data-sched>' + scheduleFields() + '</div>' +
        '<div class="field"><span>Time of day</span><div class="choice">' + [[null, 'Any time']].concat(SLOTS).map(function (o) {
          return '<button type="button" data-slot="' + (o[0] || '') + '" class="' + ((t.slot || '') === (o[0] || '') ? 'is-on' : '') + '">' + o[1] + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><span>Stars (for kids who collect them)</span><div class="choice">' + [0, 1, 2, 3, 5].map(function (n) {
          return '<button type="button" data-stars="' + n + '" class="' + (+t.stars === n ? 'is-on' : '') + '">' + (n ? n + '★' : 'None') + '</button>';
        }).join('') + '</div></div>' +
        '</div><div class="sheet-actions">' + (existing ? '<button class="btn btn--danger" data-act="delete">Delete</button><span class="spacer"></span>' : '') +
        '<button class="btn" data-close>Cancel</button><button class="btn btn--dark" data-act="save">Save</button></div>';
    }

    sheet(body(), function (root, close) {
      function readInputs() {
        $$('[data-f]', root).forEach(function (i) {
          if (i.dataset.f === 'title') t.title = i.value;
          else draft[i.dataset.f] = i.value;
        });
      }
      function rerender() { readInputs(); root.innerHTML = body(); }
      root.addEventListener('click', function (e) {
        var b;
        if ((b = e.target.closest('[data-emoji]'))) { readInputs(); t.emoji = b.dataset.emoji; return rerender(); }
        if ((b = e.target.closest('[data-who]'))) { readInputs(); t.assignee = b.dataset.who; return rerender(); }
        if ((b = e.target.closest('[data-type]'))) { readInputs(); draft.type = b.dataset.type; return rerender(); }
        if ((b = e.target.closest('[data-slot]'))) { readInputs(); t.slot = b.dataset.slot || null; return rerender(); }
        if ((b = e.target.closest('[data-stars]'))) { readInputs(); t.stars = +b.dataset.stars; return rerender(); }
        if ((b = e.target.closest('[data-day]'))) {
          readInputs();
          var d = +b.dataset.day, i = draft.days.indexOf(d);
          if (i > -1 && draft.days.length > 1) draft.days.splice(i, 1); else if (i < 0) draft.days.push(d);
          return rerender();
        }
        if ((b = e.target.closest('[data-act="delete"]'))) {
          if (!confirm('Delete “' + t.title + '”? Its history is kept.')) return;
          api('DELETE', '/api/tasks/' + existing.id).then(function () { close(); afterTaskChange('Deleted'); }, function (err) { toast(err.message); });
          return;
        }
        if ((b = e.target.closest('[data-act="save"]'))) {
          readInputs();
          var schedule = { type: draft.type };
          if (draft.type === 'once') { if (draft.due) schedule.due = draft.due; }
          else {
            schedule.every = +draft.every || 1;
            schedule.start = draft.start || today();
            if (draft.until) schedule.until = draft.until;
            if (draft.type === 'weekly') schedule.days = draft.days;
            if (draft.type === 'monthly') schedule.day = +draft.day;
          }
          var payload = { task: { title: t.title, emoji: t.emoji || null, assignee: t.assignee, slot: t.slot, stars: t.stars, notes: t.notes, schedule: schedule }, today: today() };
          var req = existing ? api('PUT', '/api/tasks/' + existing.id, payload) : api('POST', '/api/tasks', payload);
          b.disabled = true;
          req.then(function () { close(); afterTaskChange(existing ? 'Saved' : 'Added'); }, function (err) { b.disabled = false; toast(err.message); });
        }
      });
    });
    setTimeout(function () { var i = $('[data-f="title"]'); if (i && !existing) i.focus(); }, 50);
  }

  function afterTaskChange(msg) {
    S.allTasks = null;
    toast(msg);
    loadState();
  }

  // ---------------------------------------------------------------- Calendar
  function weekStart(d) {
    var ws = (S.settings && S.settings.weekStartsOn) || 0;
    var x = dayStart(d);
    return addDays(x, -((x.getDay() - ws + 7) % 7));
  }

  function pill(ev) {
    var c = evColor(ev);
    if (ev.allDay) return '<button class="pill pill--allday" data-ev="' + ev.id + '" style="--c:' + c + ';color:' + inkOn(c) + '"><b>' + esc(ev.title) + '</b></button>';
    var a = new Date(ev.start);
    return '<button class="pill" data-ev="' + ev.id + '" style="--c:' + c + ';--cl:' + tint(c, 0.85) + '"><b>' + esc(ev.title) + '</b><small>' + fmtTime(a, true) +
      (ev.location ? ' · ' + esc(ev.location) : '') + '</small></button>';
  }

  function renderCalendar() {
    var el = $('#view-calendar');
    var a = S.calAnchor, title, grid = '';
    if (S.calMode === 'week') {
      var ws = weekStart(a), we = addDays(ws, 6);
      title = MONTHS[ws.getMonth()].slice(0, 3) + ' ' + ws.getDate() + ' – ' + (we.getMonth() !== ws.getMonth() ? MONTHS[we.getMonth()].slice(0, 3) + ' ' : '') + we.getDate();
      grid = '<div class="week">';
      for (var i = 0; i < 7; i++) {
        var d = addDays(ws, i), on = eventsOn(d);
        grid += '<div class="wday' + (sameDay(d, new Date()) ? ' is-today' : '') + '"><div class="wday-head"><small>' + DAYS[d.getDay()].slice(0, 3) + '</small><b>' + d.getDate() + '</b></div>' +
          on.allDay.map(pill).join('') + on.timed.map(pill).join('') + '</div>';
      }
      grid += '</div>';
    } else {
      var first = new Date(a.getFullYear(), a.getMonth(), 1), gs = weekStart(first);
      title = MONTHS[a.getMonth()] + ' ' + a.getFullYear();
      grid = '<div class="month">';
      for (var k = 0; k < 7; k++) grid += '<div class="month-dow">' + DAYS[addDays(gs, k).getDay()].slice(0, 3) + '</div>';
      for (var j = 0; j < 42; j++) {
        var md = addDays(gs, j), mon = eventsOn(md), list = mon.allDay.concat(mon.timed);
        if (j === 35 && md.getMonth() !== a.getMonth()) break;
        grid += '<button class="mday' + (md.getMonth() !== a.getMonth() ? ' is-other' : '') + (sameDay(md, new Date()) ? ' is-today' : '') + '" data-day="' + ymd(md) + '">' +
          '<span class="mday-num">' + md.getDate() + '</span>' + list.slice(0, 3).map(function (ev) {
            var c = evColor(ev);
            return ev.allDay ? '<span class="mpill mpill--allday" style="--c:' + c + ';color:' + inkOn(c) + '">' + esc(ev.title) + '</span>' :
              '<span class="mpill"><i class="dot" style="background:' + c + '"></i><span>' + esc(ev.title) + '</span></span>';
          }).join('') + (list.length > 3 ? '<span class="mmore">+' + (list.length - 3) + ' more</span>' : '') + '</button>';
      }
      grid += '</div>';
    }

    var filters = calendars().length > 1 ? '<div class="cal-filters">' + calendars().map(function (c) {
      return '<button class="cal-filter' + (S.hiddenCals[c.id] ? ' is-off' : '') + '" data-cal="' + c.id + '"><i class="dot" style="background:' + c.color + '"></i>' + esc(c.name) + '</button>';
    }).join('') + '</div>' : '';
    var broken = S.feedStatus.filter(function (s) { return !s.ok; });
    var warn = broken.length ? '<div class="card" style="margin-bottom:14px;color:var(--bad)">Couldn’t load: ' + broken.map(function (s) { return esc(calById(s.id).name) + ' (' + esc(s.error) + ')'; }).join(', ') + '</div>' : '';
    var none = !calendars().length ? '<div class="empty" style="margin-bottom:14px">No calendars yet. Add your Google Calendars in <b>Settings</b>.</div>' : '';

    el.innerHTML = '<div class="cal-head"><h1>' + title + '</h1>' +
      '<div class="seg"><button data-cal-mode="week" class="' + (S.calMode === 'week' ? 'is-on' : '') + '">Week</button><button data-cal-mode="month" class="' + (S.calMode === 'month' ? 'is-on' : '') + '">Month</button></div>' +
      '<button class="icon-btn" data-cal-step="-1" aria-label="Previous">' + icon('left') + '</button>' +
      '<button class="btn btn--sm" data-cal-step="0">Today</button>' +
      '<button class="icon-btn" data-cal-step="1" aria-label="Next">' + icon('right') + '</button></div>' +
      none + warn + filters + grid;
  }

  function stepCalendar(n) {
    if (n === 0) S.calAnchor = dayStart(new Date());
    else if (S.calMode === 'week') S.calAnchor = addDays(S.calAnchor, 7 * n);
    else S.calAnchor = new Date(S.calAnchor.getFullYear(), S.calAnchor.getMonth() + n, 1);
    render();
    loadEvents().catch(function () {});
  }

  function showEvent(id) {
    var ev = S.events.filter(function (e) { return e.id === id; })[0];
    if (!ev) return;
    var when;
    if (ev.allDay) {
      var s = fromYmd(ev.start), e = addDays(fromYmd(ev.end), -1);
      when = DAYS[s.getDay()] + ', ' + MONTHS[s.getMonth()] + ' ' + s.getDate() + (ymd(s) !== ymd(e) ? ' – ' + DAYS[e.getDay()] + ', ' + MONTHS[e.getMonth()] + ' ' + e.getDate() : '') + ' · All day';
    } else {
      var a = new Date(ev.start), b = new Date(ev.end);
      when = DAYS[a.getDay()] + ', ' + MONTHS[a.getMonth()] + ' ' + a.getDate() + ' · ' + fmtTime(a) + ' – ' + fmtTime(b);
    }
    sheet('<div class="label">' + ev.cals.map(function (c) { return '<i class="dot" style="background:' + calById(c).color + '"></i> ' + esc(calById(c).name); }).join(' &nbsp; ') + '</div>' +
      '<h2 style="margin-top:8px">' + esc(ev.title) + '</h2><p style="font-size:19px">' + when + '</p>' +
      (ev.location ? '<p class="muted" style="margin-top:10px;font-size:17px">' + icon('pin', 18) + ' ' + esc(ev.location) + '</p>' : '') +
      (ev.notes ? '<p style="margin-top:14px;white-space:pre-wrap;font-size:16px;line-height:1.45">' + esc(ev.notes) + '</p>' : '') +
      '<div class="sheet-actions"><button class="btn btn--dark" data-close>Close</button></div>');
  }

  // ---------------------------------------------------------------- Settings
  var draftSettings = null;
  function renderSettings() {
    var el = $('#view-settings');
    el.dataset.mounted = '1';
    el.innerHTML = '<div class="head"><div><h1>Settings</h1><div class="sub">Easiest from a phone or laptop: open this page there with the same link.</div></div></div><div class="empty">Loading…</div>';
    api('GET', '/api/settings').then(function (d) {
      draftSettings = d.settings;
      drawSettings();
    }, function (e) { el.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  function drawSettings() {
    var s = draftSettings, el = $('#view-settings');
    var statusFor = function (id) {
      var st = S.feedStatus.filter(function (x) { return x.id === id; })[0];
      if (!st) return '';
      return st.ok ? '<span class="status-ok">Synced · ' + st.count + ' events in view</span>' : '<span class="status-bad">' + esc(st.error) + '</span>';
    };
    var personOpts = function (sel) {
      return '<option value="">Nobody in particular</option>' + s.people.map(function (p, i) {
        return '<option value="' + esc(p.id || ('new' + i)) + '"' + (p.id && p.id === sel ? ' selected' : '') + '>' + esc(p.name || '(unnamed)') + '</option>';
      }).join('');
    };
    el.innerHTML = '<div class="head"><div><h1>Settings</h1><div class="sub">Easiest from a phone or laptop: open this page there with the same link.</div></div>' +
      '<button class="btn btn--dark" data-act="save-settings">Save</button></div><div class="settings">' +

      '<section class="card form"><h2>Household</h2><div class="row">' +
      '<label class="field"><span>Name shown on the display</span><input class="input" data-s="familyName" value="' + esc(s.familyName) + '"></label>' +
      '<label class="field"><span>Time zone</span><input class="input" data-s="timezone" value="' + esc(s.timezone) + '" placeholder="America/Chicago"></label></div>' +
      '<div class="row"><label class="field"><span>Weather location</span><input class="input" data-loc-q value="' + esc(s.location ? s.location.name : '') + '" placeholder="City or ZIP"></label>' +
      '<button class="btn" data-act="find-loc" style="align-self:flex-end">Find</button></div><div data-loc-results class="choice"></div>' +
      (s.location ? '<p class="help">Weather for ' + esc(s.location.name) + ' (' + s.location.lat.toFixed(2) + ', ' + s.location.lon.toFixed(2) + ') · <button class="faint" data-act="clear-loc"><u>remove</u></button></p>' : '') +
      '<div class="row"><label class="field"><span>Units</span><select class="input" data-s="units"><option value="fahrenheit"' + (s.units !== 'celsius' ? ' selected' : '') + '>°F</option><option value="celsius"' + (s.units === 'celsius' ? ' selected' : '') + '>°C</option></select></label>' +
      '<label class="field"><span>Week starts</span><select class="input" data-s="weekStartsOn"><option value="0"' + (s.weekStartsOn !== 1 ? ' selected' : '') + '>Sunday</option><option value="1"' + (s.weekStartsOn === 1 ? ' selected' : '') + '>Monday</option></select></label>' +
      '<label class="field"><span>Dim screen from</span><select class="input" data-s="nightStart">' + hourOpts(s.nightStart) + '</select></label>' +
      '<label class="field"><span>until</span><select class="input" data-s="nightEnd">' + hourOpts(s.nightEnd) + '</select></label></div></section>' +

      '<section class="card form"><h2>People</h2><p class="help">Everyone who gets to-dos. Turn on stars for kids who earn them.</p>' +
      s.people.map(function (p, i) {
        return '<div class="list-item"><div class="row"><label class="field"><span>Name</span><input class="input" data-p="' + i + '" data-k="name" value="' + esc(p.name) + '"></label>' +
          '<label class="field" style="flex:none;min-width:0"><span>Color</span><input class="color" type="color" data-p="' + i + '" data-k="color" value="' + esc(p.color) + '"></label>' +
          '<label class="check-row"><input type="checkbox" data-p="' + i + '" data-k="stars"' + (p.stars ? ' checked' : '') + '> Stars</label>' +
          '<button class="btn btn--sm btn--danger" data-del-person="' + i + '">Remove</button></div></div>';
      }).join('') + '<div><button class="btn btn--sm" data-act="add-person">' + icon('plus', 16) + ' Add person</button></div></section>' +

      '<section class="card form"><h2>Google Calendars</h2><p class="help">For each calendar: open Google Calendar on a computer → Settings (gear) → click the calendar under “Settings for my calendars” → ' +
      '“Integrate calendar” → copy <b>Secret address in iCal format</b>. Shared and family calendars work too, from any Google account. ' +
      'Treat that address like a password. Changes in Google show up here within ~5–10 minutes.</p>' +
      s.calendars.map(function (c, i) {
        return '<div class="list-item"><div class="row"><label class="field"><span>Name</span><input class="input" data-c="' + i + '" data-k="name" value="' + esc(c.name) + '"></label>' +
          '<label class="field" style="flex:none;min-width:0"><span>Color</span><input class="color" type="color" data-c="' + i + '" data-k="color" value="' + esc(c.color) + '"></label>' +
          '<label class="field"><span>Whose calendar</span><select class="input" data-c="' + i + '" data-k="person">' + personOpts(c.person) + '</select></label></div>' +
          '<label class="field"><span>Secret address in iCal format</span><input class="input" data-c="' + i + '" data-k="url" value="' + esc(c.url) + '" placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics" autocomplete="off"></label>' +
          '<div class="row"><label class="check-row"><input type="checkbox" data-c="' + i + '" data-k="hidden"' + (c.hidden ? ' checked' : '') + '> Hide on the display</label>' +
          '<span style="flex:1">' + statusFor(c.id) + '</span><button class="btn btn--sm btn--danger" data-del-cal="' + i + '">Remove</button></div></div>';
      }).join('') + '<div><button class="btn btn--sm" data-act="add-cal">' + icon('plus', 16) + ' Add calendar</button></div></section>' +

      '<section class="card form"><h2>This screen</h2><p class="help">Signed in with a household key. ' +
      '<button class="faint" data-act="forget-key"><u>Sign this screen out</u></button></p></section>' +
      '<div><button class="btn btn--dark" data-act="save-settings">Save settings</button></div></div>';
  }

  function hourOpts(sel) {
    var out = '';
    for (var h = 0; h <= 24; h++) out += '<option value="' + h + '"' + (h === +sel ? ' selected' : '') + '>' + (h === 24 ? 'Midnight' : fmtTime(new Date(2000, 0, 1, h, 0))) + '</option>';
    return out + '';
  }

  function readSettingsForm() {
    var s = draftSettings, el = $('#view-settings');
    $$('[data-s]', el).forEach(function (i) {
      s[i.dataset.s] = i.dataset.s === 'weekStartsOn' || i.dataset.s === 'nightStart' || i.dataset.s === 'nightEnd' ? +i.value : i.value;
    });
    $$('[data-p]', el).forEach(function (i) { s.people[+i.dataset.p][i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value; });
    $$('[data-c]', el).forEach(function (i) {
      var v = i.type === 'checkbox' ? i.checked : i.value;
      s.calendars[+i.dataset.c][i.dataset.k] = v;
    });
  }

  function settingsClick(e) {
    var b = e.target.closest('[data-act],[data-del-person],[data-del-cal],[data-loc-pick]');
    if (!b || !draftSettings) return;
    readSettingsForm();
    var s = draftSettings;
    if (b.dataset.delPerson != null) { s.people.splice(+b.dataset.delPerson, 1); return drawSettings(); }
    if (b.dataset.delCal != null) { s.calendars.splice(+b.dataset.delCal, 1); return drawSettings(); }
    if (b.dataset.locPick != null) { s.location = JSON.parse(b.dataset.locPick); return drawSettings(); }
    switch (b.dataset.act) {
      case 'add-person':
        var palette = ['#2F6BFF', '#E4007C', '#00A36C', '#FFB000', '#8A4DFF', '#FF6B2C', '#00A3C4'];
        s.people.push({ name: '', color: palette[s.people.length % palette.length], stars: false });
        return drawSettings();
      case 'add-cal':
        s.calendars.push({ name: '', url: '', color: '#2F6BFF', person: null, hidden: false });
        return drawSettings();
      case 'clear-loc':
        s.location = null;
        return drawSettings();
      case 'find-loc':
        var q = $('[data-loc-q]').value.trim();
        if (!q) return;
        fetch('https://geocoding-api.open-meteo.com/v1/search?count=5&name=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (d) {
          var box = $('[data-loc-results]');
          if (!d.results || !d.results.length) { box.innerHTML = '<span class="faint">No match. Try a city name.</span>'; return; }
          box.innerHTML = d.results.map(function (r) {
            var loc = { name: r.name + (r.admin1 ? ', ' + r.admin1 : ''), lat: r.latitude, lon: r.longitude };
            return '<button data-loc-pick="' + esc(JSON.stringify(loc)) + '">' + esc(loc.name + (r.country_code ? ' (' + r.country_code + ')' : '')) + '</button>';
          }).join('');
        }).catch(function () { toast('Location search failed'); });
        return;
      case 'forget-key':
        store('key', null);
        location.reload();
        return;
      case 'save-settings':
        api('PUT', '/api/settings', { settings: s }).then(function () {
          toast('Settings saved');
          $('#view-settings').dataset.mounted = '';
          S.eventsRange = null;
          return loadState().then(function () { loadWeather(); return loadEvents(true); }).then(function () { if (S.view === 'settings') renderSettings(); });
        }, function (err) { toast(err.message); });
    }
  }

  // ================================================================ UI plumbing
  function sheet(html, onMount) {
    var layer = $('#sheetLayer');
    layer.innerHTML = '<div class="sheet" role="dialog">' + html + '</div>';
    layer.classList.add('is-on');
    var root = layer.firstChild;
    function close() { layer.classList.remove('is-on'); layer.innerHTML = ''; }
    layer.onclick = function (e) { if (e.target === layer || e.target.closest('[data-close]')) close(); };
    if (onMount) onMount(root, close);
  }

  function toast(html, undo) {
    var box = $('#toasts');
    var t = document.createElement('div');
    t.className = 'toast' + (undo ? '' : ' toast--plain');
    t.innerHTML = '<span>' + html + '</span>' + (undo ? '<button>Undo</button>' : '');
    box.appendChild(t);
    var gone = setTimeout(function () { t.remove(); }, undo ? 6000 : 3000);
    if (undo) t.querySelector('button').onclick = function () { clearTimeout(gone); t.remove(); undo(); };
  }

  function showKeyGate() {
    $('#shell').innerHTML = '<div class="key-gate card form"><h2>Household key</h2><p class="help">Enter the key you set as ACCESS_KEY when deploying. ' +
      'Tip: load the display once as <code>https://your-site/?key=…</code> and it’s remembered.</p>' +
      '<input class="input" id="keyInput" type="password" autocomplete="off"><button class="btn btn--dark" id="keySave">Unlock</button></div>';
    $('#keySave').onclick = function () { store('key', $('#keyInput').value.trim()); location.reload(); };
  }

  function go(view) {
    S.view = view;
    if (view === 'calendar') loadEvents().catch(function () {});
    if (view === 'settings') $('#view-settings').dataset.mounted = '';
    if (view === 'todos') S.allTasks = null;
    render();
    $('#view-' + view).scrollTop = 0;
  }

  // Press and hold a to-do to edit it (the wall display has no hover or right-click).
  var hold = { timer: 0, fired: false, x: 0, y: 0 };
  document.addEventListener('pointerdown', function (e) {
    var row = e.target.closest('[data-hold]');
    hold.fired = false;
    clearTimeout(hold.timer);
    if (!row) return;
    hold.x = e.clientX; hold.y = e.clientY;
    hold.timer = setTimeout(function () { hold.fired = true; editTodo(findTask(row.dataset.hold)); }, 600);
  });
  document.addEventListener('pointermove', function (e) {
    if (Math.abs(e.clientX - hold.x) + Math.abs(e.clientY - hold.y) > 12) clearTimeout(hold.timer);
  });
  ['pointerup', 'pointercancel'].forEach(function (t) { document.addEventListener(t, function () { clearTimeout(hold.timer); }); });
  document.addEventListener('contextmenu', function (e) { if (e.target.closest('[data-hold]')) e.preventDefault(); });

  document.addEventListener('click', function (e) {
    if (hold.fired) { hold.fired = false; return; }
    var b = e.target.closest('button, [data-ev], [data-day]');
    if (!b) return;
    if (b.dataset.go) return go(b.dataset.go);
    if (b.dataset.ev) return showEvent(b.dataset.ev);
    if (b.closest('#sheetLayer')) return;
    if (b.dataset.done) return toggleDone(b.dataset.done);
    if (b.dataset.edit) return editTodo(findTask(b.dataset.edit));
    if (b.dataset.act === 'add-todo') return editTodo(null);
    if (b.dataset.todoMode) { S.todoMode = b.dataset.todoMode; return render(); }
    if (b.dataset.calMode) { S.calMode = b.dataset.calMode; store('calMode', S.calMode); render(); return loadEvents().catch(function () {}); }
    if (b.dataset.calStep != null) return stepCalendar(+b.dataset.calStep);
    if (b.dataset.cal) {
      if (S.hiddenCals[b.dataset.cal]) delete S.hiddenCals[b.dataset.cal]; else S.hiddenCals[b.dataset.cal] = true;
      store('hiddenCals', S.hiddenCals);
      return render();
    }
    if (b.dataset.day && b.classList.contains('mday')) {
      S.calAnchor = fromYmd(b.dataset.day);
      S.calMode = 'week';
      render();
      return loadEvents().catch(function () {});
    }
    if (b.closest('#view-settings')) return settingsClick(e);
  });

  // ================================================================ wall-display behaviour
  function isNightHour() {
    if (!S.settings) return false;
    var h = new Date().getHours(), a = S.settings.nightStart, b = S.settings.nightEnd;
    if (a === b) return false;
    return a < b ? h >= a && h < b : h >= a || h < b;
  }
  function updateNight() {
    var on = isNightHour() && Date.now() > S.nightWokenUntil;
    $('#night').classList.toggle('is-on', on);
  }
  $('#night').addEventListener('click', function () {
    S.nightWokenUntil = Date.now() + 2 * 60 * 1000; // tap to wake for two minutes
    updateNight();
  });
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) {
    document.addEventListener(t, function () { S.lastTouch = Date.now(); }, { passive: true });
  });

  var lastDay = today();
  function tick() {
    renderClock();
    updateNight();
    // Wander back to Today after a few idle minutes (not while editing settings or a sheet is open).
    if (S.view !== 'today' && S.view !== 'settings' && Date.now() - S.lastTouch > 3 * 60 * 1000 && !$('#sheetLayer').classList.contains('is-on')) {
      S.calAnchor = dayStart(new Date());
      go('today');
    }
    // New day: refetch everything; small hours: full reload to pick up new code and shed leaks.
    if (today() !== lastDay) {
      lastDay = today();
      if (new Date().getHours() < 4) { location.reload(); return; }
      loadState().catch(function () {});
      loadEvents(true).catch(function () {});
    }
  }

  function start() {
    $$('[data-icon]').forEach(function (s) { s.innerHTML = icon(s.dataset.icon, 28); });
    // Paint cached events immediately (useful when the frame boots before Wi-Fi is up).
    var cached = store('events');
    if (cached && cached.events) {
      S.events = cached.events;
      S.eventsRange = null;
    }
    render();
    loadState().then(function () { return loadEvents(true); }).catch(function (e) { if (e.message !== 'locked') toast(e.message); });
    setInterval(tick, 15 * 1000);
    setInterval(function () { if (S.view !== 'settings') loadState().catch(function () {}); }, 60 * 1000);
    setInterval(function () { loadEvents(true).catch(function () {}); }, 5 * 60 * 1000);
    setInterval(loadWeather, 30 * 60 * 1000);
    window.HUB_STARTED = true;
  }
  start();
})();
