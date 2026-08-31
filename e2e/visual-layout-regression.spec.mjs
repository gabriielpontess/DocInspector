import { test, expect } from '@playwright/test';

const LONG_TOKEN = 'PW-EXTREMAMENTE-LONGO-SEM-ESPACOS-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789-REVISAO-CRITICA';
const LONG_TEXT = 'Descrição operacional propositalmente extensa para validar quebra de linha, crescimento vertical dos cards e legibilidade em telas estreitas. '.repeat(4);
const NAV_VIEW = Object.freeze({
  'Início': 'home',
  'Verificar': 'inspect',
  'Documentos': 'docs',
  'Dados': 'settings',
  'Dados e backup': 'settings'
});

test.setTimeout(120_000);

async function seedStressInspection(page) {
  await page.goto('/?e2e-auth-bypass=1');
  await expect(page.locator('.topbar h1')).toHaveText('Início');
  await page.evaluate(async ({ code, text }) => {
    const [{ createInspection, makeDocument, addFieldCopy }, { replaceAllInspections }] = await Promise.all([
      import('/js/domain.js'), import('/js/db.js')
    ]);
    const inspection = createInspection({
      name: `Lista ${text}`,
      project: `Projeto-${'X'.repeat(100)}`,
      system: `SISTEMA-${'Y'.repeat(80)}`,
      responsible: `Responsável ${text}`,
      location: `Local-${'Z'.repeat(90)}`
    });
    const document = makeDocument({
      code,
      description: text,
      status: `STATUS-${'Q'.repeat(70)}`,
      expectedRevision: `REV-${'R'.repeat(60)}`
    });
    document.id = 'visual-stress-document';
    addFieldCopy(document, {
      id: 'visual-stress-copy',
      foundRevision: `CAMPO-${'C'.repeat(60)}`,
      markings: ['Vermelho'],
      comment: `${text}TOKEN-${'N'.repeat(120)}`
    });
    inspection.documents = [document];
    await replaceAllInspections([inspection]);
  }, { code: LONG_TOKEN, text: LONG_TEXT });
  await page.reload();
  await expect(page.locator('.inspection-item')).toHaveCount(1);
}

async function visualOverflowReport(page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const intentionalHorizontalScroller = element => {
      const scroller = element.closest('.home-summary, .compact-doc-table, .sync-setup-tabs');
      return scroller && scroller !== element;
    };
    const offenders = [...document.querySelectorAll('body *')].flatMap(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
      if (!rect.width || !rect.height || (rect.width <= 2 && rect.height <= 2)) return [];
      if (intentionalHorizontalScroller(element)) return [];
      if (rect.right <= viewport + 1 && rect.left >= -1) return [];
      return [{
        tag: element.tagName.toLowerCase(),
        className: String(element.className || '').slice(0, 120),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        text: String(element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80)
      }];
    }).slice(0, 12);
    return {
      viewport,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders
    };
  });
}

async function expectContained(page, label) {
  const report = await visualOverflowReport(page);
  expect(report.offenders, `${label}: elementos fora da viewport ${JSON.stringify(report.offenders)}`).toEqual([]);
  expect(report.htmlScrollWidth, `${label}: documentElement criou overflow horizontal`).toBeLessThanOrEqual(report.viewport + 1);
  expect(report.bodyScrollWidth, `${label}: body criou overflow horizontal`).toBeLessThanOrEqual(report.viewport + 1);
}

async function closeDialog(dialog) {
  const close = dialog.getByRole('button', { name: 'Fechar' });
  if (await close.count()) await close.click();
  else await dialog.getByRole('button', { name: 'Cancelar' }).first().click();
  await expect(dialog).toHaveCount(0);
}

async function openInspectionActions(page) {
  const card = page.locator('.inspection-item').first();
  await card.locator('button.inspection-more-button').click();
  const sheet = page.getByRole('dialog', { name: 'Ações da inspeção' });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function clickVisibleNav(page, label) {
  const view = NAV_VIEW[label];
  expect(view, `Navegação sem contrato para ${label}`).toBeTruthy();
  const button = page.locator(`[data-nav="${view}"]:visible`).first();
  await expect(button).toBeVisible();
  await button.click();
}

test('layout global contém textos extremos sem clipping ou overflow em breakpoints críticos', async ({ page }) => {
  const viewports = [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 768, height: 800 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await seedStressInspection(page);
    await expectContained(page, `Início ${viewport.width}px`);

    await page.locator('.inspection-item .inspection-primary-action').click();
    await expect(page.locator('.topbar h1')).toContainText('Documentos');
    await expectContained(page, `Documentos ${viewport.width}px`);

    const code = page.locator('.compact-doc-table .code-cell strong').first();
    await expect(code).toContainText(LONG_TOKEN);
    const codeStyle = await code.evaluate(element => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      textOverflow: getComputedStyle(element).textOverflow
    }));
    expect(codeStyle.whiteSpace).not.toBe('nowrap');
    expect(codeStyle.textOverflow).not.toBe('ellipsis');

    await clickVisibleNav(page, 'Verificar');
    await expect(page.locator('.global-verify-layout')).toBeVisible();
    await expectContained(page, `Verificar ${viewport.width}px`);

    const search = page.locator('#pw-search');
    await search.fill(LONG_TOKEN);
    const suggestion = page.locator('.search-suggestion').first();
    await expect(suggestion).toBeVisible();
    await expect(suggestion.locator('.search-suggestion-code')).toContainText(LONG_TOKEN);
    await expectContained(page, `Sugestões ${viewport.width}px`);
    const suggestionList = page.locator('.search-suggestion-list');
    const suggestionOverflow = await suggestionList.evaluate(element => ({
      x: getComputedStyle(element).overflowX,
      y: getComputedStyle(element).overflowY
    }));
    expect(suggestionOverflow.x).toBe('hidden');
    expect(['auto', 'scroll']).toContain(suggestionOverflow.y);
    await search.fill('');

    const trackerButton = page.locator('[data-engineering-launcher]:visible').first();
    await trackerButton.click();
    const tracker = page.getByRole('dialog', { name: 'Acompanhamento de Engenharia' });
    await expect(tracker).toBeVisible();
    await expectContained(page, `Engenharia ${viewport.width}px`);
    await tracker.locator('[data-close-engineering]').click();
    await expect(tracker).toHaveCount(0);

    await clickVisibleNav(page, 'Início');
    await expect(page.locator('.topbar h1')).toHaveText('Início');

    const sheet = await openInspectionActions(page);
    await expectContained(page, `Ações ${viewport.width}px`);
    await sheet.getByRole('menuitem', { name: 'Exportar' }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Exportar relatório da inspeção' });
    await expect(exportDialog).toBeVisible();
    await expectContained(page, `Exportar ${viewport.width}px`);
    const overflow = await exportDialog.evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      y: getComputedStyle(element).overflowY
    }));
    expect(overflow.scrollWidth, `Exportar ${viewport.width}px: modal criou overflow horizontal interno`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(['auto', 'scroll']).toContain(overflow.y);
    await closeDialog(exportDialog);
  }
});
