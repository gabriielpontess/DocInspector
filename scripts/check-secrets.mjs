import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ignored = new Set(['.git', 'node_modules', 'assets']);
const patterns = [
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /\bservice_role\b\s*[:=]\s*["'][^"']{20,}/i,
  /\bsbp_[A-Za-z0-9_-]{20,}\b/,
  /\b(?:SECRET|PASSWORD|PRIVATE_TOKEN)\s*[:=]\s*["'][^"']{12,}/i
];

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    if (ignored.has(name)) continue;
    const full = path.join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) out.push(...await walk(full));
    else if (/\.(?:js|mjs|json|md|html|css|sql|yml|yaml|toml|txt|webmanifest)$/.test(name) || name.startsWith('.')) out.push(full);
  }
  return out;
}

for (const file of await walk('.')) {
  const text = await readFile(file, 'utf8').catch(() => '');
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      console.error(`Possível segredo detectado em ${file}: ${pattern}`);
      process.exit(1);
    }
  }
}
console.log('Nenhum padrão de credencial privilegiada detectado.');
