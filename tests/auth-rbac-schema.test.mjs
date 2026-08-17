import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const identity = await readFile('supabase/migrations/20260817162807_add_auth_profiles_and_workspace_memberships.sql', 'utf8');
const discovery = await readFile('supabase/migrations/20260817162939_add_authenticated_workspace_discovery.sql', 'utf8');

for (const role of ['ADMIN', 'INSPECTOR', 'SUPERVISOR', 'FOREMAN']) {
  assert.match(identity, new RegExp(`'${role}'`), `role ${role} must be constrained in the database`);
}

assert.match(identity, /references auth\.users\(id\) on delete cascade/i);
assert.match(identity, /enable row level security/i);
assert.match(identity, /docinspector_workspace_members_select_own/i);
assert.match(identity, /\(select auth\.uid\(\)\) = user_id/i);
assert.match(identity, /security definer[\s\S]*insert into public\.docinspector_profiles/i);
assert.match(identity, /revoke all on function private\.docinspector_create_profile_for_auth_user\(\) from public, anon, authenticated/i);

assert.match(discovery, /grant select \(id, name, created_at\) on table public\.sky17_workspaces to authenticated/i);
assert.match(discovery, /docinspector_workspaces_select_member/i);
assert.match(discovery, /m\.user_id = \(select auth\.uid\(\)\)/i);
assert.match(discovery, /and m\.active/i);
assert.match(discovery, /create or replace function public\.docinspector_my_workspaces\(\)/i);
assert.match(discovery, /security invoker/i);
assert.doesNotMatch(discovery, /security definer/i);
assert.match(discovery, /revoke all on function public\.docinspector_my_workspaces\(\) from public, anon/i);
assert.match(discovery, /grant execute on function public\.docinspector_my_workspaces\(\) to authenticated/i);

console.log('Auth/RBAC schema migration regression checks passed.');
