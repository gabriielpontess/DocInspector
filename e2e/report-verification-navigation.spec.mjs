import { test, expect } from '@playwright/test';

const E2E_URL = '/?e2e-auth-bypass=1';

async function seedInspections(page) {
  await page.goto(E2E_URL);
  await expect(page.locator('.topbar h1')).toHaveText('Início');
  await page.evaluate(async () => {
    const [{ createInspection, makeDocument, addFieldCopy }, { replaceAllInspections }] = await Promise.all([
      import('/js/domain.js'),
      import('/js/db.js')
    ]);
    const alpha = createInspection({ name: 'Lista Alfa', project: 'Projeto', system: 'ALFA', responsible: 'Teste', location: 'Campo' });
    alpha.id = 'inspection-alpha';
    const alphaDoc = makeDocument({ code: 'PW-A-001', description: 'Documento Alfa', expectedRevision: 'A', status: 'ATIVO' });
    addFieldCopy(alphaDoc, { foundRevision: 'A', markings: ['Verde'], comment: 'OK' });
    alpha.documents = [alphaDoc];

    const beta = createInspection({ name: 'Lista Beta', project: 'Projeto', system: 'BETA', responsible: 'Teste', location: 'Campo' });
    beta.id = 'inspection-beta';
    const betaOne = makeDocument({ code: 'PW-B-001', description: 'Documento Beta 1', expectedRevision: 'A', status: 'ATIVO' });
    const betaTwo = makeDocument({ code: 'PW-B-002', description: 'Documento Beta 2', expectedRevision: 'B', status: 'ATIVO' });
    addFieldCopy(betaOne, { foundRevision: 'A', markings: ['Verde'], comment: 'Cópia B1' });
    addFieldCopy(betaTwo, { foundRevision: 'C', markings: ['Vermelho'], comment: 'Cópia B2' });
    beta.documents = [betaOne, betaTwo];

    await replaceAllInspections([alpha, beta]);
  });
  await page.reload();
  await expect(page.locator('.inspection-item')).toHaveCount(2);
}

test('Auth gate exige sessão antes de carregar o aplicativo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar no DocInspector' })).toBeVisible();
  await expect(page.locator('#auth-form')).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
});

test('Verificar alterna entre busca global e uma lista específica', async ({ page }) => {
  await seedInspections(page);
  await page.locator('[data-nav="inspect"]:visible').first().click();
  await expect(page.locator('.topbar h1')).toHaveText('Verificação em campo');

  const scope = page.locator('#verification-scope');
  await expect(scope).toHaveAttribute('data-loaded', '1');
  await expect(scope).toHaveValue('');
  await expect(scope.locator('option:checked')).toHaveText('Todas as inspeções (global)');
  await expect(page.locator('.locate-card .section-kicker')).toHaveText('BUSCA GLOBAL');

  await scope.selectOption('inspection-beta');
  await expect(scope.locator('option:checked')).toContainText('BETA · Lista Beta');
  await expect(page.locator('.locate-card .section-kicker')).toHaveText('BUSCA POR LISTA');
  await page.locator('#pw-search').fill('PW-B-001');
  await page.locator('#pw-search').press('Enter');
  await expect(page.locator('.doc-detail')).toContainText('PW-B-001');

  await scope.selectOption('inspection-alpha');
  await expect(page.locator('#pw-search')).toHaveValue('');
  await expect(scope.locator('option:checked')).toContainText('ALFA · Lista Alfa');
});

test('Mais detalhes navega para anterior e próximo dentro da inspeção', async ({ page }) => {
  await seedInspections(page);
  await page.locator('[data-nav="docs"]:visible').first().click();
  await expect(page.locator('.topbar h1')).toHaveText('Documentos');

  const betaOneRow = page.locator('#docs-body tr.document-row-clickable').filter({ hasText: 'PW-B-001' });
  await expect(betaOneRow).toHaveCount(1);
  await expect(betaOneRow).toContainText('BETA');
  await betaOneRow.locator('[data-doc-details]').click();
  await expect(page.locator('.document-page .doc-heading h2')).toHaveText('PW-B-001');

  const previous = page.locator('#detail-previous-document');
  const next = page.locator('#detail-next-document');
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();

  await next.click();
  await expect(page.locator('.document-page .doc-heading h2')).toHaveText('PW-B-002');
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();

  await previous.click();
  await expect(page.locator('.document-page .doc-heading h2')).toHaveText('PW-B-001');
  await expect(page.locator('#detail-previous-document')).toBeDisabled();

  await page.locator('#detail-next-document').click();
  await expect(page.locator('.document-page .doc-heading h2')).toHaveText('PW-B-002');
});

test('Cópias de campo são opção compacta, separada e desmarcada no PDF', async ({ page }) => {
  await seedInspections(page);
  const betaCard = page.locator('.inspection-item').filter({ hasText: 'Lista Beta' });
  await betaCard.locator('button.inspection-more-button').click();
  const sheet = page.getByRole('dialog', { name: 'Ações da inspeção' });
  await sheet.getByRole('menuitem', { name: 'Exportar' }).click();

  const dialog = page.getByRole('dialog', { name: 'Exportar relatório da inspeção' });
  const copies = dialog.locator('#exp-pdf-copies');
  await expect(copies).toBeVisible();
  await expect(copies).not.toBeChecked();
  await expect(dialog).toContainText('Incluir cópias de campo no PDF');
  await expect(dialog).not.toContainText('Opcional. Acrescenta revisão encontrada');

  const box = await copies.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeLessThanOrEqual(24);
  expect(box.height).toBeLessThanOrEqual(24);

  const viewport = page.viewportSize();
  if (viewport && viewport.width >= 768 && viewport.height >= 700) {
    const fit = await dialog.evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowX: getComputedStyle(element).overflowX,
      overflowY: getComputedStyle(element).overflowY
    }));
    expect(fit.overflowX).toBe('hidden');
    expect(['auto', 'scroll']).toContain(fit.overflowY);
    expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight + 1);
  }
});

test('Sincronização mantém a rolagem afastada da moldura do modal no desktop', async ({ page }) => {
  await page.goto(E2E_URL);
  await page.locator('[data-nav="settings"]:visible').first().click();
  await expect(page.locator('.topbar h1')).toHaveText('Dados e backup');
  await page.locator('#configure-sync').click();

  const dialog = page.getByRole('dialog', { name: 'Configurar sincronização' });
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize();
  if (viewport && viewport.width >= 768) {
    const metrics = await dialog.evaluate(element => {
      const tabs = element.querySelector('.sync-setup-tabs');
      return tabs ? {
        modalRight: element.getBoundingClientRect().right,
        tabsRight: tabs.getBoundingClientRect().right,
        paddingRight: parseFloat(getComputedStyle(element).paddingRight || '0')
      } : null;
    });
    expect(metrics).not.toBeNull();
    expect(metrics.modalRight - metrics.tabsRight).toBeGreaterThanOrEqual(Math.max(10, metrics.paddingRight - 2));
  }
});
