import { readFile } from 'node:fs/promises';

async function readNormalized(path) {
  return (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
}

const ci = await readNormalized('.github/workflows/ci.yml');
const e2e = await readNormalized('.github/workflows/mobile-actions-e2e.yml');
const localE2e = await readNormalized('.github/workflows/local-runner-e2e.yml');
const trustedLocalE2e = await readNormalized('.github/workflows/trusted-local-e2e.yml');
const dependabot = await readNormalized('.github/dependabot.yml');

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
requireText(trustedLocalE2e, 'workflow_run:', 'E2E local automático deve ser disparado por workflow_run confiável.');
requireText(trustedLocalE2e, "github.event.workflow_run.head_repository.full_name == github.repository", 'E2E local automático deve bloquear código vindo de forks.');
requireText(trustedLocalE2e, "github.event.workflow_run.pull_requests[0].base.ref == 'develop'", 'E2E local automático deve ficar restrito a PRs destinados a develop.');
requireText(trustedLocalE2e, 'runs-on: [self-hosted, Windows, X64, docinspector-e2e]', 'E2E local automático deve exigir o runner Windows dedicado.');
if (trustedLocalE2e.includes('pull_request:')) {
  failures.push('Workflow self-hosted confiável não deve aceitar gatilho pull_request direto.');
}
requireText(dependabot, 'package-ecosystem: npm', 'Dependabot deve manter dependências npm.');
requireText(dependabot, 'package-ecosystem: github-actions', 'Dependabot deve manter GitHub Actions.');

if (failures.length) {
  for (const failure of failures) console.error(`::error title=Automation contract::${failure}`);
  process.exit(1);
}

console.log('Contratos de automação aprovados.');
