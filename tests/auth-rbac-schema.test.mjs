import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const identity = await readFile('supabase/migrations/20260817162807_add_auth_profiles_and_workspace_memberships.sql', 'utf8');
const discovery = await readFile('supabase/migrations/20260817162939_add_authenticated_workspace_discovery.sql', 'utf8');
const membershipHardening = await readFile('supabase/migrations/20260817191245_hide_inactive_memberships_from_authenticated_clients.sql', 'utf8');
const adminOnly = await readFile('supabase/migrations/20260903174000_enforce_admin_only_memberships.sql', 'utf8');

// Historical migration is preserved as provenance of the original RBAC rollout.
for (const role of ['ADMIN', 'INSPECTOR', 'SUPERVISOR', 'FOREMAN']) {
  assert.match(identity, new RegExp(`'${role}'`), `historical role ${role} must remain documented`);
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

assert.match(membershipHardening, /drop policy if exists docinspector_workspace_members_select_own/i);
assert.match(membershipHardening, /docinspector_workspace_members_select_own_active/i);
assert.match(membershipHardening, /\(select auth\.uid\(\)\) = user_id and active/i);

assert.match(adminOnly, /update public\.docinspector_workspace_members[\s\S]*set role = 'ADMIN'[\s\S]*where role <> 'ADMIN'/i);
assert.match(adminOnly, /drop constraint if exists docinspector_workspace_members_role_check/i);
assert.match(adminOnly, /check \(role = 'ADMIN'\)/i);
assert.doesNotMatch(adminOnly, /'INSPECTOR'|'SUPERVISOR'|'FOREMAN'/i, 'forward contract must accept only ADMIN');

console.log('Auth/RBAC schema migration regression checks passed.');
