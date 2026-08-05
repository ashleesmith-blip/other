-- Athletics Manager — remove duplicated students on the server
--
-- Run this in the Supabase SQL editor if the same child appears twice.
-- Safe to re-run: with nothing duplicated it changes nothing.
--
-- Merging in the browser cannot fix this on its own. supabase-protect.sql
-- revokes delete on students from the app, so the copies stay on the server and
-- the next sync pulls them straight back. This does it server-side, where the
-- SQL editor runs as the owner rather than as the app.
--
-- Two records are the same child when name, year level, gender and homegroup
-- all match — the same rule the importer and the in-app merge use. The survivor
-- is the lowest id, and everything recorded against the others is repointed at
-- it before they go.

begin;

-- Who is being kept, and who is being folded into them.
create temporary table dup_map on commit drop as
with ranked as (
  select id,
         min(id) over (partition by lower(trim(name)), coalesce(year_level, ''),
                                    coalesce(gender, ''), lower(coalesce(homegroup, ''))) as keep_id
  from students
)
select id as dup_id, keep_id from ranked where id <> keep_id;

-- A result on a duplicate would collide with one already on the survivor,
-- because of the unique (event_id, student_id). Drop the loser first.
delete from results r
using dup_map m
where r.student_id = m.dup_id
  and exists (
    select 1 from results keep
    where keep.student_id = m.keep_id and keep.event_id = r.event_id
  );

update results r
set student_id = m.keep_id
from dup_map m
where r.student_id = m.dup_id;

-- Placings are an array of student ids on the sheet, so each element is mapped.
update sheets s
set places = (
  select array_agg(coalesce(m.keep_id, elem) order by ord)
  from unnest(s.places) with ordinality as t(elem, ord)
  left join dup_map m on m.dup_id = t.elem
)
where exists (
  select 1 from unnest(s.places) as elem
  join dup_map m on m.dup_id = elem
);

delete from students s using dup_map m where s.id = m.dup_id;

commit;

-- What is left:
--   select count(*) as students from students;
--
-- Anything still duplicated (should return no rows):
--   select lower(trim(name)) as name, year_level, gender, homegroup, count(*)
--   from students
--   group by 1,2,3,4 having count(*) > 1;
