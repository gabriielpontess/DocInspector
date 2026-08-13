import { test, expect } from '@playwright/test';

async function seedInspection(page) {
  await page.goto('/');
  await expect(page.locator('.topbar h1')).toHaveText('Início');

  await page.evaluate(async () => {
    const [{ createInspection, makeDocument }, { saveInspection }] = await Promise.all([
      import('/js/domain.js'),
      import('/js/db.js')
    ]);

    const inspection = createInspection({
      name: 'E2E Mobile Actions',
      project: 'E2E Mobile Actions',
      system: 'AMV',
      responsible: 'Teste automatizado',
      location: 'Campo'
    });
    inspection.documents = [makeDocument({
      code: 'PW-E2E-001',
      description: 'Documento descartável para validar ações da inspeção',
      status: 'APROVADO',
      expectedRevision: '0'
    })];

    await saveInspection(inspection);
  });

  await page.reload();
  const card = page.locator('.inspection-item').filter({ hasText: 'E2E Mobile Actions' }).first();
  await expect(card).toBeVisible();
  await expect(card.locator('details.inspection-more-menu')).toHaveCount(0);
  await expect(card.locator('button.inspection-more-button')).toHaveCount(1);
  return card;
}

async function openActionSheet(page, card) {
  await card.locator('button.inspection-more-button').click();
  const sheet = page.getByRole('dialog', { name: 'Ações da inspeção' });
  await expect(sheet).toBeVisible();
  const attachedToBody = await sheet.evaluate(element =>
    element.closest('.inspection-action-sheet-backdrop')?.parentElement === document.body
  );
  expect(attachedToBody).toBe(true);
  await expect(page.locator('.topbar h1')).toHaveText('Início');
  return sheet;
}

async function closeModal(dialog) {
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  await expect(dialog).toHaveCount(0);
}

test('menu secundário usa Action Sheet fora do card e executa ações sem navegar', async ({ page }) => {
  const card = await seedInspection(page);

  let sheet = await openActionSheet(page, card);
  await sheet.getByRole('menuitem', { name: 'Editar' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Editar lista de inspeção' });
  await expect(editDialog).toBeVisible();
  await expect(page.locator('.topbar h1')).toHaveText('Início');
  await closeModal(editDialog);

  sheet = await openActionSheet(page, card);
  await sheet.getByRole('menuitem', { name: 'Atualizar lista' }).click();
  const updateDialog = page.getByRole('dialog', { name: 'Atualizar lista da inspeção' });
  await expect(updateDialog).toBeVisible();
  await expect(page.locator('.topbar h1')).toHaveText('Início');
  await closeModal(updateDialog);

  sheet = await openActionSheet(page, card);
  await sheet.getByRole('menuitem', { name: 'Exportar' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Exportar relatório da inspeção' });
  await expect(exportDialog).toBeVisible();
  await expect(page.locator('.topbar h1')).toHaveText('Início');
  await closeModal(exportDialog);
});

test('área branca do card continua abrindo Documentos', async ({ page }) => {
  const card = await seedInspection(page);
  await card.locator('.inspection-summary').click();
  await expect(page.locator('.topbar h1')).toHaveText('Documentos');
  await expect(page.locator('#filter-system')).toHaveValue('AMV');
});
