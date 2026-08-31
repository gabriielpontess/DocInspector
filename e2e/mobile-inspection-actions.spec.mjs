import { test, expect } from '@playwright/test';

async function seedInspection(page) {
  await page.goto('/?e2e-auth-bypass=1');
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
    inspection.documents = [
      makeDocument({
        code: 'PW-E2E-001',
        description: 'Documento descartável para validar ações da inspeção',
        status: 'APROVADO',
        expectedRevision: '0'
      }),
      makeDocument({
        code: 'PW-E2E-002',
        description: 'Documento preservado para validar exclusão lógica',
        status: 'APROVADO',
        expectedRevision: '0'
      })
    ];

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

async function assertSeededInspection(page) {
  await expect(page.locator('.topbar h1')).toHaveText('Início');
  const card = page.locator('.inspection-item').filter({ hasText: 'E2E Mobile Actions' }).first();
  await expect(card).toBeVisible();
  await card.locator('.inspection-summary').click();
  await expect(page.locator('.topbar h1')).toContainText('Documentos');
  await expect(page.locator('#filter-system')).toHaveValue('AMV');
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
  await expect(page.locator('.topbar h1')).toContainText('Documentos');
  await expect(page.locator('#filter-system')).toHaveValue('AMV');
});

test('gerenciamento de documento edita metadados e exclui com tombstone sem perder o restante da lista', async ({ page }) => {
  const card = await seedInspection(page);
  await card.locator('.inspection-summary').click();
  await expect(page.locator('.topbar h1')).toContainText('Documentos');

  const firstRow = page.locator('tr[data-doc-row]').filter({ hasText: 'PW-E2E-001' }).first();
  await expect(firstRow).toBeVisible();
  await expect(firstRow.locator('[data-edit-document]')).toBeVisible();
  await firstRow.locator('[data-edit-document]').click();

  const editor = page.getByRole('dialog', { name: 'Editar documento PW-E2E-001' });
  await expect(editor).toBeVisible();
  await editor.locator('#manage-document-code').fill('PW-E2E-001-A');
  await editor.locator('#manage-document-description').fill('Documento editado pelo E2E');
  await editor.locator('#manage-document-revision').fill('A');
  await editor.locator('#save-document-metadata').click();
  await expect(editor).toHaveCount(0);

  const editedRow = page.locator('tr[data-doc-row]').filter({ hasText: 'PW-E2E-001-A' }).first();
  await expect(editedRow).toBeVisible();
  await expect(editedRow).toContainText('Documento editado pelo E2E');
  await editedRow.locator('[data-delete-document]').click();

  const deleteDialog = page.getByRole('dialog', { name: 'Excluir documento PW-E2E-001-A' });
  await expect(deleteDialog).toBeVisible();
  const deleteReason = deleteDialog.locator('#delete-document-reason');
  await deleteReason.click();
  await deleteReason.pressSequentially('Removido pelo smoke E2E', { delay: 5 });
  await expect(deleteReason).toHaveValue('Removido pelo smoke E2E');
  await deleteDialog.locator('#confirm-document-delete').click();
  await expect(deleteDialog).toHaveCount(0);

  await expect(page.locator('tr[data-doc-row]').filter({ hasText: 'PW-E2E-001-A' })).toHaveCount(0);
  await expect(page.locator('tr[data-doc-row]').filter({ hasText: 'PW-E2E-002' })).toBeVisible();

  await expect.poll(async () => page.evaluate(async () => {
    const { listInspections } = await import('/js/db.js');
    const inspection = (await listInspections()).find(item => item.project === 'E2E Mobile Actions');
    return inspection?.deletedDocuments.find(item => item.document.code === 'PW-E2E-001-A')?.reason || null;
  }), {
    message: 'motivo da exclusão deve estar persistido antes da asserção final',
    timeout: 5000
  }).toBe('Removido pelo smoke E2E');

  const persisted = await page.evaluate(async () => {
    const { listInspections } = await import('/js/db.js');
    const inspection = (await listInspections()).find(item => item.project === 'E2E Mobile Actions');
    return {
      activeCodes: inspection.documents.map(item => item.code),
      deletedDocumentIds: inspection.deletedDocumentIds,
      deletedDocument: inspection.deletedDocuments.find(item => item.document.code === 'PW-E2E-001-A'),
      auditActions: inspection.documentAudit.map(item => item.action)
    };
  });

  expect(persisted.activeCodes).toEqual(['PW-E2E-002']);
  expect(persisted.deletedDocumentIds).toHaveLength(1);
  expect(persisted.deletedDocument?.reason).toBe('Removido pelo smoke E2E');
  expect(persisted.auditActions).toContain('document.updated');
  expect(persisted.auditActions).toContain('document.deleted');
});

test('inspeção local persiste ao reabrir a aplicação em nova página', async ({ page, context }) => {
  await seedInspection(page);
  const reopenedPage = await context.newPage();

  try {
    await reopenedPage.goto(page.url(), { waitUntil: 'domcontentloaded' });
    await assertSeededInspection(reopenedPage);
  } finally {
    await reopenedPage.close();
  }
});

test('inspeção local continua disponível após reabrir o PWA offline', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright oferece suporte a Service Worker somente em navegadores Chromium.');

  await seedInspection(page);
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker indisponível no navegador de teste.');
    await navigator.serviceWorker.ready;
  });

  const offlineUrl = page.url();
  await context.setOffline(true);
  const offlinePage = await context.newPage();

  try {
    await offlinePage.goto(offlineUrl, { waitUntil: 'domcontentloaded' });
    await assertSeededInspection(offlinePage);
  } finally {
    await context.setOffline(false);
    await offlinePage.close().catch(() => {});
  }
});