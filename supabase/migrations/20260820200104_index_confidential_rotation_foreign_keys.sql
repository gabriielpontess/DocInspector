-- Cover Phase 6 rotation foreign keys reported by Supabase Performance Advisor.
-- The (workspace_id, to_key_version) FK is already covered by the table primary key.

create index docinspector_workspace_key_rotations_from_key_idx
  on private.docinspector_workspace_key_rotations(workspace_id, from_key_version);

create index docinspector_workspace_key_rotations_removed_user_idx
  on private.docinspector_workspace_key_rotations(removed_user_id);

create index docinspector_workspace_key_rotations_started_by_idx
  on private.docinspector_workspace_key_rotations(started_by);
