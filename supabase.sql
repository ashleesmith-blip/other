-- Athletics Manager — Supabase schema
--
-- Paste the whole file into the Supabase SQL editor and run it once.
-- Safe to re-run: everything is create-if-not-exists or replace.
--
-- ACCESS MODEL: no login. RLS is on, and the policies below deliberately grant
-- the `anon` role full read/write. That means anyone holding the site URL and
-- the anon key can read and change every row. It is the model that was chosen
-- knowingly; to lock it down later, replace `to anon` with `to authenticated`
-- in the policies at the bottom and add Supabase Auth. No schema change needed.

-- ---------------------------------------------------------------- tables

create table if not exists houses (
  id         text primary key,
  name       text not null,
  colour     text not null default '#7c3aed',
  position   int  not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists events (
  id         text primary key,
  name       text not null,
  type       text not null default 'track',   -- track | field | relay
  scoring    text not null default 'lower',   -- lower = fastest wins, higher = furthest
  unit       text not null default 'sec',
  years      text[] not null default '{}',
  position   int  not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists students (
  id         text primary key,
  name       text not null,
  year_level text not null default '',
  gender     text not null default 'Mixed',
  homegroup  text not null default '',
  house_id   text references houses(id) on delete set null,
  beep_test  text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists students_division_idx on students (year_level, gender);
create index if not exists students_house_idx    on students (house_id);

-- One row per competitor per event. The unique constraint is what makes an
-- upsert from two scorers at once safe.
create table if not exists results (
  id         text primary key,
  event_id   text not null references events(id) on delete cascade,
  student_id text not null references students(id) on delete cascade,
  result     text not null,
  recorded_on date,
  updated_at timestamptz not null default now(),
  unique (event_id, student_id)
);

create index if not exists results_event_idx on results (event_id);

-- One row per recording sheet: the participation counts typed off the paper,
-- who was named 1st..4th, and whether the sheet has been handed in.
create table if not exists sheets (
  event_id   text not null references events(id) on delete cascade,
  division   text not null,                    -- e.g. '3 Female'
  counts     jsonb  not null default '{}'::jsonb,   -- { house_id: competitors }
  places     text[] not null default '{}',          -- student ids, 1st..4th
  received   boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (event_id, division)
);

-- Scoring scheme, district settings and per-student event preferences.
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- updated_at

create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['houses','events','students','results','sheets','settings'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format(
      'create trigger %I_touch before insert or update on %I
       for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- access

alter table houses   enable row level security;
alter table events   enable row level security;
alter table students enable row level security;
alter table results  enable row level security;
alter table sheets   enable row level security;
alter table settings enable row level security;

-- Open read/write for the anon key. See the note at the top of this file.
do $$
declare t text;
begin
  foreach t in array array['houses','events','students','results','sheets','settings'] loop
    execute format('drop policy if exists %I_anon_all on %I', t, t);
    execute format(
      'create policy %I_anon_all on %I for all to anon using (true) with check (true)', t, t);
  end loop;
end $$;
