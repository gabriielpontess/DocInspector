create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.docinspector_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint docinspector_profiles_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 120)
);

create table public.docinspector_workspace_members (
  workspace_id uuid not null references public.sky17_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint docinspector_workspace_members_role_check
    check (role in ('ADMIN', 'INSPECTOR', 'SUPERVISOR', 'FOREMAN'))
);

create index docinspector_workspace_members_user_idx
  on public.docinspector_workspace_members(user_id, workspace_id)
  where active;

alter table public.docinspector_profiles enable row level security;
alter table public.docinspector_workspace_members enable row level security;

revoke all on table public.docinspector_profiles from anon, authenticated;
revoke all on table public.docinspector_workspace_members from anon, authenticated;

grant select on table public.docinspector_profiles to authenticated;
grant update (display_name) on table public.docinspector_profiles to authenticated;
grant select on table public.docinspector_workspace_members to authenticated;

create policy docinspector_profiles_select_own
on public.docinspector_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy docinspector_profiles_update_own
on public.docinspector_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy docinspector_workspace_members_select_own
on public.docinspector_workspace_members
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function private.docinspector_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.docinspector_touch_updated_at() from public, anon, authenticated;

create trigger docinspector_profiles_touch_updated_at
before update on public.docinspector_profiles
for each row execute function private.docinspector_touch_updated_at();

create trigger docinspector_workspace_members_touch_updated_at
before update on public.docinspector_workspace_members
for each row execute function private.docinspector_touch_updated_at();

create or replace function private.docinspector_create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.docinspector_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.docinspector_create_profile_for_auth_user() from public, anon, authenticated;

drop trigger if exists docinspector_auth_user_profile on auth.users;
create trigger docinspector_auth_user_profile
after insert on auth.users
for each row execute function private.docinspector_create_profile_for_auth_user();
