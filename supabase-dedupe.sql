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
-- Two records are the same child when NAME and HOMEGROUP match. Year level and
-- gender are deliberately not part of the key: once a roll has been doubled the
-- two copies get edited apart — a year level corrected on one, a gender fixed on
-- the other — and a stricter key then leaves those pairs behind. Name plus
-- homegroup is unique per student in the class list, so it is safe to key on;
-- the seven names that legitimately repeat (Ivy M, Anna P, Michelle O, Olivia T,
-- Oscar W, Zoe W, William G) all sit in different homegroups and are untouched.
--
-- The survivor is whichever copy has a year level set, then the lowest id, so a
-- record that lost its year level is not the one that is kept.

begin;

create temporary table dup_map on commit drop as
with ranked as (
  select id,
         first_value(id) over (
           partition by lower(trim(name)), lower(coalesce(homegroup, ''))
           order by (case when coalesce(year_level, '') = '' then 1 else 0 end), id
         ) as keep_id
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
--   select lower(trim(name)) as name, homegroup, count(*)
--   from students group by 1,2 having count(*) > 1;
--
-- Students sharing a name but genuinely different people, for reassurance:
--   select name, year_level, gender, homegroup from students
--   where lower(trim(name)) in (
--     select lower(trim(name)) from students group by 1 having count(*) > 1)
--   order by name, homegroup;
