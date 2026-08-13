import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const files = (await readdir('tests')).filter(name => name.endsWith('.mjs')).sort();
const failedFiles = [];
for (const file of files) {
  const result = spawnSync(process.execPath, [`tests/${file}`], { stdio: 'inherit' });
  if (result.status !== 0) {
    failedFiles.push(file);
    console.error(`::error file=tests/${file},title=Regression test failed::${file} exited with status ${result.status ?? 'unknown'}`);
  }
}
if (failedFiles.length) {
  console.error(`${failedFiles.length} teste(s) falharam: ${failedFiles.join(', ')}`);
  process.exit(1);
}
console.log(`${files.length}/${files.length} testes aprovados.`);
