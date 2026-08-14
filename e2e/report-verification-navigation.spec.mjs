import { test, expect } from '@playwright/test';

async function seedInspections(page) {
  await page.goto('/');
  await expect(page.locator('.topbar h1')).toHaveText('Início');

  const ids = await page.evaluate(async () => {
    const [{ createInspection, makeDocument }, { saveInspection }] = await Promise.all([
      import('/js/domain.js'),
      import('/js/db.js')
    ]);

    const make = (code, description) => makeDocument({
      code,
      description,
      status: 'APROVADO',
      expectedRevision: '0'
    });

    const inspectionA = createInspection({
      name: 'Lista Alfa',
      project: 'Projeto Alfa',
      system: 'SISTEMA ALFA',
      responsible: 'Teste automatizado',
      location: 'Campo'
    });
    inspectionA.documents = [
      make('PW-A-001', 'Documento exclusivo da lista Alfa'),
      make('PW-SHARED', 'Mesmo código usado para provar o filtro por lista')
    ];

    const inspectionB = createInspection({
      name: 'Lista Beta',
      project: 'Projeto Beta',
      system: 'SISTEMA BETA',
      responsible: 'Teste automatizado',
      location: 'Campo'
    });
    inspectionB.documents = [
      make('PW-B-001', 'Primeiro documento Beta'),
      make('PW-B-002', 'Segundo documento Beta'),
      make('PW-B-003', 'Terceiro documento Beta'),
      make('PW-SHARED', 'Mesmo código usado para provar o filtro por lista')
    ];

    await saveInspection(inspectionA);
    await saveInspection(inspectionB);
    return { inspectionA: inspectionA.id, inspectionB: inspectionB.id };
  });

  await page.reload();
  await expect(page.locator('.inspection-item')).toHaveCount(2);
  return ids;
}

test('Verificar alterna entre busca global e uma lista específica', async ({ page }) => {
  const ids = await seedInspections(page);
  await page.locator('[data-nav="inspect"]:visible').first().click();
  await expect(page.locator('.topbar h1')).toHaveText('Verificação em campo');

  const scope = page.locator('#verification-scope');
  await expect(scope).toBeVisible();
  await expect(scope).toHaveValue('');
  await expect(scope.locator('option')).toHaveCount(3);

  await scope.selectOption(ids.inspectionB);
  await expect(page.locator('.locate-card .section-kicker').first()).toHaveText('BUSCA POR LISTA');

  const search = page.locator('#pw-search');
  await search.fill('PW-SHARED');
  const visibleSuggestions = page.locator('#pw-suggestions [data-search-doc]:visible');
  await expect(visibleSuggestions).toHaveCount(1);
  await expect(visibleSuggestions.first()).toContainText('SISTEMA BETA');

  await search.press('Enter');
  await expect(page.locator('.doc-detail .doc-heading h2')).toHaveText('PW-SHARED');
  await expect(page.locator('.doc-detail .doc-kicker')).toContainText('SISTEMA BETA');

  await scope.selectOption('');
  await expect(page.locator('.locate-card .section-kicker').first()).toHaveText('BUSCA GLOBAL');
});

test('Mais detalhes navega para anterior e próximo dentro da inspeção', async ({ page }) => {
  await seedInspections(page);
  const betaCard = page.locator('.inspection-item').filter({ hasText: 'Lista Beta' });
  await betaCard.locator('.inspection-summary').click();
  await expect(page.locator('.topbar h1')).toContainText('Documentos');

  const middleRow = page.locator('tr[data-doc-row]').filter({ hasText: 'PW-B-002' });
  await middleRow.locator('[data-doc-details]').click();
  await expect(page.locator('.document-page .doc-heading h2')).toHaveText('PW-B-002');

  const previous = page.locator('#detail-previous-document');
  const next = page.locator('#detail-next-document');
  await expect(previous).toBeVisible();
  await expect(next).toBeVisible();
  await expect(page.locator('.document-detail-navigation .document-position')).toHaveText('2 de 4');

  await previous.click();
  await expect(page.locator('.document-page .doc-heading h2')).toHaveText('PW-B-001');
  await expect(page.locator('#detail-previous-document')).toBeDisabled();

  await page.locator('#detail-next-document').click();
  await expect(page.locator('.document-page .doc-heading h2')).toHaveText('PW-B-002');
});

test('Cópias de campo são opção separada e desmarcada no PDF', async ({ page }) => {
  await seedInspections(page);
  const betaCard = page.locator('.inspection-item').filter({ hasText: 'Lista Beta' });
  await betaCard.locator('button.inspection-more-button').click();
  const sheet = page.getByRole('dialog', { name: 'Ações da inspeção' });
  await sheet.getByRole('menuitem', { name: 'Exportar' }).click();

  const dialog = page.getByRole('dialog', { name: 'Exportar relatório da inspeção' });
  const copies = dialog.locator('#exp-pdf-copies');
  await expect(copies).toBeVisible();
  await expect(copies).not.toBeChecked();
  await expect(dialog).toContainText('O relatório principal permanece com uma única linha por Código PW');
});
