import { readFile } from 'node:fs/promises';

const ci = await readFile('.github/workflows/ci.yml', 'utf8');
const e2e = await readFile('.github/workflows/mobile-actions-e2e.yml', 'utf8');
const localE2e = await readFile('.github/workflows/local-runner-e2e.yml', 'utf8');
const dependabot = await readFile('.github/dependabot.yml', 'utf8');

const failures = [];

function requireText(source, expected, message) {
  if (!source.includes(expected)) failures.push(message);
}

requireText(ci, 'cancel-in-progress: true', 'CI deve cancelar execuções supersededidas.');
requireText(ci, 'npm run check', 'CI deve executar o quality gate determinístico completo.');
requireText(e2e, 'cancel-in-progress: true', 'E2E deve cancelar execuções supersededidas.');
requireText(e2e, "paths:\n      - 'index.html'", 'E2E deve usar filtro de paths para evitar browser gate em mudanças não relacionadas.');
if (e2e.includes('npm run check')) {
  failures.push('E2E hospedado não deve duplicar o quality gate determinístico do CI.');
}
requireText(localE2e, 'runs-on: [self-hosted, Windows, X64, docinspector-e2e]', 'Workflow local deve exigir o runner Windows dedicado.');
requireText(dependabot, 'package-ecosystem: npm', 'Dependabot deve manter dependências npm.');
requireText(dependabot, 'package-ecosystem: github-actions', 'Dependabot deve manter GitHub Actions.');

if (failures.length) {
  for (const failure of failures) console.error(`::error title=Automation contract::${failure}`);
  process.exit(1);
}

console.log('Contratos de automação aprovados.');
