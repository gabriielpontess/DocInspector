revoke all on table public.sky17_workspaces from authenticated;
grant select (id, name, created_at) on table public.sky17_workspaces to authenticated;

drop policy if exists docinspector_workspaces_select_member on public.sky17_workspaces;
create policy docinspector_workspaces_select_member
on public.sky17_workspaces
for select
to authenticated
using (
  exists (
    select 1
    from public.docinspector_workspace_members m
    where m.workspace_id = sky17_workspaces.id
      and m.user_id = (select auth.uid())
      and m.active
  )
);

create or replace function public.docinspector_my_workspaces()
returns table (
  workspace_id uuid,
  workspace_name text,
  role text,
  member_active boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select w.id, w.name, m.role, m.active
  from public.docinspector_workspace_members m
  join public.sky17_workspaces w on w.id = m.workspace_id
  where m.user_id = (select auth.uid())
    and m.active
  order by w.name, w.id;
$$;

revoke all on function public.docinspector_my_workspaces() from public, anon;
grant execute on function public.docinspector_my_workspaces() to authenticated;
