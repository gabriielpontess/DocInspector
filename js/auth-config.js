// Supabase publishable credentials identify the public application client.
// They are not privileged secrets. Authorization must always be enforced by
// authenticated-user checks plus server-side RLS/RPC policies.
export const AUTH_CONFIG = Object.freeze({
  enabled: false,
  projectUrl: 'https://snntxxfrcsepxenmmrue.supabase.co',
  publishableKey: 'sb_publishable_d_oUtSBR4Slzt0MrgYyhfA_BbEqrEVU',
  storageKey: 'docinspector-auth-v1'
});

export function authRolloutEnabled() {
  return AUTH_CONFIG.enabled === true;
}
