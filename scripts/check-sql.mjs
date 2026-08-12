import { readFile } from 'node:fs/promises';
const a = await readFile('SUPABASE-SETUP.sql');
const b = await readFile('supabase/SUPABASE-SETUP.sql');
if (!a.equals(b)) {
  console.error('As duas cópias de SUPABASE-SETUP.sql divergem.');
  process.exit(1);
}
console.log('SQL principal e cópia supabase são idênticos.');
