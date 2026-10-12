-- Home Hub tables. Run once in the Supabase SQL editor (or `supabase db push`).
-- Row level security is on with no policies, so only the server (service role key) can read or
-- write. The wall display never talks to Supabase directly.

create table if not exists hub_tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  emoji       text,
  assignee    text not null default 'any',      -- a person id from settings, or 'any'
  slot        text check (slot in ('morning', 'afternoon', 'evening')),
  stars       int  not null default 0,
  schedule    jsonb not null default '{"type":"once"}', -- see lib/schedule.js
  notes       text,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create table if not exists hub_completions (
  task_id  uuid not null references hub_tasks(id) on delete cascade,
  occ      text not null,                 -- 'YYYY-MM-DD' for recurring tasks, 'once' for one-time
  done_by  text,
  day      date not null,                 -- local date it was ticked off
  stars    int  not null default 0,       -- stars it was worth at the time
  at       timestamptz not null default now(),
  primary key (task_id, occ)
);
create index if not exists hub_completions_day on hub_completions (day);

create table if not exists hub_settings (
  key    text primary key,
  value  jsonb not null
);

create table if not exists hub_meals (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  slot        text not null default 'dinner' check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  title       text not null,
  recipe_url  text,
  notes       text,
  ingredients jsonb not null default '[]',  -- ["2 lb chicken thighs", ...]
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists hub_meals_date on hub_meals (date);

create table if not exists hub_groceries (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  qty         text,
  note        text,
  meal_id     uuid references hub_meals(id) on delete set null,
  done        boolean not null default false,
  added_by    text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);

-- Stars spent on rewards.
create table if not exists hub_redemptions (
  id          uuid primary key default gen_random_uuid(),
  person      text not null,
  reward      text not null,
  stars       int  not null,
  created_at  timestamptz not null default now()
);

-- Meal-planning assistant conversations, one per person and channel (text, app).
create table if not exists hub_conversations (
  id          text primary key,              -- e.g. 'sms:+15551234567' or 'app:chris'
  messages    jsonb not null default '[]',
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table hub_tasks enable row level security;
alter table hub_completions enable row level security;
alter table hub_settings enable row level security;
alter table hub_meals enable row level security;
alter table hub_groceries enable row level security;
alter table hub_redemptions enable row level security;
alter table hub_conversations enable row level security;
