import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_VERSION = '6.2.108';
const packageJson = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const pinned = packageJson.dependencies?.['pdfjs-dist'];
if (pinned !== EXPECTED_VERSION) {
  throw new Error(`pdfjs-dist deve permanecer fixado em ${EXPECTED_VERSION}; encontrado ${pinned || 'ausente'}.`);
}

const installedPackagePath = resolve(ROOT, 'node_modules/pdfjs-dist/package.json');
const installedPackage = JSON.parse(await readFile(installedPackagePath, 'utf8'));
if (installedPackage.version !== EXPECTED_VERSION) {
  throw new Error(`pdfjs-dist instalado em versão inesperada: ${installedPackage.version}.`);
}

const outputDir = resolve(ROOT, 'vendor/pdfjs');
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const [source, destination] of [
  ['node_modules/pdfjs-dist/legacy/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['node_modules/pdfjs-dist/LICENSE', 'LICENSE']
]) {
  await copyFile(resolve(ROOT, source), resolve(outputDir, destination));
}

await writeFile(
  resolve(outputDir, 'version.json'),
  `${JSON.stringify({ package: 'pdfjs-dist', version: EXPECTED_VERSION }, null, 2)}\n`,
  'utf8'
);

console.log(`PDF.js ${EXPECTED_VERSION} self-hosted assets prepared.`);
