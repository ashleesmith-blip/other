-- Athletics Manager — protect the roll from being deleted
--
-- Run this AFTER supabase.sql. Safe to re-run.
--
-- Sync pushes deletions as well as edits: a row that has vanished locally is
-- removed from the server on the next push. That is correct for a result being
-- cleared, and catastrophic for the class list — one browser ending up empty
-- (an "Erase all data" click, an old backup restored) would take all 373
-- students down with it, and the free tier has no automatic backup to fall
-- back on.
--
-- So the roll is made append-and-edit only, and anything that does get deleted
-- is kept.

-- ------------------------------------------------- 1. no deleting the roll

-- Students, houses and events can still be added and edited from the app.
-- Removing one is now a deliberate act in the Supabase table editor, not
-- something a browser can do by accident.
revoke delete on students from anon;
revoke delete on houses   from anon;
revoke delete on events   from anon;

-- Results and sheets keep delete: clearing a result on the Results tab removes
-- its row, and that has to reach the server.

-- ------------------------------------------------- 2. keep whatever is deleted

create table if not exists deleted_rows (
  id         bigserial primary key,
  table_name text not null,
  row_data   jsonb not null,
  deleted_at timestamptz not null default now()
);

create or replace function archive_deleted_row() returns trigger as $$
begin
  insert into deleted_rows (table_name, row_data)
  values (tg_table_name, to_jsonb(old));
  return old;
end;
$$ language plpgsql security definer;

do $$
declare t text;
begin
  foreach t in array array['students','houses','events','results','sheets'] loop
    execute format('drop trigger if exists %I_archive on %I', t, t);
    execute format(
      'create trigger %I_archive after delete on %I
       for each row execute function archive_deleted_row()', t, t);
  end loop;
end $$;

-- The archive is readable but not writable by the app, so nothing can quietly
-- empty it.
alter table deleted_rows enable row level security;
drop policy if exists deleted_rows_read on deleted_rows;
create policy deleted_rows_read on deleted_rows for select to anon using (true);
grant usage on schema public to anon;
grant select on deleted_rows to anon;

-- ------------------------------------------------- how to use it
--
-- See what has been deleted, most recent first:
--
--   select deleted_at, table_name, row_data->>'name' as name
--   from deleted_rows order by deleted_at desc;
--
-- Put every deleted student back:
--
--   insert into students
--   select (jsonb_populate_record(null::students, row_data)).*
--   from deleted_rows where table_name = 'students'
--   on conflict (id) do nothing;
