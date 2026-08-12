import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const files = (await readdir('tests')).filter(name => name.endsWith('.mjs')).sort();
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, [`tests/${file}`], { stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}
if (failed) {
  console.error(`${failed} teste(s) falharam.`);
  process.exit(1);
}
console.log(`${files.length}/${files.length} testes aprovados.`);
