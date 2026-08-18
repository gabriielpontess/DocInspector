drop policy if exists docinspector_workspace_members_select_own on public.docinspector_workspace_members;
create policy docinspector_workspace_members_select_own_active
on public.docinspector_workspace_members
for select
to authenticated
using ((select auth.uid()) = user_id and active);
