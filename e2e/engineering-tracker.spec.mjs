import { test, expect } from '@playwright/test';

async function today(page) {
  return page.evaluate(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
}

async function seedEngineeringInspection(page) {
  await page.goto('/?e2e-auth-bypass=1');
  await expect(page.locator('.topbar h1')).toHaveText('Início');

  await page.evaluate(async () => {
    const [{ createInspection, makeDocument, addFieldCopy }, { saveInspection }] = await Promise.all([
      import('/js/domain.js'),
      import('/js/db.js')
    ]);

    const inspection = createInspection({
      name: 'E2E Engenharia',
      project: 'Linha 17',
      system: 'PSD',
      responsible: 'Teste automatizado',
      location: 'Campo'
    });

    const red = makeDocument({
      code: 'PW-ENG-RED',
      description: 'Documento vermelho para acompanhamento',
      status: 'Emitido',
      expectedRevision: 'A'
    });
    red.id = 'engineering-red';
    addFieldCopy(red, {
      id: 'engineering-red-copy',
      foundRevision: 'A',
      markings: ['Vermelho'],
      comment: 'Marcação crítica'
    });

    const yellow = makeDocument({
      code: 'PW-ENG-YELLOW',
      description: 'Documento amarelo para acompanhamento',
      status: 'Emitido',
      expectedRevision: 'A'
    });
    yellow.id = 'engineering-yellow';
    addFieldCopy(yellow, {
      id: 'engineering-yellow-copy',
      foundRevision: 'A',
      markings: ['Amarelo']
    });

    const plain = makeDocument({
      code: 'PW-ENG-PLAIN',
      description: 'Documento sem marcação crítica',
      status: 'Emitido',
      expectedRevision: 'A'
    });
    plain.id = 'engineering-plain';
    addFieldCopy(plain, {
      id: 'engineering-plain-copy',
      foundRevision: 'A'
    });

    inspection.documents = [red, yellow, plain];
    await saveInspection(inspection);
  });

  await page.reload();
  await expect(page.locator('.topbar h1')).toHaveText('Início');
  await expect(page.locator('[data-engineering-launcher]:visible').first()).toBeVisible();
}

async function openTracker(page) {
  await page.locator('[data-engineering-launcher]:visible').first().click();
  const dialog = page.getByRole('dialog', { name: 'Acompanhamento de Engenharia' });
  await expect(dialog).toBeVisible();
  return dialog;
}

function rowFor(dialog, code) {
  return dialog.locator('[data-engineering-row]').filter({ hasText: code }).first();
}

test('acompanha Amarelo/Vermelho, persiste auditoria e atualiza indicadores sem reabrir', async ({ page }) => {
  await seedEngineeringInspection(page);
  const date = await today(page);
  let dialog = await openTracker(page);

  await expect(dialog.locator('[data-engineering-row]')).toHaveCount(2);
  await expect(dialog.getByText('PW-ENG-PLAIN')).toHaveCount(0);
  await expect(dialog.locator('[data-engineering-summary-red]')).toHaveText('1');
  await expect(dialog.locator('[data-engineering-summary-yellow]')).toHaveText('1');
  await expect(dialog.locator('[data-engineering-summary-awaiting]')).toHaveText('0');

  await dialog.locator('[data-engineering-search]').fill('YELLOW');
  await expect(dialog.locator('[data-engineering-visible-count]')).toHaveText('1 documento(s) exibido(s)');
  await dialog.locator('[data-engineering-search]').fill('');
  await expect(dialog.locator('[data-engineering-visible-count]')).toHaveText('2 documento(s) exibido(s)');

  const red = rowFor(dialog, 'PW-ENG-RED');
  await red.locator('.engineering-audit').evaluate(element => { element.open = true; });
  await red.locator('[data-engineering-sent]').fill(date);
  await red.locator('[data-engineering-note]').fill('Enviado para análise estrutural');
  await red.locator('[data-save-engineering]').click();

  await expect(page.getByText('Acompanhamento de Engenharia salvo no histórico.')).toBeVisible();
  await expect(red.locator('[data-engineering-status-copy]')).toContainText('Na Engenharia · 0 dia(s) sem retorno');
  await expect(dialog.locator('[data-engineering-summary-awaiting]')).toHaveText('1');
  await expect(dialog.locator('[data-engineering-summary-oldest]')).toHaveText('0 d');
  await expect(red.locator('.engineering-audit')).toHaveAttribute('open', '');
  await expect(red.locator('.engineering-audit-list')).toContainText('Enviado para análise estrutural');

  const yellow = rowFor(dialog, 'PW-ENG-YELLOW');
  await yellow.locator('[data-engineering-returned]').fill(date);
  await yellow.locator('[data-save-engineering]').click();
  await expect(page.getByRole('alert')).toContainText('Informe a data de envio antes da data de retorno.');
  await expect(dialog.locator('[data-engineering-summary-awaiting]')).toHaveText('1');
  await expect(yellow.locator('[data-engineering-status-copy]')).toHaveText('Ainda não enviado à Engenharia');

  const persistedFirstSave = await page.evaluate(async () => {
    const { listInspections } = await import('/js/db.js');
    const inspection = (await listInspections()).find(item => item.name === 'E2E Engenharia');
    const events = inspection?.documentAudit.filter(event => event.action === 'document.engineering.updated') || [];
    return events.map(event => ({ documentId: event.documentId, changes: event.changes }));
  });
  expect(persistedFirstSave).toHaveLength(1);
  expect(persistedFirstSave[0].documentId).toBe('engineering-red');
  expect(persistedFirstSave[0].changes.note).toBe('Enviado para análise estrutural');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  dialog = await openTracker(page);
  const reopenedRed = rowFor(dialog, 'PW-ENG-RED');
  await expect(reopenedRed.locator('[data-engineering-sent]')).toHaveValue(date);
  await expect(reopenedRed.locator('[data-engineering-note]')).toHaveValue('Enviado para análise estrutural');
  await expect(reopenedRed.locator('.engineering-audit-list')).toContainText('Enviado para análise estrutural');

  await reopenedRed.locator('[data-engineering-returned]').fill(date);
  await reopenedRed.locator('[data-engineering-note]').fill('Retornado pela Engenharia');
  await reopenedRed.locator('[data-save-engineering]').click();
  await expect(reopenedRed.locator('[data-engineering-status-copy]')).toContainText('Retornado · 0 dia(s) no fluxo');
  await expect(dialog.locator('[data-engineering-summary-awaiting]')).toHaveText('0');
  await reopenedRed.locator('.engineering-audit').evaluate(element => { element.open = true; });
  await expect(reopenedRed.locator('.engineering-audit-list li')).toHaveCount(2);
  await expect(reopenedRed.locator('.engineering-audit-list')).toContainText('Retornado pela Engenharia');
});

test('painel e quinto item da navegação não criam overflow em 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await seedEngineeringInspection(page);

  const navLayout = await page.locator('.mobile-nav').evaluate(nav => {
    const bounds = nav.getBoundingClientRect();
    const buttons = [...nav.querySelectorAll('button')].map(button => button.getBoundingClientRect());
    return {
      width: bounds.width,
      scrollWidth: nav.scrollWidth,
      buttonsInside: buttons.every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1)
    };
  });
  expect(navLayout.scrollWidth).toBeLessThanOrEqual(navLayout.width + 1);
  expect(navLayout.buttonsInside).toBe(true);

  const dialog = await openTracker(page);
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.engineering-tracker-modal');
    const backdrop = panel?.closest('.modal-backdrop');
    if (!panel || !backdrop) return null;
    const panelRect = panel.getBoundingClientRect();
    const backdropRect = backdrop.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      backdropLeft: backdropRect.left,
      backdropRight: backdropRect.right
    };
  });

  expect(layout).not.toBeNull();
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.panelScrollWidth).toBeLessThanOrEqual(layout.panelClientWidth + 1);
  expect(layout.panelLeft).toBeGreaterThanOrEqual(0);
  expect(layout.panelRight).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.backdropLeft).toBeLessThanOrEqual(1);
  expect(layout.backdropRight).toBeGreaterThanOrEqual(layout.viewport - 1);
  await expect(dialog.locator('.engineering-fields').first()).toBeVisible();
});

test('acompanhamento salvo continua disponível ao reabrir o PWA offline', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright oferece suporte a Service Worker somente em navegadores Chromium.');

  await seedEngineeringInspection(page);
  const date = await today(page);
  const dialog = await openTracker(page);
  const red = rowFor(dialog, 'PW-ENG-RED');
  await red.locator('[data-engineering-sent]').fill(date);
  await red.locator('[data-engineering-note]').fill('Aguardando retorno offline');
  await red.locator('[data-save-engineering]').click();
  await expect(red.locator('[data-engineering-status-copy]')).toContainText('Na Engenharia');
  await page.keyboard.press('Escape');

  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker indisponível no navegador de teste.');
    await navigator.serviceWorker.ready;
  });

  const offlineUrl = page.url();
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  try {
    await offlinePage.goto(offlineUrl, { waitUntil: 'domcontentloaded' });
    await expect(offlinePage.locator('.topbar h1')).toHaveText('Início');
    const offlineDialog = await openTracker(offlinePage);
    const offlineRed = rowFor(offlineDialog, 'PW-ENG-RED');
    await expect(offlineRed.locator('[data-engineering-sent]')).toHaveValue(date);
    await expect(offlineRed.locator('[data-engineering-note]')).toHaveValue('Aguardando retorno offline');
    await expect(offlineRed.locator('[data-engineering-status-copy]')).toContainText('Na Engenharia');
  } finally {
    await context.setOffline(false);
    await offlinePage.close().catch(() => {});
  }
});
