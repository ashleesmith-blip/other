-- ============================================================================
-- VIT Inquiry Hub — Supabase schema, row-level security, and triggers.
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Safe to re-run (drops policies before recreating them).
-- ============================================================================

-- ---------- tables --------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  role        text not null default 'graduate' check (role in ('admin','mentor','graduate')),
  vit_reg_no  text,
  mentor_id   uuid references public.profiles (id) on delete set null,
  color       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.projects (
  id          text primary key,                                  -- app-generated short id
  owner_id    uuid not null unique references public.profiles (id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,                 -- the whole project object
  updated_at  timestamptz not null default now()
);

create table if not exists public.program (
  id          text primary key default 'program',
  milestones  jsonb not null default '[]'::jsonb,
  start_date  text not null default ''
);

-- ---------- helper functions (SECURITY DEFINER avoids RLS recursion) ------
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- true if the current user may read+write the project owned by p_owner:
-- the owner themselves, that owner's assigned mentor, or any admin.
create or replace function public.can_access_project(p_owner uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_admin()
      or p_owner = auth.uid()
      or exists (select 1 from public.profiles where id = p_owner and mentor_id = auth.uid());
$$;

-- ---------- new-user trigger: create a profile; first user becomes admin ---
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role, color)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when (select count(*) from public.profiles) = 0 then 'admin' else 'graduate' end,
    '#3B82F6'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- row-level security -------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.program  enable row level security;

-- profiles: everyone signed in can read (needed for names, dashboards, mentor
-- lists). Only admins may change or remove profiles (role/mentor assignment).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated using (public.is_admin());
-- (inserts happen only via the SECURITY DEFINER trigger above)

-- projects: owner + assigned mentor + admin can read and write.
-- A graduate can create their own project row; admins can create any.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated using (public.can_access_project(owner_id));
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated using (public.can_access_project(owner_id)) with check (public.can_access_project(owner_id));
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete to authenticated using (public.is_admin());

-- program: everyone reads the shared schedule; only admins edit it.
drop policy if exists program_select on public.program;
create policy program_select on public.program for select to authenticated using (true);
drop policy if exists program_write on public.program;
create policy program_write on public.program for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- notes ---------------------------------------------------------
-- • The graduate's project stores its whole object (write-up, students,
--   checkpoints, logs, appendices, feedback) in projects.data JSONB. Mentors
--   post feedback by updating that row, which their access policy allows.
-- • Removing a profile here cascades to their project. It does NOT delete the
--   auth login — do that in Supabase → Authentication → Users if you need to
--   fully revoke access.
