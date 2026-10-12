// Demo data relative to today, for trying Home Hub with no Google account:
//   npm run demo   (seeds .data/home-hub.json, then starts the dev server)
// The dev server serves the two demo calendars at /dev/demo-<name>.ics.
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

function pad(n) { return (n < 10 ? '0' : '') + n; }
function day(offset) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function stamp(d, hm) { return ymd(d).replace(/-/g, '') + 'T' + hm.replace(':', '') + '00'; }

// Times are floating (no zone), so they show at these wall times wherever you run the demo.
function ics(events) {
  var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Home Hub demo//EN'];
  events.forEach(function (e, i) {
    lines.push('BEGIN:VEVENT', 'UID:demo-' + e.title.replace(/\W+/g, '') + '-' + e.d);
    if (e.allDay) {
      lines.push('DTSTART;VALUE=DATE:' + ymd(day(e.d)).replace(/-/g, ''), 'DTEND;VALUE=DATE:' + ymd(day(e.d + (e.days || 1))).replace(/-/g, ''));
    } else {
      lines.push('DTSTART:' + stamp(day(e.d), e.s), 'DTEND:' + stamp(day(e.d), e.e));
    }
    if (e.rrule) lines.push('RRULE:' + e.rrule);
    lines.push('SUMMARY:' + e.title);
    if (e.loc) lines.push('LOCATION:' + e.loc);
    if (e.notes) lines.push('DESCRIPTION:' + e.notes);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function demoFeed(name) {
  var start = -((new Date().getDay() + 6) % 7) - 7; // Monday last week
  if (name === 'family') return ics([
    { d: 0, allDay: true, title: 'Pajama day at school' },
    { d: 0, s: '07:00', e: '07:45', title: 'Gym', loc: 'YMCA' },
    { d: 0, s: '12:00', e: '12:45', title: 'Dentist — Ava', loc: 'Bright Smiles Dental', notes: 'Bring the insurance card.' },
    { d: 0, s: '15:45', e: '16:30', title: 'Piano lesson', loc: "Ms. Park's studio" },
    { d: 0, s: '18:30', e: '19:30', title: 'Dinner at Grandma’s', loc: '12 Elm St' },
    { d: 1, s: '10:30', e: '11:15', title: 'Vet — Biscuit' },
    { d: 1, s: '19:00', e: '21:00', title: 'Book club' },
    { d: 2, allDay: true, days: 2, title: 'Grandparents visiting' },
    { d: 3, s: '13:00', e: '15:30', title: "Zoe's birthday party", loc: 'Pottery Place' },
    { d: 5, s: '10:30', e: '12:00', title: 'Weekend brunch' },
    { d: start, s: '16:30', e: '18:00', title: 'Soccer practice', loc: 'Lakeshore Fields', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH' },
    { d: start + 2, s: '19:00', e: '20:00', title: 'Yoga', rrule: 'FREQ=WEEKLY;BYDAY=WE' },
    { d: 9, allDay: true, title: 'No school — teacher workday' }
  ]);
  return ics([
    { d: 0, s: '09:30', e: '10:30', title: 'Design review', loc: 'Office · 4B' },
    { d: 0, s: '12:00', e: '12:45', title: 'Dentist — Ava', loc: 'Bright Smiles Dental' },
    { d: 0, s: '13:00', e: '14:00', title: 'Lunch with Sam' },
    { d: 1, allDay: true, days: 3, title: 'Work trip — Denver' },
    { d: start, s: '08:30', e: '09:00', title: 'Standup', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }
  ]);
}

export async function seedDemo(path, port) {
  var t = ymd(day(0));
  function task(title, emoji, assignee, schedule, extra) {
    return Object.assign({ id: randomUUID(), title: title, emoji: emoji, assignee: assignee, slot: null, stars: 0, schedule: schedule, notes: null, archived: false, created_at: new Date().toISOString() }, extra || {});
  }
  var daily = { type: 'daily', every: 1, start: t };
  var dow = new Date().getDay();
  var tasks = [
    task('Make bed', '🛏️', 'ava', daily, { slot: 'morning', stars: 1 }),
    task('Brush teeth', '🦷', 'ava', daily, { slot: 'morning', stars: 1 }),
    task('Homework', '📚', 'ava', { type: 'weekly', every: 1, days: [1, 2, 3, 4, 5], start: t }, { slot: 'afternoon', stars: 2 }),
    task('Practice piano', '🎹', 'leo', daily, { slot: 'afternoon', stars: 2 }),
    task('Feed Biscuit', '🐶', 'any', daily, { stars: 1 }),
    task('Empty dishwasher', '🍽️', 'any', daily, { slot: 'evening', stars: 2 }),
    task('Take out trash + recycling', '🗑️', 'chris', { type: 'weekly', every: 1, days: [dow], start: t }, { slot: 'evening' }),
    task('Pay credit card', '💳', 'chris', { type: 'monthly', every: 1, day: new Date().getDate(), start: t }),
    task('Renew car registration', '🚗', 'sam', { type: 'once', due: ymd(day(-2)) }),
    task('Order Zoe’s birthday gift', '🎁', 'sam', { type: 'once', due: ymd(day(2)) }),
    task('Call the plumber', '📞', 'chris', { type: 'once' }),
    task('Change furnace filter', '🧹', 'chris', { type: 'monthly', every: 3, day: 1, start: t })
  ];
  var data = {
    settings: {
      familyName: 'The Millers', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago',
      location: { name: 'Chicago, Illinois', lat: 41.85, lon: -87.65 }, units: 'fahrenheit', weekStartsOn: 0, nightStart: 22, nightEnd: 6,
      people: [
        { id: 'chris', name: 'Chris', color: '#2F6BFF', stars: false },
        { id: 'sam', name: 'Sam', color: '#E4007C', stars: false },
        { id: 'ava', name: 'Ava', color: '#00A36C', stars: true },
        { id: 'leo', name: 'Leo', color: '#F29E00', stars: true }
      ],
      calendars: [
        { id: 'family', name: 'Family', url: 'http://localhost:' + port + '/dev/demo-family.ics', color: '#8A4DFF', person: null, hidden: false },
        { id: 'chris-work', name: 'Chris · Work', url: 'http://localhost:' + port + '/dev/demo-work.ics', color: '#2F6BFF', person: 'chris', hidden: false }
      ]
    },
    tasks: tasks,
    completions: [
      { task_id: tasks[0].id, occ: t, done_by: 'ava', day: t, stars: 1, at: new Date().toISOString() },
      { task_id: tasks[4].id, occ: t, done_by: 'leo', day: t, stars: 1, at: new Date().toISOString() },
      { task_id: tasks[0].id, occ: 'old', done_by: 'ava', day: ymd(day(-1)), stars: 12 },
      { task_id: tasks[3].id, occ: 'old', done_by: 'leo', day: ymd(day(-1)), stars: 18 }
    ]
  };
  await mkdir(path.replace(/\/[^/]+$/, ''), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}
