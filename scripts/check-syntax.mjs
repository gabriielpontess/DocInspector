import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const files = [...(await readdir('js')).filter(name => name.endsWith('.js')).map(name => `js/${name}`), 'sw.js'];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`${files.length} arquivos JavaScript validados.`);
