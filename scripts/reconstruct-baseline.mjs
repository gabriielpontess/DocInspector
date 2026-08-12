import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const files = {
  'js/app.js': ['e2df412441c9b55b9d5abe0c1beabcb1e3db5315ace356f06cdb7543f513c3cd', 113502],
  'js/db.js': ['1df092190c559993f1ec139f9659e866584570ec75e2b89f1fd0da782e4a6184', 11993],
  'js/domain.js': ['94fc517943f7215b29ce225957d3320815fa0133a62e7262ae0c30b23eb42449', 14048],
  'js/pwa.js': ['20634701498ac411d93628d3e81c1c70b0aa7e3c17fad263741732f519592057', 4307],
  'js/report.js': ['b5b84c11958f60e7f497b2be7eff8c333561746edc69a78eb48ce3694dd46d6e', 13276],
  'js/sync.js': ['8813a9e28993b4de2779fd3cda59b99184adc807818edcef8b53b646360b6e66', 28187],
  'js/ui.js': ['849e8d0ccad9eedb66ea5a873eefdc0f48a8c498f41e6cbf6e3068f2b270adcf', 5883],
  'js/vision.js': ['35d1bb07dabeabac9bfef0fd696ef041eb2cc46f5a6517ab07208ff9040263a1', 16860],
  'js/xlsx.js': ['494849992e27580e5fb0cc9fb4d508a72ca6ff5cd2f2397c2c5c24ff3eee8d88', 22525],
  'styles.css': ['aaa4e1c67f9a11993c91283c7013eacd99656c268e898e8018a78b213e90852e', 81047]
};

const appParts = [
  'js__app_js.000.fixed.b64',
  'js__app_js.001.b64',
  'js__app_js.002.b64',
  'js__app_js.003.b64',
  'js__app_js.004.b64',
  'js__app_js.005.fixed.b64'
];

for (const [target, [expectedHash, expectedSize]] of Object.entries(files)) {
  const key = target.replaceAll('/', '__').replaceAll('.', '_');
  const parts = target === 'js/app.js'
    ? appParts
    : (await readdir('.import_gz')).filter(name => name.startsWith(`${key}.`) && name.endsWith('.b64') && !name.includes('.fixed.')).sort();
  if (!parts.length) throw new Error(`Fragmentos ausentes para ${target}`);
  console.log(`BEGIN ${target} (${parts.length} fragmentos)`);
  const encoded = (await Promise.all(parts.map(name => readFile(`.import_gz/${name}`, 'utf8')))).join('').replace(/\s+/g, '');
  const data = gunzipSync(Buffer.from(encoded, 'base64'));
  const hash = createHash('sha256').update(data).digest('hex');
  if (data.length !== expectedSize) throw new Error(`${target}: tamanho ${data.length}, esperado ${expectedSize}`);
  if (hash !== expectedHash) throw new Error(`${target}: SHA-256 divergente ${hash}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  console.log(`OK ${target} ${hash}`);
}
