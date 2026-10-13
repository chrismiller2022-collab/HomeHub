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
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>',
    meals: '<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 21V3c-2.5 1.5-4 4.5-4 8h4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
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
    meals: null,
    groceries: null,
    mealAnchor: dayStart(new Date()),
    starDetail: {},
    todayMeals: [],
    groceryCount: 0,
    sleepManual: false,
    homeMode: store('homeMode') || 'day',
    sports: [],
    weekMeals: [],
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
    if (store('person')) opts.headers['x-hub-person'] = store('person');
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
      // Daily star goal just reached by a kid: a bigger celebration.
      var goal = d.settings.dailyStarGoal;
      if (!first && goal) Object.keys(d.starDetail || {}).forEach(function (id) {
        var before = (S.starDetail[id] || {}).today || 0, now = d.starDetail[id].today;
        if (before < goal && now >= goal) {
          celebrate(person(id).color, true);
          toast('⭐ <b>' + esc(person(id).name) + '</b> hit today’s star goal!');
        }
      });
      S.starDetail = d.starDetail || {};
      S.todayMeals = d.meals || [];
      S.groceryCount = d.groceryCount || 0;
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
    if (addDays(t, 8) > to) to = addDays(t, 9);
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
      '&temperature_unit=' + (S.settings.units === 'celsius' ? 'celsius' : 'fahrenheit') + '&timezone=auto&forecast_days=7';
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
    if (S.view === 'meals') renderMeals();
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
    for (var i = 1; i < Math.min(d.time.length, 6); i++) {
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
    if (S.homeMode === 'week') return renderWeekHome();
    var now = new Date(), tom = addDays(dayStart(now), 1);
    var el = $('#view-today');
    el.innerHTML =
      '<div class="head"><div class="today-date"><div class="label">' + esc(S.settings.familyName) + '</div>' +
      '<h1>' + DAYS[now.getDay()] + '</h1><div class="sub">' + MONTHS[now.getMonth()] + ' ' + now.getDate() + '</div></div>' +
      '<div class="row" style="align-items:center;gap:22px">' + homeToggle() + weatherBlock() + '</div></div>' +
      headsUpStrip(2, 4) +
      '<div class="today"><div>' + agenda(now) +
      '<div class="tomorrow"><div class="label" style="margin-bottom:8px">Tomorrow · ' + DAYS[tom.getDay()] + '</div>' + agenda(tom, true) + '</div>' +
      forecastBlock() + '</div>' +
      '<div>' + todayMealsCard() + sportsCompact() + '<div class="card today-todos"><div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="font-size:24px">To-dos</h2>' +
      '<button class="btn btn--sm btn--dark" data-act="add-todo">' + icon('plus', 18) + 'Add</button></div>' + todoLanes(true) + '</div></div></div>';
  }

  function todayMealsCard() {
    var t = today(), slots = mealSlots().map(function (x) { return x[0]; });
    var list = S.todayMeals.filter(function (m) { return m.date === t && slots.indexOf(m.slot) > -1; });
    var tomorrow = S.todayMeals.filter(function (m) { return m.date !== t && m.slot === 'dinner'; })[0];
    return '<button class="card meal-today" data-go="meals"><div class="label">' + (list.length === 1 && list[0].slot === 'dinner' ? 'Dinner tonight' : 'Meals today') + '</div>' +
      (list.length ? list.map(function (m) { return '<div class="meal-today-title">' + (slots.length > 1 ? '<span class="faint">' + esc(m.slot) + ' · </span>' : '') + esc(m.title) + '</div>'; }).join('') :
        '<div class="meal-today-title faint">Nothing planned yet</div>') +
      '<div class="todo-meta">' + (tomorrow ? 'Tomorrow: ' + esc(tomorrow.title) + ' · ' : '') + S.groceryCount + ' on the grocery list</div></button>';
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
      (S.todoMode === 'today' ? (left ? left + ' left for today' : 'All caught up') + ' · press and hold a to-do to edit it' : S.todoMode === 'stars' ? 'Stars earned and rewards' : 'Everything, including what repeats') + '</div></div>' +
      '<div class="row"><div class="seg"><button data-todo-mode="today" class="' + (S.todoMode === 'today' ? 'is-on' : '') + '">Today</button>' +
      '<button data-todo-mode="all" class="' + (S.todoMode === 'all' ? 'is-on' : '') + '">All</button>' +
      (kids().length ? '<button data-todo-mode="stars" class="' + (S.todoMode === 'stars' ? 'is-on' : '') + '">Stars</button>' : '') + '</div>' +
      '<button class="btn btn--dark" data-act="add-todo">' + icon('plus', 20) + 'Add to-do</button></div></div>';
    if (S.todoMode === 'today') { el.innerHTML = head + todoLanes(false); return; }
    if (S.todoMode === 'stars') { el.innerHTML = head + renderStars(); return; }

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
      if (t.stars && earner.stars) celebrate(earner.color, false);
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
      S.settingsSms = d.sms;
      S.settingsAssistant = d.assistant;
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
    var personOpts = function (sel, blank) {
      return '<option value="">' + (blank || 'Nobody in particular') + '</option>' + s.people.map(function (p, i) {
        return '<option value="' + esc(p.id || ('new' + i)) + '"' + (p.id && p.id === sel ? ' selected' : '') + '>' + esc(p.name || '(unnamed)') + '</option>';
      }).join('');
    };
    var opt = function (v, label, cur) { return '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + label + '</option>'; };
    var pct = function (key, lo) {
      var out = '';
      for (var v = 100; v >= lo; v -= 5) out += opt(v, v + '%', s.brightness[key]);
      return out;
    };
    var g = s.groceryReminder || { enabled: false, day: 4, people: [] };
    var lock = store('lockScreen');
    var lockOn = lock === true || (lock == null && /HomeHubKiosk/.test(navigator.userAgent));

    el.innerHTML = '<div class="head"><div><h1>Settings</h1><div class="sub">Easiest from a phone or laptop: open this page there with the same link.</div></div>' +
      '<button class="btn btn--dark" data-act="save-settings">Save</button></div><div class="settings">' +

      '<section class="card form"><h2>Household</h2><div class="row">' +
      '<label class="field"><span>Name shown on the display</span><input class="input" data-s="familyName" value="' + esc(s.familyName) + '"></label>' +
      '<label class="field"><span>Time zone</span><input class="input" data-s="timezone" value="' + esc(s.timezone) + '" placeholder="America/Chicago"></label></div>' +
      '<div class="row"><label class="field"><span>Weather location</span><input class="input" data-loc-q value="' + esc(s.location ? s.location.name : '') + '" placeholder="City or ZIP"></label>' +
      '<button class="btn" data-act="find-loc" style="align-self:flex-end">Find</button></div><div data-loc-results class="choice"></div>' +
      (s.location ? '<p class="help">Weather for ' + esc(s.location.name) + ' (' + s.location.lat.toFixed(2) + ', ' + s.location.lon.toFixed(2) + ') · <button class="faint" data-act="clear-loc"><u>remove</u></button></p>' : '') +
      '<div class="row"><label class="field"><span>Units</span><select class="input" data-s="units">' + opt('fahrenheit', '°F', s.units) + opt('celsius', '°C', s.units) + '</select></label>' +
      '<label class="field"><span>Week starts</span><select class="input" data-s="weekStartsOn" data-num>' + opt(0, 'Sunday', s.weekStartsOn) + opt(1, 'Monday', s.weekStartsOn) + '</select></label></div></section>' +

      '<section class="card form"><h2>Screen: sleep and brightness</h2>' +
      '<div class="row"><label class="field"><span>At night</span><select class="input" data-s="sleepStyle">' + opt('dim', 'Dim the screen', s.sleepStyle) + opt('clock', 'Show only a dim clock', s.sleepStyle) + opt('off', 'Stay on', s.sleepStyle) + '</select></label>' +
      '<label class="field"><span>Night from</span><select class="input" data-s="nightStart" data-num>' + hourOpts(s.nightStart) + '</select></label>' +
      '<label class="field"><span>until</span><select class="input" data-s="nightEnd" data-num>' + hourOpts(s.nightEnd) + '</select></label></div>' +
      '<div class="row"><label class="field"><span>Brightness</span><select class="input" data-b="mode">' + opt('schedule', 'By time of day', s.brightness.mode) + opt('auto', 'Automatic (light sensor)', s.brightness.mode) + opt('off', 'Always full', s.brightness.mode) + '</select></label>' +
      '<label class="field"><span>Daytime</span><select class="input" data-b="day" data-num>' + pct('day', 10) + '</select></label>' +
      '<label class="field"><span>Evening from</span><select class="input" data-b="eveningStart" data-num>' + hourOpts(s.brightness.eveningStart).replace(/<option value="([0-9]|1[01])"[^>]*>[^<]*<\/option>/g, '') + '</select></label>' +
      '<label class="field"><span>Evening</span><select class="input" data-b="evening" data-num>' + pct('evening', 10) + '</select></label>' +
      '<label class="field"><span>Night</span><select class="input" data-b="night" data-num>' + pct('night', 5) + '</select></label></div>' +
      '<p class="help">' + (native ? 'This screen controls its backlight directly.' : 'In a regular browser this darkens the page. The Home Hub kiosk app on the frame sets the real backlight, and “Automatic” uses the frame’s light sensor if it has one.') +
      ' Tap the moon in the sidebar to put the screen to sleep any time; tap the screen to wake it.</p></section>' +

      '<section class="card form"><h2>People</h2><p class="help">Everyone who gets to-dos. Turn on stars for kids who earn them. A mobile number lets that person text the meal planner and get grocery reminders.</p>' +
      s.people.map(function (p, i) {
        return '<div class="list-item"><div class="row"><label class="field"><span>Name</span><input class="input" data-p="' + i + '" data-k="name" value="' + esc(p.name) + '"></label>' +
          '<label class="field" style="flex:none;min-width:0"><span>Color</span><input class="color" type="color" data-p="' + i + '" data-k="color" value="' + esc(p.color) + '"></label>' +
          '<label class="field"><span>Mobile (optional)</span><input class="input" type="tel" data-p="' + i + '" data-k="phone" value="' + esc(p.phone || '') + '" placeholder="(555) 123-4567"></label>' +
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

      '<section class="card form"><h2>Meals and groceries</h2>' +
      '<div class="field"><span>Meals to plan each day</span><div class="choice">' + MEAL_SLOTS.map(function (m) {
        return '<button type="button" data-slotchk="' + m[0] + '" class="' + (s.mealSlots.indexOf(m[0]) > -1 ? 'is-on' : '') + '">' + m[1] + '</button>';
      }).join('') + '</div></div>' +
      '<label class="check-row"><input type="checkbox" data-g="enabled"' + (g.enabled ? ' checked' : '') + '> Text a grocery-order reminder every</label>' +
      '<div class="row"><label class="field"><span>Day</span><select class="input" data-g="day" data-num>' + DAYS.map(function (d, i) { return opt(i, d, g.day); }).join('') + '</select></label>' +
      '<div class="field"><span>To</span><div class="choice">' + s.people.filter(function (p) { return p.id; }).map(function (p) {
        return '<button type="button" data-gp="' + esc(p.id) + '" class="' + (g.people.indexOf(p.id) > -1 ? 'is-on' : '') + '">' + esc(p.name) + '</button>';
      }).join('') + '</div></div></div>' +
      '<p class="help">The reminder lists what’s on the grocery list and this week’s meals. ' +
      (S.settingsSms ? 'Texting is set up.' : '<b>Texting isn’t set up yet</b>: add the Twilio settings in Vercel (see the README). Until then, add a weekly to-do like “Order groceries” on Thursdays.') + ' ' +
      (S.settingsAssistant ? 'The meal planner is on: family members can text it, or use “Ask the meal planner” on the Meals screen.' : '<b>The meal planner is off</b>: it needs ANTHROPIC_API_KEY in Vercel.') + '</p></section>' +

      '<section class="card form"><h2>Sports teams</h2><p class="help">Shown as score tiles on the home screen, with live scores on game day. Data from ESPN.</p>' +
      (s.sports || []).map(function (t, i) {
        return '<div class="team-row"><b style="flex:1">' + esc(t.name) + '</b><span class="faint">' + esc(LEAGUE_NAMES[t.league] || t.league) + '</span>' +
          '<button class="btn btn--sm btn--danger" data-del-team="' + i + '">Remove</button></div>';
      }).join('') +
      '<div class="row"><label class="field" style="flex:none;min-width:0;width:240px"><span>League</span><select class="input" data-team-league>' +
      Object.keys(LEAGUE_NAMES).map(function (k) { return '<option value="' + k + '">' + LEAGUE_NAMES[k] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>Team</span><input class="input" data-team-q placeholder="Auburn, Bengals, Reds…"></label>' +
      '<button class="btn" data-act="find-team" style="align-self:flex-end">Find</button></div><div class="choice" data-team-results></div></section>' +

      '<section class="card form"><h2>Stars and rewards</h2><div class="row">' +
      '<label class="field"><span>Daily star goal (per kid)</span><input class="input" type="number" min="0" max="50" data-s="dailyStarGoal" data-num value="' + (s.dailyStarGoal || 0) + '"></label>' +
      '<label class="field"><span>When a starred to-do is done</span><select class="input" data-s="celebration">' + opt('confetti', 'Confetti', s.celebration) + opt('stars', 'Shower of stars', s.celebration) + opt('off', 'No animation', s.celebration) + '</select></label></div>' +
      '<div class="field"><span>Rewards kids can spend stars on</span></div>' +
      s.rewards.map(function (r, i) {
        return '<div class="row"><label class="field" style="flex:none;min-width:0;width:80px"><span>Icon</span><input class="input" data-r="' + i + '" data-k="emoji" value="' + esc(r.emoji || '🎁') + '"></label>' +
          '<label class="field"><span>Reward</span><input class="input" data-r="' + i + '" data-k="title" value="' + esc(r.title) + '" placeholder="Movie night"></label>' +
          '<label class="field" style="flex:none;min-width:0;width:110px"><span>Stars</span><input class="input" type="number" min="1" data-r="' + i + '" data-k="stars" value="' + r.stars + '"></label>' +
          '<button class="btn btn--sm btn--danger" data-del-reward="' + i + '" style="align-self:flex-end">Remove</button></div>';
      }).join('') + '<div><button class="btn btn--sm" data-act="add-reward">' + icon('plus', 16) + ' Add reward</button></div></section>' +

      '<section class="card form"><h2>Parent lock</h2><p class="help">With a PIN set, a locked screen lets kids look around and tick things off, but adding, editing, deleting, rewards and Settings ask for the PIN (it stays unlocked for 5 minutes).</p>' +
      '<div class="row">' + (s.hasPin ? '<label class="field"><span>Current PIN</span><input class="input" type="password" inputmode="numeric" data-pin="current" autocomplete="off"></label>' : '') +
      '<label class="field"><span>' + (s.hasPin ? 'New PIN (blank removes it)' : 'New PIN (4–8 digits)') + '</span><input class="input" type="password" inputmode="numeric" data-pin="pin" autocomplete="off"></label>' +
      '<button class="btn" data-act="set-pin" style="align-self:flex-end">' + (s.hasPin ? 'Change PIN' : 'Set PIN') + '</button></div>' +
      '<label class="check-row"><input type="checkbox" data-local="lockScreen"' + (lockOn ? ' checked' : '') + '> Lock this screen' + (/HomeHubKiosk/.test(navigator.userAgent) ? ' (on by default in the kiosk app)' : '') + '</label></section>' +

      '<section class="card form"><h2>This device</h2><div class="row"><label class="field"><span>Who uses this device?</span><select class="input" data-local="person">' + personOpts(store('person'), 'Shared / the wall display') + '</select></label></div>' +
      '<p class="help">On your own phone, pick yourself: meals and groceries you add are marked as yours, and the meal planner knows who it’s talking to. Signed in with the household key. ' +
      '<button class="faint" data-act="forget-key"><u>Sign this device out</u></button></p></section>' +
      '<div><button class="btn btn--dark" data-act="save-settings">Save settings</button></div></div>';
  }

  var LEAGUE_NAMES = {
    'college-football': 'College football', nfl: 'NFL', 'mens-college-basketball': 'Men’s college basketball',
    'womens-college-basketball': 'Women’s college basketball', nba: 'NBA', wnba: 'WNBA', mlb: 'MLB', nhl: 'NHL'
  };

  function hourOpts(sel) {
    var out = '';
    for (var h = 0; h <= 24; h++) out += '<option value="' + h + '"' + (h === +sel ? ' selected' : '') + '>' + (h === 24 ? 'Midnight' : fmtTime(new Date(2000, 0, 1, h, 0))) + '</option>';
    return out;
  }

  function readSettingsForm() {
    var s = draftSettings, el = $('#view-settings');
    function val(i) { return i.type === 'checkbox' ? i.checked : i.hasAttribute('data-num') ? +i.value : i.value; }
    $$('[data-s]', el).forEach(function (i) { s[i.dataset.s] = val(i); });
    $$('[data-b]', el).forEach(function (i) { s.brightness[i.dataset.b] = val(i); });
    $$('[data-p]', el).forEach(function (i) { s.people[+i.dataset.p][i.dataset.k] = val(i); });
    $$('[data-c]', el).forEach(function (i) { s.calendars[+i.dataset.c][i.dataset.k] = val(i); });
    $$('[data-r]', el).forEach(function (i) { s.rewards[+i.dataset.r][i.dataset.k] = i.dataset.k === 'stars' ? +i.value : i.value; });
    s.groceryReminder = s.groceryReminder || { enabled: false, day: 4, people: [] };
    $$('[data-g]', el).forEach(function (i) { s.groceryReminder[i.dataset.g] = val(i); });
  }

  function settingsClick(e) {
    var b = e.target.closest('[data-act],[data-del-person],[data-del-cal],[data-del-reward],[data-del-team],[data-team-pick],[data-loc-pick],[data-slotchk],[data-gp]');
    if (!b || !draftSettings) return;
    readSettingsForm();
    var s = draftSettings;
    if (b.dataset.slotchk) {
      var si = s.mealSlots.indexOf(b.dataset.slotchk);
      if (si > -1 && s.mealSlots.length > 1) s.mealSlots.splice(si, 1); else if (si < 0) s.mealSlots.push(b.dataset.slotchk);
      return drawSettings();
    }
    if (b.dataset.gp) {
      var gi = s.groceryReminder.people.indexOf(b.dataset.gp);
      if (gi > -1) s.groceryReminder.people.splice(gi, 1); else s.groceryReminder.people.push(b.dataset.gp);
      return drawSettings();
    }
    if (b.dataset.delReward != null) { s.rewards.splice(+b.dataset.delReward, 1); return drawSettings(); }
    if (b.dataset.delTeam != null) { s.sports.splice(+b.dataset.delTeam, 1); return drawSettings(); }
    if (b.dataset.teamPick) {
      s.sports = s.sports || [];
      s.sports.push(JSON.parse(b.dataset.teamPick));
      toast('Added. Save settings to keep it.');
      return drawSettings();
    }
    if (b.dataset.delPerson != null) { s.people.splice(+b.dataset.delPerson, 1); return drawSettings(); }
    if (b.dataset.delCal != null) { s.calendars.splice(+b.dataset.delCal, 1); return drawSettings(); }
    if (b.dataset.locPick != null) { s.location = JSON.parse(b.dataset.locPick); return drawSettings(); }
    switch (b.dataset.act) {
      case 'add-person':
        var palette = ['#2F6BFF', '#E4007C', '#00A36C', '#FFB000', '#8A4DFF', '#FF6B2C', '#00A3C4'];
        s.people.push({ name: '', color: palette[s.people.length % palette.length], stars: false });
        return drawSettings();
      case 'find-team':
        var lg = $('[data-team-league]').value, tq = $('[data-team-q]').value.trim();
        api('GET', '/api/sports/search?league=' + encodeURIComponent(lg) + '&q=' + encodeURIComponent(tq)).then(function (d) {
          var box = $('[data-team-results]');
          box.innerHTML = d.teams.length ? d.teams.map(function (t) {
            return '<button data-team-pick="' + esc(JSON.stringify({ league: lg, id: t.id, name: t.short || t.name })) + '">' +
              (t.logo ? '<img src="' + esc(t.logo) + '" width="22" height="22" alt="" style="vertical-align:middle;margin-right:6px">' : '') + esc(t.name) + '</button>';
          }).join('') : '<span class="faint">No match</span>';
        }, function (err) { toast(err.message); });
        return;
      case 'add-reward':
        s.rewards.push({ emoji: '🎁', title: '', stars: 10 });
        return drawSettings();
      case 'set-pin':
        var cur = $('[data-pin="current"]'), np = $('[data-pin="pin"]');
        api('PUT', '/api/pin', { current: cur ? cur.value : '', pin: np.value }).then(function (d) {
          s.hasPin = d.hasPin;
          unlockedUntil = Date.now() + 5 * 60 * 1000;
          toast(d.hasPin ? 'PIN saved' : 'PIN removed');
          drawSettings();
          loadState();
        }, function (err) { toast(err.message); });
        return;
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
          return loadState().then(function () { loadWeather(); loadSports().catch(function () {}); return loadEvents(true); }).then(function () { if (S.view === 'settings') renderSettings(); });
        }, function (err) { toast(err.message); });
    }
  }

  // ---------------------------------------------------------------- Sports
  function loadSports() {
    if (!S.settings || !(S.settings.sports || []).length) { S.sports = []; return Promise.resolve(); }
    return api('GET', '/api/sports').then(function (d) {
      S.sports = d.teams.filter(function (t) { return !t.error; });
      if (S.view === 'today') render();
    });
  }
  var SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function gameWhen(g) {
    var d = new Date(g.date), t = dayStart(new Date()), days = Math.round((dayStart(d) - t) / 864e5);
    var day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days < 7 ? DAYS[d.getDay()] : SHORT_DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
    return { day: day, time: g.timeKnown ? fmtTime(d) : 'Time TBD', days: days };
  }
  function oppName(g) { return (g.opponent.rank ? '#' + g.opponent.rank + ' ' : '') + g.opponent.name; }
  function logoImg(src, size, cls) {
    return src ? '<img class="' + (cls || 'team-logo') + '" src="' + esc(src) + '" width="' + size + '" height="' + size + '" alt="" loading="lazy">' : '';
  }

  function sportsTile(t) {
    var tm = t.team, g = t.live || t.next, color = tm.color || '#1D1B18';
    var chip = '<div class="tile-chip" style="color:' + color + '">' + logoImg(tm.logo, 20, 'chip-logo') + esc(tm.short) +
      (tm.standing ? ' · ' + esc(tm.standing.replace(/^(\d+\w*) in /, '$1 ')) : '') + (tm.record ? ' · ' + esc(tm.record) : '') + '</div>';
    if (!g) {
      return '<section class="tile sport" style="--tc:' + color + '">' + chip +
        '<div class="sport-off">' + logoImg(tm.logo, 64) + '<div><b>No games scheduled</b><span class="muted">Season over · see you next year</span></div></div>' +
        lastLine(t) + '</section>';
    }
    var home = g.home, us = { name: tm.short, logo: tm.logo }, them = { name: oppName(g), logo: g.opponent.logo };
    var left = home ? them : us, right = home ? us : them;
    var mid = '<div class="mu-names"><b>' + esc(left.name) + '</b><span>' + (g.neutral ? 'vs' : 'at') + '</span><b>' + esc(right.name) + '</b></div>';
    var info;
    if (g.state === 'in') {
      var ls = home ? g.them : g.us, rs = home ? g.us : g.them;
      info = '<div class="mu-score num">' + esc(ls) + '<span>–</span>' + esc(rs) + '</div><div class="pill-row"><span class="pill-chip is-live">● LIVE · ' + esc(g.detail) + '</span>' +
        (g.tv.length ? '<span class="pill-chip">' + esc(g.tv[0]) + '</span>' : '') + '</div>';
    } else {
      var w = gameWhen(g);
      info = '<div class="pill-row"><span class="pill-chip">' + esc(w.day) + ' · ' + esc(w.time) + '</span>' +
        (w.days > 1 && w.days < 30 ? '<span class="pill-chip"><i class="dot" style="background:var(--bad)"></i> in ' + w.days + ' days</span>' : '') +
        (g.tv.length ? '<span class="pill-chip">' + esc(g.tv.join(' / ')) + '</span>' : '') + '</div>';
    }
    return '<section class="tile sport" style="--tc:' + color + '">' + chip +
      '<div class="matchup">' + logoImg(left.logo, 64) + mid + logoImg(right.logo, 64) + '</div>' + info + lastLine(t) + '</section>';
  }
  function lastLine(t) {
    var l = t.last;
    if (!l) return '';
    return '<div class="sport-last"><span class="res res-' + l.result + '">' + l.result + ' ' + esc(l.us) + '–' + esc(l.them) + '</span> ' +
      (l.home ? 'vs ' : 'at ') + esc(oppName(l)) + '</div>';
  }
  // One line per team for the Day view: only when a game is live or within a week.
  function sportsCompact() {
    var rows = (S.sports || []).filter(function (t) {
      var g = t.live || t.next;
      return g && (t.live || gameWhen(g).days < 7);
    }).map(function (t) {
      var g = t.live || t.next, tm = t.team;
      var text = g.state === 'in'
        ? '<b class="num">' + esc(tm.abbr || tm.short) + ' ' + esc(g.us) + ' – ' + esc(g.them) + ' ' + esc(g.opponent.abbr) + '</b> <span class="pill-chip is-live">● ' + esc(g.detail) + '</span>'
        : '<b>' + esc(tm.short) + (g.home ? ' vs ' : ' at ') + esc(oppName(g)) + '</b><small>' + esc(gameWhen(g).day + ' · ' + gameWhen(g).time) + (g.tv.length ? ' · ' + esc(g.tv[0]) : '') + '</small>';
      return '<div class="sport-row" style="--tc:' + (tm.color || '#1D1B18') + '">' + logoImg(tm.logo, 36) + '<div>' + text + '</div>' + logoImg(g.opponent.logo, 28, 'team-logo opp') + '</div>';
    });
    return rows.length ? '<div class="card sport-compact">' + rows.join('') + '</div>' : '';
  }

  // ---------------------------------------------------------------- Heads up
  // A few things worth knowing in the next `days` days: chores that aren't everyday, overdue
  // to-dos, birthdays, rain, game days, grocery-order day.
  function headsUp(days) {
    var items = [], now = new Date(), t0 = dayStart(now);
    function rel(d) {
      var n = Math.round((dayStart(d) - t0) / 864e5);
      return n === 0 ? (now.getHours() >= 15 ? 'tonight' : 'today') : n === 1 ? 'tomorrow' : DAYS[d.getDay()];
    }
    // Occasional chores (trash night, monthly bills), not the everyday or every-weekday ones.
    function occasional(sc) {
      return sc.type === 'monthly' || sc.type === 'yearly' || (sc.type === 'weekly' && (sc.days || []).length <= 2) || (sc.type === 'daily' && sc.every >= 3);
    }
    S.tasks.filter(function (x) { return !x.done && (x.overdue || occasional(x.schedule) || (x.schedule.type === 'once' && x.due && x.due <= ymd(addDays(t0, 1)))); })
      .slice(0, 3).forEach(function (x) {
        items.push({ icon: x.emoji || '✓', text: x.title, when: x.overdue ? 'overdue' : x.due && x.due > today() ? 'tomorrow' : now.getHours() >= 15 ? 'tonight' : 'today', hot: true });
      });
    for (var i = 0; i < days; i++) {
      var d = addDays(t0, i);
      eventsOn(d).allDay.forEach(function (ev) {
        if (/birthday|bday|anniversary/i.test(ev.title) && ev.start === ymd(d)) items.push({ icon: '🎂', text: ev.title.replace(/'s birthday/i, '’s bday'), when: rel(d) });
      });
      var g = S.settings.groceryReminder;
      if (g && g.enabled && d.getDay() === g.day) items.push({ icon: '🛒', text: 'Grocery order day', when: rel(d) + (S.groceryCount ? ' · ' + S.groceryCount + ' items' : '') });
    }
    (S.sports || []).forEach(function (t) {
      var gm = t.live || t.next;
      if (!gm) return;
      var w = gameWhen(gm);
      if (t.live) items.unshift({ icon: '🏈', text: t.team.short + ' ' + gm.us + '–' + gm.them, when: 'LIVE', hot: true });
      else if (w.days < days) items.push({ icon: '🏈', text: t.team.short + (gm.home ? ' vs ' : ' at ') + gm.opponent.name, when: (w.days === 0 ? 'today' : w.day) + (gm.timeKnown ? ' ' + fmtTime(new Date(gm.date), true) : '') });
    });
    var wx = S.weather && S.weather.daily;
    if (wx) {
      for (var j = 0; j < Math.min(days, wx.time.length); j++) {
        if (wx.precipitation_probability_max[j] >= 60) { items.push({ icon: '🌧️', text: 'Rain likely', when: rel(fromYmd(wx.time[j])) + ' · ' + wx.precipitation_probability_max[j] + '%' }); break; }
      }
    }
    return items;
  }
  function headsUpStrip(days, max) {
    var items = headsUp(days).slice(0, max);
    if (!items.length) return '';
    return '<section class="tile heads-up"><div class="hu-title"><b>Heads up,</b><span>' + items.length + ' thing' + (items.length > 1 ? 's' : '') + '</span></div><div class="hu-items">' +
      items.map(function (x) {
        return '<div class="hu' + (x.hot ? ' is-hot' : '') + '"><span class="hu-ico">' + esc(x.icon) + '</span><b>' + esc(x.text) + '</b><span class="hu-when">' + esc(x.when) + '</span></div>';
      }).join('') + '</div></section>';
  }

  // ---------------------------------------------------------------- Home: week view
  function greeting() {
    var h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }
  function homeToggle() {
    return '<div class="seg home-seg"><button data-home-mode="day" class="' + (S.homeMode !== 'week' ? 'is-on' : '') + '">Day</button>' +
      '<button data-home-mode="week" class="' + (S.homeMode === 'week' ? 'is-on' : '') + '">Week</button></div>';
  }
  function renderWeekHome() {
    var now = new Date(), t0 = dayStart(now), end = addDays(t0, 6);
    var evCount = 0, mealCount = 0, wx = S.weather && S.weather.daily;
    var cols = '';
    for (var i = 0; i < 7; i++) {
      var d = addDays(t0, i), key = ymd(d), on = eventsOn(d);
      evCount += on.timed.length + on.allDay.length;
      var dinner = (S.weekMeals || []).filter(function (m) { return m.date === key; });
      mealCount += dinner.length;
      var w = wx ? wx.time.indexOf(key) : -1;
      var games = (S.sports || []).map(function (t) {
        var g = t.live || t.next;
        if (!g || ymd(new Date(g.date)) !== key) return '';
        return '<div class="g-game">' + logoImg(t.team.logo, 16, 'chip-logo') + esc(t.team.abbr || t.team.short) + (g.home ? ' vs ' : ' at ') + esc(g.opponent.abbr || g.opponent.name) +
          (g.state === 'in' ? ' · LIVE' : g.timeKnown ? ' · ' + fmtTime(new Date(g.date), true) : '') + '</div>';
      }).filter(Boolean);
      var list = games.concat(on.allDay.map(function (ev) {
        var c = evColor(ev);
        return '<div class="g-all" style="background:' + c + ';color:' + inkOn(c) + '">' + esc(ev.title) + '</div>';
      })).concat(on.timed.map(function (ev) {
        return '<div class="g-ev"><i class="dot" style="background:' + evColor(ev) + '"></i><span>' + fmtTime(new Date(ev.start), true) + '</span> ' + esc(ev.title) + '</div>';
      }));
      cols += '<button class="g-day' + (i === 0 ? ' is-today' : '') + '" data-glance="' + key + '"><div class="g-head"><small>' + (i === 0 ? 'Today' : SHORT_DAYS[d.getDay()]) + '</small><b>' + d.getDate() + '</b>' +
        (w > -1 ? '<span class="g-wx">' + (WX[wx.weather_code[w]] || ['🌡️'])[0] + ' ' + Math.round(wx.temperature_2m_max[w]) + '°</span>' : '') + '</div>' +
        '<div class="g-list">' + list.slice(0, 4).join('') + (list.length > 4 ? '<div class="g-more">+' + (list.length - 4) + ' more</div>' : '') + (!list.length ? '<div class="g-free">Free</div>' : '') + '</div>' +
        (dinner.length ? '<div class="g-meal">🍴 ' + esc(dinner.map(function (m) { return m.title; }).join(', ')) + '</div>' : '') + '</button>';
    }
    var cur = S.weather && S.weather.current;
    var hello = '<section class="tile hello"><div class="row" style="justify-content:space-between;align-items:flex-start"><div class="tile-chip">' + icon('calendar', 16) + ' ' +
      SHORT_DAYS[t0.getDay()] + ' ' + MONTHS[t0.getMonth()].slice(0, 3) + ' ' + t0.getDate() + ' – ' + SHORT_DAYS[end.getDay()] + ' ' + MONTHS[end.getMonth()].slice(0, 3) + ' ' + end.getDate() + '</div>' + homeToggle() + '</div>' +
      '<div class="hello-time num">' + fmtTime(now).replace(/ (AM|PM)/, '') + '<small>' + fmtTime(now).slice(-2).toLowerCase() + '</small></div>' +
      '<div class="hello-text"><b>' + greeting() + ',</b> here’s your week.</div>' +
      '<div class="hello-stats">' + evCount + ' events · ' + mealCount + ' meals planned · ' + S.tasks.filter(function (x) { return !x.done; }).length + ' to-dos today' +
      (cur ? ' · ' + Math.round(cur.temperature_2m) + '° ' + (WX[cur.weather_code] || ['', ''])[1].toLowerCase() : '') + '</div></section>';
    var sports = (S.sports || []).map(sportsTile);
    var row1 = [hello].concat(sports.slice(0, 2));
    if (row1.length < 3) row1.push(starsTile());
    $('#view-today').innerHTML = '<div class="home-week">' +
      '<div class="tiles-3">' + row1.join('') + '</div>' +
      '<section class="tile glance"><div class="glance-cols">' + cols + '</div></section>' +
      headsUpStrip(7, 5) +
      (sports.length > 2 ? '<div class="tiles-3">' + sports.slice(2).join('') + '</div>' : '') + '</div>';
  }
  function starsTile() {
    var ks = kids();
    if (!ks.length) return '';
    return '<section class="tile stars-mini"><div class="tile-chip">' + icon('star', 16, true) + ' Stars this week</div>' + ks.map(function (p) {
      var d = S.starDetail[p.id] || { week: 0, balance: 0 };
      return '<div class="sm-row">' + avatar(p, 34) + '<b>' + esc(p.name) + '</b><span class="num">' + d.week + '★ this week</span><span class="faint num">' + d.balance + ' to spend</span></div>';
    }).join('') + '</section>';
  }
  function loadWeekMeals() {
    var t0 = dayStart(new Date());
    return api('GET', '/api/meals?from=' + ymd(t0) + '&to=' + ymd(addDays(t0, 6))).then(function (d) {
      S.weekMeals = d.meals.filter(function (m) { return m.slot === 'dinner' || mealSlots().length === 1 && m.slot === mealSlots()[0][0]; });
      if (S.view === 'today' && S.homeMode === 'week') render();
    });
  }

  // ---------------------------------------------------------------- Parent lock
  // On a locked screen (the wall display), kids can look and tick things off, but adding, editing
  // and deleting, rewards and Settings ask for the parent PIN. Phones aren't locked unless you
  // turn it on for them too.
  var unlockedUntil = 0;
  function isLockedScreen() {
    return !!(S.settings && S.settings.hasPin) && (store('lockScreen') === true || (store('lockScreen') == null && /HomeHubKiosk/.test(navigator.userAgent)));
  }
  function guard(fn) {
    if (!isLockedScreen() || Date.now() < unlockedUntil) return fn();
    var digits = '';
    function pad() {
      return '<h2>Parent PIN</h2><div class="pin-dots">' + [0, 1, 2, 3, 4, 5, 6, 7].slice(0, Math.max(4, digits.length)).map(function (i) {
        return '<i class="' + (i < digits.length ? 'is-on' : '') + '"></i>';
      }).join('') + '</div><div class="pin-msg faint" data-pin-msg>&nbsp;</div><div class="pin-pad">' +
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'ok'].map(function (k) {
          return '<button data-k="' + k + '" class="' + (k === 'ok' ? 'is-ok' : '') + '">' + (k === 'clear' ? '⌫' : k === 'ok' ? 'OK' : k) + '</button>';
        }).join('') + '</div><div class="sheet-actions"><button class="btn" data-close>Cancel</button></div>';
    }
    sheet(pad(), function (root, close) {
      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-k]');
        if (!b) return;
        var k = b.dataset.k;
        if (k === 'clear') digits = digits.slice(0, -1);
        else if (k !== 'ok' && digits.length < 8) digits += k;
        if (k === 'ok' || digits.length === 8) {
          api('POST', '/api/pin', { pin: digits }).then(function () {
            unlockedUntil = Date.now() + 5 * 60 * 1000;
            close();
            fn();
          }, function (err) {
            digits = '';
            root.innerHTML = pad();
            $('[data-pin-msg]', root).textContent = err.message;
          });
          return;
        }
        root.innerHTML = pad();
      });
    });
  }

  // ---------------------------------------------------------------- Celebrations
  // Confetti (or a burst of stars) when a kid finishes a starred to-do; bigger for the daily goal.
  function celebrate(color, big) {
    var style = S.settings && S.settings.celebration;
    if (style === 'off') return;
    var c = document.createElement('canvas');
    c.className = 'confetti';
    c.width = window.innerWidth; c.height = window.innerHeight;
    document.body.appendChild(c);
    var ctx = c.getContext('2d'), parts = [], n = big ? 160 : 70;
    var colors = [color, '#FFB000', '#2F6BFF', '#E4007C', '#00A36C', '#8A4DFF'];
    for (var i = 0; i < n; i++) {
      parts.push({
        x: c.width / 2 + (Math.random() - 0.5) * c.width * (big ? 0.8 : 0.3), y: big ? -20 - Math.random() * c.height * 0.4 : c.height * 0.55,
        vx: (Math.random() - 0.5) * (big ? 4 : 12), vy: big ? 2 + Math.random() * 3 : -8 - Math.random() * 9,
        r: 5 + Math.random() * 7, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.3, col: colors[i % colors.length]
      });
    }
    function star(x, y, r) {
      ctx.beginPath();
      for (var k = 0; k < 10; k++) {
        var rr = k % 2 ? r * 0.45 : r, ang = k * Math.PI / 5 - Math.PI / 2;
        ctx.lineTo(x + rr * Math.cos(ang), y + rr * Math.sin(ang));
      }
      ctx.closePath(); ctx.fill();
    }
    var t0 = performance.now(), life = big ? 3200 : 1900;
    (function frame(t) {
      var k = (t - t0) / life;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4);
      parts.forEach(function (p) {
        p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.fillStyle = p.col;
        if (style === 'stars') { star(p.x, p.y, p.r * 1.3); return; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillRect(-p.r, -p.r / 2.5, p.r * 2, p.r / 1.25); ctx.restore();
      });
      if (k < 1) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  // ---------------------------------------------------------------- Stars & rewards
  function kids() { return people().filter(function (p) { return p.stars; }); }
  function renderStars() {
    var goal = S.settings.dailyStarGoal || 0, rewards = S.settings.rewards || [];
    if (!kids().length) return '<div class="empty">Turn on <b>Stars</b> for a person in Settings to start a star chart.</div>';
    return '<div class="lanes">' + kids().map(function (p) {
      var d = S.starDetail[p.id] || { today: 0, week: 0, month: 0, total: 0, balance: 0 };
      var pct = goal ? Math.min(100, Math.round(d.today / goal * 100)) : 0;
      return '<section class="lane stars-card" style="--c:' + p.color + '"><div class="lane-head">' + avatar(p, 44) +
        '<div><b>' + esc(p.name) + '</b><small>' + d.total + ' earned all time</small></div>' +
        '<span class="lane-stars num big">' + icon('star', 26, true) + ' ' + d.balance + '</span></div>' +
        (goal ? '<div class="goal"><div class="row" style="justify-content:space-between"><span class="label">Today</span><b class="num">' + d.today + ' / ' + goal + (d.today >= goal ? ' 🎉' : '') + '</b></div>' +
          '<div class="t-bar"><i style="width:' + pct + '%;background:' + p.color + '"></i></div></div>' : '') +
        '<div class="star-periods"><div><b class="num">' + d.today + '</b><span>today</span></div><div><b class="num">' + d.week + '</b><span>this week</span></div><div><b class="num">' + d.month + '</b><span>this month</span></div></div>' +
        (rewards.length ? '<div class="label" style="margin:14px 2px 8px">Rewards</div>' + rewards.map(function (r) {
          var can = d.balance >= r.stars;
          return '<div class="reward' + (can ? '' : ' is-far') + '"><span class="todo-emoji">' + esc(r.emoji) + '</span><div class="todo-text"><div class="todo-title">' + esc(r.title) + '</div>' +
            '<div class="todo-meta">' + r.stars + '★' + (can ? '' : ' · ' + (r.stars - d.balance) + ' to go') + '</div></div>' +
            (can ? '<button class="btn btn--sm" data-redeem="' + esc(r.id) + '" data-for="' + p.id + '">Redeem</button>' : '') + '</div>';
        }).join('') : '<p class="help" style="margin-top:12px">Add rewards (like “Movie night · 20★”) in Settings.</p>') +
        '</section>';
    }).join('') + '</div>';
  }
  function redeem(personId, rewardId) {
    var r = (S.settings.rewards || []).filter(function (x) { return x.id === rewardId; })[0], p = person(personId);
    guard(function () {
      if (!confirm('Spend ' + r.stars + ' of ' + p.name + '’s stars on “' + r.title + '”?')) return;
      api('POST', '/api/redeem', { person: personId, reward: rewardId }).then(function () {
        celebrate(p.color, true);
        toast(esc(p.name) + ' redeemed <b>' + esc(r.title) + '</b>!');
        loadState();
      }, function (e) { toast(e.message); });
    });
  }

  // ---------------------------------------------------------------- Meals
  var MEAL_SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];
  function mealSlots() {
    var on = (S.settings && S.settings.mealSlots) || ['dinner'];
    return MEAL_SLOTS.filter(function (s) { return on.indexOf(s[0]) > -1; });
  }
  function mealWeekStart() { return weekStart(S.mealAnchor); }
  function loadMeals() {
    var a = mealWeekStart();
    return Promise.all([
      api('GET', '/api/meals?from=' + ymd(a) + '&to=' + ymd(addDays(a, 6))),
      api('GET', '/api/groceries')
    ]).then(function (r) {
      S.meals = r[0].meals;
      S.groceries = r[1].items;
      if (S.view === 'meals') renderMeals();
    });
  }

  function renderMeals() {
    var el = $('#view-meals'), a = mealWeekStart(), slots = mealSlots();
    var head = '<div class="cal-head"><h1>Meals</h1>' +
      (S.settings.assistant ? '<button class="btn btn--dark" data-act="ask">' + icon('chat', 20) + ' Ask the meal planner</button>' : '') +
      '<button class="icon-btn" data-meal-step="-1" aria-label="Previous week">' + icon('left') + '</button>' +
      '<button class="btn btn--sm" data-meal-step="0">This week</button>' +
      '<button class="icon-btn" data-meal-step="1" aria-label="Next week">' + icon('right') + '</button></div>';
    if (!S.meals) { el.innerHTML = head + '<div class="empty">Loading…</div>'; loadMeals().catch(function (e) { toast(e.message); }); return; }

    var rows = '';
    for (var i = 0; i < 7; i++) {
      var d = addDays(a, i), key = ymd(d);
      rows += '<div class="meal-day' + (sameDay(d, new Date()) ? ' is-today' : '') + '"><div class="meal-date"><small>' + DAYS[d.getDay()].slice(0, 3) + '</small><b>' + d.getDate() + '</b></div>' +
        '<div class="meal-slots" style="grid-template-columns:repeat(' + slots.length + ',minmax(0,1fr))">' + slots.map(function (s) {
          var list = S.meals.filter(function (m) { return m.date === key && m.slot === s[0]; });
          return '<div class="meal-cell">' + (slots.length > 1 ? '<span class="label">' + s[1] + '</span>' : '') +
            list.map(function (m) {
              return '<button class="meal" data-meal="' + m.id + '"><b>' + esc(m.title) + '</b>' + (m.notes ? '<small>' + esc(m.notes) + '</small>' : m.recipe_url ? '<small>Recipe</small>' : '') + '</button>';
            }).join('') +
            '<button class="meal-add" data-meal-add="' + key + '|' + s[0] + '">' + (list.length ? '+' : '+ ' + s[1]) + '</button></div>';
        }).join('') + '</div></div>';
    }

    var open = (S.groceries || []).filter(function (g) { return !g.done; }), done = (S.groceries || []).filter(function (g) { return g.done; });
    var groceries = '<section class="card groceries"><div class="row" style="justify-content:space-between"><h2>Groceries</h2><span class="faint">' + open.length + ' to buy</span></div>' +
      '<form class="row grocery-add" data-grocery-form><input class="input" name="item" placeholder="Add an item" autocomplete="off"><button class="btn btn--dark btn--sm">Add</button></form>' +
      open.map(groceryRow).join('') + done.map(groceryRow).join('') +
      (done.length ? '<button class="btn btn--sm" data-act="clear-groceries" style="margin-top:10px">Clear checked</button>' : '') +
      (!open.length && !done.length ? '<div class="empty" style="margin-top:10px">Nothing on the list.</div>' : '') + '</section>';

    el.innerHTML = head + '<div class="meals-wrap"><div class="meal-week">' + rows + '</div>' + groceries + '</div>';
  }
  function groceryRow(g) {
    return '<div class="todo grocery' + (g.done ? ' is-done' : '') + '" style="--c:#1E9E62">' +
      '<button class="todo-check" data-grocery="' + g.id + '" aria-label="Got it"><span style="color:#fff">' + icon('tick', 20) + '</span></button>' +
      '<button class="todo-text" data-grocery="' + g.id + '"><div class="todo-title">' + esc(g.name) + (g.qty ? ' <span class="faint">· ' + esc(g.qty) + '</span>' : '') + '</div>' +
      (g.note ? '<div class="todo-meta">' + esc(g.note) + '</div>' : '') + '</button>' +
      '<button class="todo-edit" data-grocery-del="' + g.id + '" aria-label="Remove">×</button></div>';
  }
  function toggleGrocery(id) {
    var g = (S.groceries || []).filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    g.done = !g.done;
    renderMeals();
    api('PUT', '/api/groceries/' + id, { done: g.done }).then(loadState, function (e) { toast(e.message); loadMeals(); });
  }

  function showMeal(id) {
    var m = S.meals.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    var d = fromYmd(m.date);
    sheet('<div class="label">' + DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ' · ' + m.slot + '</div><h2 style="margin-top:6px">' + esc(m.title) + '</h2>' +
      (m.notes ? '<p style="font-size:17px">' + esc(m.notes) + '</p>' : '') +
      (m.recipe_url ? '<p class="muted" style="margin-top:8px;word-break:break-all">' + esc(m.recipe_url) + '</p>' : '') +
      (m.ingredients && m.ingredients.length ? '<div class="label" style="margin:14px 0 6px">Ingredients</div><ul class="ingredients">' + m.ingredients.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="sheet-actions"><button class="btn btn--danger" data-act="del">Delete</button><span class="spacer"></span>' +
      (m.ingredients && m.ingredients.length ? '<button class="btn" data-act="shop">Add to groceries</button>' : '') +
      '<button class="btn" data-act="edit">Edit</button><button class="btn btn--dark" data-close>Close</button></div>', function (root, close) {
      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'edit') { close(); guard(function () { editMeal(m); }); }
        if (b.dataset.act === 'shop') { close(); pickGroceries(m); }
        if (b.dataset.act === 'del') {
          guard(function () {
            if (!confirm('Remove ' + m.title + ' from the plan?')) return;
            api('DELETE', '/api/meals/' + m.id).then(function () { close(); toast('Removed'); loadMeals(); loadState(); });
          });
        }
      });
    });
  }

  function editMeal(existing, preset) {
    var m = existing ? JSON.parse(JSON.stringify(existing)) : { date: preset.date, slot: preset.slot, title: '', recipe_url: '', notes: '', ingredients: [] };
    function body() {
      return '<h2>' + (existing ? 'Edit meal' : 'Add a meal') + '</h2><div class="form">' +
        '<div class="row"><label class="field"><span>Recipe link (optional)</span><input class="input" data-f="recipe_url" value="' + esc(m.recipe_url || '') + '" placeholder="https://…" autocomplete="off"></label>' +
        '<button class="btn" data-act="read" style="align-self:flex-end">Read recipe</button></div>' +
        '<label class="field"><span>Meal</span><input class="input" data-f="title" maxlength="120" value="' + esc(m.title) + '" placeholder="Tacos"></label>' +
        '<div class="row"><label class="field"><span>Day</span><input class="input" type="date" data-f="date" value="' + m.date + '"></label>' +
        '<label class="field"><span>Which meal</span><select class="input" data-f="slot">' + MEAL_SLOTS.map(function (s) {
          return '<option value="' + s[0] + '"' + (m.slot === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
        }).join('') + '</select></label></div>' +
        '<label class="field"><span>Note</span><input class="input" data-f="notes" value="' + esc(m.notes || '') + '" placeholder="Double it for leftovers"></label>' +
        '<label class="field"><span>Ingredients (one per line)</span><textarea class="input" rows="5" data-f="ingredients">' + esc((m.ingredients || []).join('\n')) + '</textarea></label>' +
        '</div><div class="sheet-actions"><button class="btn" data-close>Cancel</button><button class="btn btn--dark" data-act="save">Save</button></div>';
    }
    sheet(body(), function (root, close) {
      function read() {
        $$('[data-f]', root).forEach(function (i) {
          m[i.dataset.f] = i.dataset.f === 'ingredients' ? i.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean) : i.value;
        });
      }
      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) return;
        read();
        if (b.dataset.act === 'read') {
          if (!m.recipe_url) return toast('Paste a recipe link first');
          b.disabled = true; b.textContent = 'Reading…';
          api('GET', '/api/recipe?url=' + encodeURIComponent(m.recipe_url)).then(function (d) {
            if (d.recipe.title && !m.title) m.title = d.recipe.title;
            if (d.recipe.ingredients.length) m.ingredients = d.recipe.ingredients;
            root.innerHTML = body();
            toast(d.recipe.found ? 'Found ' + d.recipe.ingredients.length + ' ingredients' : 'No recipe details on that page; add them by hand');
          }, function (err) { toast(err.message); root.innerHTML = body(); });
          return;
        }
        if (b.dataset.act === 'save') {
          var payload = { meal: { date: m.date, slot: m.slot, title: m.title, recipe_url: m.recipe_url || null, notes: m.notes || null, ingredients: m.ingredients } };
          (existing ? api('PUT', '/api/meals/' + existing.id, payload) : api('POST', '/api/meals', payload)).then(function (d) {
            close();
            loadMeals(); loadState();
            if (!existing && d.meal.ingredients.length) pickGroceries(d.meal);
            else toast('Saved');
          }, function (err) { toast(err.message); });
        }
      });
    });
  }

  // "Which of these do you already have?" — tick off what's in the house, the rest goes on the list.
  function pickGroceries(m) {
    var have = {};
    function body() {
      return '<h2>Shopping for ' + esc(m.title) + '</h2><p class="help" style="margin-bottom:12px">Tap what you already have. The rest goes on the grocery list.</p>' +
        '<div class="pick-list">' + m.ingredients.map(function (x, i) {
          return '<button class="pick' + (have[i] ? ' is-have' : '') + '" data-i="' + i + '"><span>' + (have[i] ? '✓ Have it' : 'Need') + '</span>' + esc(x) + '</button>';
        }).join('') + '</div><div class="sheet-actions"><button class="btn" data-close>Skip</button><button class="btn btn--dark" data-act="add">Add ' +
        m.ingredients.filter(function (_, i) { return !have[i]; }).length + ' to groceries</button></div>';
    }
    sheet(body(), function (root, close) {
      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-i],[data-act]');
        if (!b) return;
        if (b.dataset.i != null) { have[b.dataset.i] = !have[b.dataset.i]; root.innerHTML = body(); return; }
        var items = m.ingredients.filter(function (_, i) { return !have[i]; }).map(function (x) { return { name: x }; });
        api('POST', '/api/groceries', { items: items, meal_id: m.id }).then(function (d) {
          close();
          toast('Added ' + d.added.length + ' to groceries' + (d.already_on_list.length ? ' (' + d.already_on_list.length + ' already there)' : ''));
          loadMeals(); loadState();
        }, function (err) { toast(err.message); });
      });
    });
  }

  // ---------------------------------------------------------------- Meal planner chat
  var chatLog = store('chatLog') || [];
  function openChat() {
    function body() {
      return '<h2>Meal planner</h2><div class="chat" data-chat>' +
        (chatLog.length ? chatLog.map(function (m) { return '<div class="bubble ' + m.who + '">' + esc(m.text) + '</div>'; }).join('') :
          '<div class="bubble them">Send me a meal idea or paste a recipe link. I’ll find an open night, check what you already have, and put the rest on the grocery list.</div>') +
        '</div><form class="row grocery-add" data-chat-form><input class="input" name="msg" placeholder="Tacos Thursday, or a recipe link" autocomplete="off"><button class="btn btn--dark">Send</button></form>' +
        '<div class="sheet-actions"><button class="btn btn--sm" data-act="new-chat">New conversation</button><span class="spacer"></span><button class="btn" data-close>Close</button></div>';
    }
    sheet(body(), function (root) {
      function scroll() { var c = $('[data-chat]', root); if (c) c.scrollTop = c.scrollHeight; }
      scroll();
      root.addEventListener('click', function (e) {
        if (e.target.closest('[data-act="new-chat"]')) {
          chatLog = []; store('chatLog', chatLog); root.innerHTML = body();
          api('DELETE', '/api/assistant').catch(function () {});
        }
      });
      root.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = $('[name="msg"]', root), text = input.value.trim();
        if (!text) return;
        chatLog.push({ who: 'me', text: text });
        root.innerHTML = body();
        $('[data-chat]', root).insertAdjacentHTML('beforeend', '<div class="bubble them is-typing">…</div>');
        scroll();
        api('POST', '/api/assistant', { message: text, today: today() }).then(function (d) {
          chatLog.push({ who: 'them', text: d.reply });
        }, function (err) {
          chatLog.push({ who: 'them', text: 'Sorry: ' + err.message });
        }).then(function () {
          chatLog = chatLog.slice(-40);
          store('chatLog', chatLog);
          root.innerHTML = body();
          scroll();
          var i = $('[name="msg"]', root); if (i) i.focus();
          S.meals = null; loadMeals(); loadState();
        });
      });
      var i = $('[name="msg"]', root); if (i) i.focus();
    });
  }

  // ---------------------------------------------------------------- Sleep & brightness
  // The Home Hub kiosk app (kiosk/) exposes window.HomeHubNative to drive the real backlight.
  var native = window.HomeHubNative || null;
  function brightnessNow() {
    var b = (S.settings && S.settings.brightness) || { mode: 'off' };
    if (b.mode === 'off') return 100;
    var h = new Date().getHours();
    if (isNightHour()) return b.night;
    return h >= b.eveningStart ? b.evening : b.day;
  }
  var lastLevel = null;
  function applyBrightness() {
    var b = (S.settings && S.settings.brightness) || { mode: 'off' };
    var sleeping = $('#night').classList.contains('is-on');
    if (native && b.mode === 'auto' && !sleeping) {
      if (lastLevel !== 'auto') { try { native.setAutoBrightness(true); } catch (e) { /* older app */ } lastLevel = 'auto'; }
      $('#dimmer').style.opacity = 0;
      return;
    }
    var level = sleeping ? Math.min(brightnessNow(), (S.settings.brightness || {}).night || 15) : brightnessNow();
    if (native) {
      if (lastLevel !== level) { try { native.setBrightness(level / 100); } catch (e) { /* older app */ } lastLevel = level; }
      $('#dimmer').style.opacity = 0;
    } else {
      // No backlight control in a plain browser: darken the page instead.
      $('#dimmer').style.opacity = String(Math.max(0, (100 - level) / 100 * 0.85));
    }
  }
  function sleepNow() {
    S.sleepManual = true;
    S.nightWokenUntil = 0;
    updateNight();
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
    if (view === 'meals') S.meals = null;
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
    hold.timer = setTimeout(function () { hold.fired = true; guard(function () { editTodo(findTask(row.dataset.hold)); }); }, 600);
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
    if (b.dataset.go) return b.dataset.go === 'settings' ? guard(function () { go('settings'); }) : go(b.dataset.go);
    if (b.dataset.ev) return showEvent(b.dataset.ev);
    if (b.closest('#sheetLayer')) return;
    if (b.dataset.done) return toggleDone(b.dataset.done);
    if (b.dataset.edit) return guard(function () { editTodo(findTask(b.dataset.edit)); });
    if (b.dataset.act === 'add-todo') return guard(function () { editTodo(null); });
    if (b.dataset.act === 'sleep') return sleepNow();
    if (b.dataset.homeMode) {
      S.homeMode = b.dataset.homeMode;
      store('homeMode', S.homeMode);
      if (S.homeMode === 'week') loadWeekMeals().catch(function () {});
      return render();
    }
    if (b.dataset.glance) { S.calAnchor = fromYmd(b.dataset.glance); S.calMode = 'week'; return go('calendar'); }
    if (b.dataset.redeem) return redeem(b.dataset.for, b.dataset.redeem);
    if (b.dataset.meal) return showMeal(b.dataset.meal);
    if (b.dataset.mealAdd) { var mp = b.dataset.mealAdd.split('|'); return guard(function () { editMeal(null, { date: mp[0], slot: mp[1] }); }); }
    if (b.dataset.mealStep != null) {
      S.mealAnchor = +b.dataset.mealStep === 0 ? dayStart(new Date()) : addDays(S.mealAnchor, 7 * +b.dataset.mealStep);
      S.meals = null;
      return renderMeals();
    }
    if (b.dataset.act === 'ask') return openChat();
    if (b.dataset.grocery) return toggleGrocery(b.dataset.grocery);
    if (b.dataset.groceryDel) {
      return api('DELETE', '/api/groceries/' + b.dataset.groceryDel).then(function () { loadMeals(); loadState(); }, function (err) { toast(err.message); });
    }
    if (b.dataset.act === 'clear-groceries') {
      return api('DELETE', '/api/groceries?done=1').then(function () { loadMeals(); }, function (err) { toast(err.message); });
    }
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

  document.addEventListener('change', function (e) {
    var i = e.target.closest('[data-local]');
    if (!i) return;
    store(i.dataset.local, i.type === 'checkbox' ? i.checked : (i.value || null));
    toast('Saved for this device');
  });

  document.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-grocery-form]');
    if (!f) return;
    e.preventDefault();
    var v = f.item.value.trim();
    if (!v) return;
    api('POST', '/api/groceries', { items: [{ name: v }] }).then(function (d) {
      if (d.already_on_list.length) toast(esc(v) + ' is already on the list');
      loadMeals().then(function () { var i = $('[data-grocery-form] input'); if (i) i.focus(); });
      loadState();
    }, function (err) { toast(err.message); });
  });

  // ================================================================ wall-display behaviour
  function isNightHour() {
    if (!S.settings) return false;
    var h = new Date().getHours(), a = S.settings.nightStart, b = S.settings.nightEnd;
    if (a === b) return false;
    return a < b ? h >= a && h < b : h >= a || h < b;
  }
  function updateNight() {
    var style = (S.settings && S.settings.sleepStyle) || 'dim';
    var on = S.sleepManual || (style !== 'off' && isNightHour() && Date.now() > S.nightWokenUntil);
    var night = $('#night');
    night.classList.toggle('is-on', on);
    night.classList.toggle('is-clock', on && style === 'clock');
    if (on && style === 'clock') {
      var n = new Date();
      night.innerHTML = '<div class="night-clock"><b>' + fmtTime(n).replace(/ (AM|PM)/, '') + '</b><span>' + DAYS[n.getDay()] + ', ' + MONTHS[n.getMonth()] + ' ' + n.getDate() + '</span></div>';
    } else if (!on) night.innerHTML = '';
    applyBrightness();
  }
  $('#night').addEventListener('click', function () {
    S.sleepManual = false;
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
    loadState().then(function () { updateNight(); loadSports().catch(function () {}); if (S.homeMode === 'week') loadWeekMeals().catch(function () {}); return loadEvents(true); }).catch(function (e) { if (e.message !== 'locked') toast(e.message); });
    setInterval(tick, 15 * 1000);
    setInterval(function () { if (S.view !== 'settings') loadState().catch(function () {}); }, 60 * 1000);
    setInterval(function () { loadEvents(true).catch(function () {}); }, 5 * 60 * 1000);
    setInterval(loadWeather, 30 * 60 * 1000);
    // Scores: every minute while a game is on, otherwise every 10 minutes.
    (function sportsLoop() {
      var live = (S.sports || []).some(function (t) { return t.live; });
      setTimeout(function () { loadSports().catch(function () {}).then(sportsLoop); }, live ? 60 * 1000 : 10 * 60 * 1000);
    })();
    setInterval(function () { if (S.homeMode === 'week') loadWeekMeals().catch(function () {}); }, 5 * 60 * 1000);
    window.HUB_STARTED = true;
  }
  start();
})();
