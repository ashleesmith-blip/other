-- Athletics Manager — clear the student data off the server, ready to re-seed
--
-- Use this when the browser and Supabase have drifted apart and it is no longer
-- worth reconciling them — most often after de-duplicating in both places, when
-- the two passes kept different copies and the ids no longer line up, so results
-- pulled down point at students that are not there.
--
-- It empties only the three tables that carry student data. Houses, events and
-- your points scheme are left alone, so nothing has to be set up again.
--
-- Everything deleted is copied into deleted_rows by the archive trigger from
-- supabase-protect.sql, so this is recoverable even without a backup file.
--
-- AFTERWARDS: on the browser that holds the data — the one whose Houses tab
-- shows the totals you expect — press Sync -> Upload this browser to Supabase.
-- That reseeds the server from a single source. Only then press Connect and
-- pull on any other device.
--
-- Take a backup from the Import tab first regardless.

begin;

-- Children before parents.
delete from results;
delete from sheets;
delete from students;

commit;

-- Should all be zero:
--   select
--     (select count(*) from students) as students,
--     (select count(*) from results)  as results,
--     (select count(*) from sheets)   as sheets;
--
-- Still there, as intended:
--   select
--     (select count(*) from houses)   as houses,
--     (select count(*) from events)   as events,
--     (select count(*) from settings) as settings;
--
-- What was removed, if it is ever needed back:
--   select deleted_at, table_name, count(*)
--   from deleted_rows group by 1,2 order by 1 desc;
