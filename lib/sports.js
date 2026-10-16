// Team schedules, scores and records from ESPN's public site API (no key needed). Unofficial but
// long-lived; if it ever changes shape, the sports tiles just disappear instead of breaking the page.
//   https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams/{id}/schedule

export var LEAGUES = {
  'college-football': { sport: 'football', label: 'College football' },
  nfl: { sport: 'football', label: 'NFL' },
  'mens-college-basketball': { sport: 'basketball', label: 'Men’s college basketball' },
  'womens-college-basketball': { sport: 'basketball', label: 'Women’s college basketball' },
  nba: { sport: 'basketball', label: 'NBA' },
  wnba: { sport: 'basketball', label: 'WNBA' },
  mlb: { sport: 'baseball', label: 'MLB' },
  nhl: { sport: 'hockey', label: 'NHL' }
};

var BASE = 'https://site.api.espn.com/apis/site/v2/sports/';

function leagueUrl(league) {
  var l = LEAGUES[league];
  if (!l) throw new Error('Unknown league: ' + league);
  return BASE + l.sport + '/' + league;
}

function logoOf(team) {
  if (!team) return null;
  if (team.logo) return team.logo;
  var logos = team.logos || [];
  return logos.length ? logos[0].href : null;
}
function scoreOf(c) {
  if (!c || c.score == null) return null;
  return typeof c.score === 'object' ? c.score.displayValue : String(c.score);
}
function rankOf(c) {
  var r = c && c.curatedRank && c.curatedRank.current;
  return r && r < 99 ? r : null;
}

// Boil ESPN's schedule response down to what the tiles show.
export function summariseSchedule(data, league, nowMs) {
  var team = data.team || {};
  var myId = String(team.id);
  var games = (data.events || []).map(function (e) {
    var comp = (e.competitions || [])[0] || {};
    var cs = comp.competitors || [];
    var us = cs.filter(function (c) { return String(c.id || (c.team && c.team.id)) === myId; })[0];
    var them = cs.filter(function (c) { return c !== us; })[0];
    if (!us || !them) return null;
    var status = (comp.status || e.status || {}).type || {};
    var tv = (comp.broadcasts || []).map(function (b) { return (b.media && b.media.shortName) || (b.names || [])[0]; }).filter(Boolean);
    var g = {
      id: e.id,
      date: e.date,
      timeKnown: comp.timeValid !== false,
      home: us.homeAway === 'home',
      neutral: !!comp.neutralSite,
      opponent: {
        name: them.team ? them.team.shortDisplayName || them.team.displayName : 'TBD',
        abbr: them.team ? them.team.abbreviation : '',
        logo: logoOf(them.team),
        rank: rankOf(them)
      },
      rank: rankOf(us),
      state: status.state || 'pre', // pre | in | post
      detail: status.shortDetail || '',
      tv: tv.slice(0, 2),
      venue: comp.venue ? comp.venue.fullName : null,
      us: scoreOf(us),
      them: scoreOf(them),
      result: null
    };
    if (g.state === 'post' && g.us != null && g.them != null) {
      g.result = us.winner ? 'W' : them.winner ? 'L' : (+g.us === +g.them ? 'T' : (+g.us > +g.them ? 'W' : 'L'));
    }
    return g;
  }).filter(Boolean).sort(function (a, b) { return Date.parse(a.date) - Date.parse(b.date); });

  var live = games.filter(function (g) { return g.state === 'in'; })[0] || null;
  var past = games.filter(function (g) { return g.state === 'post'; });
  var upcoming = games.filter(function (g) { return g.state === 'pre' && Date.parse(g.date) > nowMs - 6 * 3600e3; });
  return {
    league: league,
    team: {
      id: myId,
      name: team.displayName,
      short: team.shortDisplayName || team.location || team.displayName,
      abbr: team.abbreviation,
      logo: logoOf(team),
      color: team.color ? '#' + team.color : null,
      record: team.recordSummary || null,
      standing: team.standingSummary || null
    },
    live: live,
    last: past.length ? past[past.length - 1] : null,
    next: upcoming[0] || null,
    upcoming: upcoming.slice(0, 5),
    games: games
  };
}

// Cache per team: short while a game is on or about to start, longer otherwise.
var cache = new Map();
function ttlFor(summary, nowMs) {
  if (!summary) return 5 * 60e3;
  if (summary.live) return 60e3;
  var n = summary.next && Date.parse(summary.next.date);
  if (n && n - nowMs < 30 * 60e3) return 2 * 60e3;
  return 15 * 60e3;
}

export async function loadTeams(teams, fetchImpl, nowMs) {
  fetchImpl = fetchImpl || fetch;
  nowMs = nowMs || Date.now();
  return Promise.all((teams || []).map(async function (t) {
    var key = t.league + '/' + t.id;
    var hit = cache.get(key);
    if (hit && nowMs - hit.at < hit.ttl) return hit.value;
    try {
      var res = await fetchImpl(leagueUrl(t.league) + '/teams/' + encodeURIComponent(t.id) + '/schedule', { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error('ESPN answered ' + res.status);
      var summary = summariseSchedule(await res.json(), t.league, nowMs);
      cache.set(key, { at: nowMs, ttl: ttlFor(summary, nowMs), value: summary });
      return summary;
    } catch (e) {
      // Keep showing the last good data if ESPN hiccups.
      if (hit) return hit.value;
      return { league: t.league, team: { id: String(t.id), name: t.name, short: t.name }, error: String(e.message || e) };
    }
  }));
}

// Team search for Settings ("Auburn" -> Auburn Tigers, id 2). The list is cached for a day.
var teamLists = new Map();
export async function searchTeams(league, q, fetchImpl) {
  fetchImpl = fetchImpl || fetch;
  var hit = teamLists.get(league);
  var list;
  if (hit && Date.now() - hit.at < 24 * 3600e3) list = hit.list;
  else {
    // groups=80 is every FBS team for college football; other leagues ignore it.
    var url = leagueUrl(league) + '/teams?limit=1000' + (league === 'college-football' ? '&groups=80' : '');
    var res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('ESPN answered ' + res.status);
    var data = await res.json();
    var teams = (((data.sports || [])[0] || {}).leagues || [])[0];
    list = ((teams && teams.teams) || []).map(function (x) {
      var t = x.team || x;
      return { id: String(t.id), name: t.displayName, short: t.shortDisplayName || t.location, logo: logoOf(t) };
    });
    teamLists.set(league, { at: Date.now(), list: list });
  }
  var needle = String(q || '').toLowerCase().trim();
  if (!needle) return list.slice(0, 20);
  return list.filter(function (t) { return (t.name + ' ' + t.short).toLowerCase().indexOf(needle) > -1; }).slice(0, 20);
}

// Every game of the followed teams as calendar events (calendar id 'sport-<league>-<team id>'),
// so they show on the Calendar and Home views alongside the Google calendars.
var BALL = { football: '🏈', basketball: '🏀', baseball: '⚾', hockey: '🏒' };
export function sportCalendars(summaries) {
  return (summaries || []).filter(function (t) { return !t.error && t.games; }).map(function (t) {
    return { id: 'sport-' + t.league + '-' + t.team.id, name: t.team.short || t.team.name, color: t.team.color || '#6B655B', sport: true };
  });
}
export function gameEvents(summaries, fromMs, toMs, tz) {
  var out = [];
  (summaries || []).forEach(function (t) {
    if (t.error || !t.games) return;
    var ball = BALL[(LEAGUES[t.league] || {}).sport] || '';
    var calId = 'sport-' + t.league + '-' + t.team.id;
    t.games.forEach(function (g) {
      var s = Date.parse(g.date);
      if (!(s < toMs + 864e5 && s + 4 * 3600e3 > fromMs - 864e5)) return;
      var opp = (g.opponent.rank ? '#' + g.opponent.rank + ' ' : '') + g.opponent.name;
      var title = ball + ' ' + (t.team.short || t.team.name) + (g.home || g.neutral ? ' vs ' : ' at ') + opp;
      if (g.state === 'post' && g.result) title += ' (' + g.result + ' ' + g.us + '–' + g.them + ')';
      var ev = { uid: 'game-' + g.id + '-' + t.team.id, title: title.trim(), location: g.venue || null,
        notes: g.tv && g.tv.length ? 'TV: ' + g.tv.join(', ') : null, cals: [calId] };
      if (g.timeKnown) {
        ev.allDay = false;
        ev.start = new Date(s).toISOString();
        ev.end = new Date(s + 3.5 * 3600e3).toISOString();
      } else {
        // Kickoff time not set yet: an all-day entry on the local date.
        var day = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s));
        ev.allDay = true;
        ev.start = day;
        ev.end = new Date(Date.parse(day) + 864e5).toISOString().slice(0, 10);
        ev.title += ' (time TBA)';
      }
      out.push(ev);
    });
  });
  return out;
}
