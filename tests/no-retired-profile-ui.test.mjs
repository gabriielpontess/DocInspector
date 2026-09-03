import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const file of ['../js/permissions.js', '../js/user-admin-ui.js', '../js/access-request-admin-ui.js', '../supabase/functions/docinspector-user-admin/index.ts']) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /INSPECTOR|SUPERVISOR|FOREMAN|Inspetor|Supervisor|Encarregado/, `${file} must not expose retired profiles`);
}

console.log('Retired profiles are absent from active UI/backend contracts.');
