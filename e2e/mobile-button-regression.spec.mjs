import { test, expect } from '@playwright/test';

async function seedDocument(page) {
  await page.goto('/?e2e-auth-bypass=1');
  await expect(page.locator('.topbar h1')).toHaveText('Início');
  await page.evaluate(async () => {
    const [{ createInspection, makeDocument }, { replaceAllInspections }] = await Promise.all([
      import('/js/domain.js'),
      import('/js/db.js')
    ]);
    const inspection = createInspection({
      name: 'Auditoria visual mobile',
      project: 'Auditoria visual mobile',
      system: 'AMV',
      responsible: 'Playwright',
      location: 'Campo'
    });
    inspection.documents = [makeDocument({
      code: 'PW-BTN-MOBILE-001',
      description: 'Documento para validar identidade, dimensão e separação das ações em todos os breakpoints.',
      status: 'APROVADO',
      expectedRevision: 'A'
    })];
    await replaceAllInspections([inspection]);
  });
  await page.reload();
  const card = page.locator('.inspection-item').filter({ hasText: 'Auditoria visual mobile' }).first();
  await expect(card).toBeVisible();
  await card.locator('.inspection-summary').click();
  await expect(page.locator('.topbar h1')).toContainText('Documentos');
}

async function assertNoPairOverlap(locators) {
  const boxes = [];
  for (const locator of locators) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    boxes.push(box);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(Math.min(overlapX, overlapY), `controles ${i}/${j} não podem se sobrepor`).toBeLessThanOrEqual(0.5);
    }
  }
}

async function assertMobileDocumentActions(page, width) {
  const row = page.locator('tr[data-doc-row]').filter({ hasText: 'PW-BTN-MOBILE-001' }).first();
  const details = row.locator(':scope > .details-cell > [data-doc-details]');
  const edit = row.locator('[data-edit-document]');
  const remove = row.locator('[data-delete-document]');

  await expect(details).toBeVisible();
  await expect(edit).toBeVisible();
  await expect(remove).toBeVisible();

  for (const control of [details, edit, remove]) {
    const box = await control.boundingBox();
    expect(box.width, `${width}px: ação deve manter alvo de toque`).toBeGreaterThanOrEqual(43);
    expect(box.height, `${width}px: ação deve manter alvo de toque`).toBeGreaterThanOrEqual(43);
    expect(box.width, `${width}px: ação compacta não deve crescer indevidamente`).toBeLessThanOrEqual(46);
    expect(box.height, `${width}px: ação compacta não deve crescer indevidamente`).toBeLessThanOrEqual(46);
  }

  await assertNoPairOverlap([details, edit, remove]);

  const identities = await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr[data-doc-row]')].find(item => item.textContent.includes('PW-BTN-MOBILE-001'));
    const details = row.querySelector(':scope > .details-cell > [data-doc-details]');
    const edit = row.querySelector('[data-edit-document]');
    const remove = row.querySelector('[data-delete-document]');
    const pseudo = element => getComputedStyle(element, '::before').content;
    const iconRect = element => element.querySelector('.icon')?.getBoundingClientRect();
    return {
      detailsPseudo: pseudo(details),
      editPseudo: pseudo(edit),
      removePseudo: pseudo(remove),
      detailsText: details.textContent.trim(),
      editText: edit.textContent.trim(),
      removeText: remove.textContent.trim(),
      editIcon: iconRect(edit) ? { width: iconRect(edit).width, height: iconRect(edit).height } : null,
      removeIcon: iconRect(remove) ? { width: iconRect(remove).width, height: iconRect(remove).height } : null,
      rowRight: row.getBoundingClientRect().right,
      viewport: document.documentElement.clientWidth
    };
  });

  expect(identities.detailsPseudo).toContain('›');
  expect(['none', 'normal', '""']).toContain(identities.editPseudo);
  expect(['none', 'normal', '""']).toContain(identities.removePseudo);
  expect(identities.detailsText).toBe('Mais detalhes');
  expect(identities.editText).toContain('Editar');
  expect(identities.removeText).toContain('Excluir documento');
  expect(identities.editIcon?.width).toBeGreaterThanOrEqual(16);
  expect(identities.editIcon?.height).toBeGreaterThanOrEqual(16);
  expect(identities.removeIcon?.width).toBeGreaterThanOrEqual(16);
  expect(identities.removeIcon?.height).toBeGreaterThanOrEqual(16);
  expect(identities.rowRight).toBeLessThanOrEqual(identities.viewport + 1);
}

async function assertDesktopDocumentActions(page, width) {
  const row = page.locator('tr[data-doc-row]').filter({ hasText: 'PW-BTN-MOBILE-001' }).first();
  const details = row.locator(':scope > .details-cell > [data-doc-details]');
  const edit = row.locator('[data-edit-document]');
  const remove = row.locator('[data-delete-document]');
  await expect(details).toBeVisible();
  await expect(edit).toBeVisible();
  await expect(remove).toBeVisible();
  await expect(edit).toContainText('Editar');
  await expect(remove).toContainText('Excluir documento');
  const cell = row.locator('.details-cell');
  const cellBox = await cell.boundingBox();
  expect(cellBox.width, `${width}px: coluna desktop deve reservar espaço às ações`).toBeGreaterThanOrEqual(195);
  const editFont = Number.parseFloat(await edit.evaluate(element => getComputedStyle(element).fontSize));
  const deleteFont = Number.parseFloat(await remove.evaluate(element => getComputedStyle(element).fontSize));
  expect(editFont).toBeGreaterThanOrEqual(10);
  expect(deleteFont).toBeGreaterThanOrEqual(10);
}

async function assertDetailManagementActions(page, width) {
  const row = page.locator('tr[data-doc-row]').filter({ hasText: 'PW-BTN-MOBILE-001' }).first();
  await row.locator(':scope > .details-cell > [data-doc-details]').click();
  await expect(page.locator('.document-page')).toBeVisible();
  const wrapper = page.locator('.document-management-detail-actions');
  await expect(wrapper).toBeVisible();
  const edit = wrapper.locator('[data-edit-document]');
  const remove = wrapper.locator('[data-delete-document]');
  await expect(edit).toBeVisible();
  await expect(remove).toBeVisible();
  await expect(edit).toContainText('Editar');
  await expect(remove).toContainText('Excluir documento');

  const wrapperBox = await wrapper.boundingBox();
  for (const button of [edit, remove]) {
    const box = await button.boundingBox();
    expect(box.height, `${width}px: ação detalhada deve manter alvo de toque`).toBeGreaterThanOrEqual(43);
    if (width <= 767) expect(box.width).toBeGreaterThanOrEqual(wrapperBox.width - 2);
    const font = Number.parseFloat(await button.evaluate(element => getComputedStyle(element).fontSize));
    expect(font, `${width}px: rótulo detalhado deve permanecer legível`).toBeGreaterThanOrEqual(10);
  }
}

test('ações de Documentos preservam identidade, toque e layout em breakpoints críticos', async ({ page }) => {
  const viewports = [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 768, height: 800 },
    { width: 1024, height: 768 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await seedDocument(page);
    if (viewport.width <= 767) await assertMobileDocumentActions(page, viewport.width);
    else await assertDesktopDocumentActions(page, viewport.width);
    await assertDetailManagementActions(page, viewport.width);
  }
});
