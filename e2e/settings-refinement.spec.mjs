import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 768, height: 800 },
  { width: 1366, height: 768 }
];

test('Dados e backup fica compacto e sem controles disfuncionais', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/?e2e-auth-bypass=1');
    await page.locator('[data-nav="settings"]:visible').first().click();

    const grid = page.locator('.settings-grid');
    await expect(grid).toHaveAttribute('data-refined-settings', '1');
    await expect(page.getByRole('heading', { name: 'Instalação PWA' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Importante' })).toHaveCount(0);

    const backup = page.locator('.settings-backup-card');
    await expect(backup).toBeVisible();
    await expect(backup.getByRole('button', { name: 'Gerar backup' })).toBeVisible();
    await expect(backup.getByRole('button', { name: 'Restaurar backup' })).toBeVisible();

    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth
    }));
    expect(metrics.html).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);
  }
});

test('controle Ativo e acesso Administrador não criam overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?e2e-auth-bypass=1');
  await page.locator('[data-nav="settings"]:visible').first().click();

  await page.evaluate(() => {
    const grid = document.querySelector('.settings-grid');
    if (!grid) throw new Error('settings-grid ausente');
    const card = document.createElement('section');
    card.className = 'card settings-user-admin';
    card.innerHTML = `
      <div class="user-admin-members">
        <article class="user-admin-member">
          <div class="user-admin-member-copy"><strong>Administrador com nome muito extenso para regressão</strong><span>administrador-muito-longo@empresa-exemplo.com.br</span><small>Conta confirmada · Ativo</small></div>
          <div class="user-admin-member-controls">
            <span class="admin-role-badge">Administrador</span>
            <label class="user-admin-active"><input type="checkbox" checked><span>Ativo</span></label>
            <button class="btn" type="button">Salvar</button>
          </div>
        </article>
      </div>`;
    grid.append(card);
  });

  const active = page.locator('.user-admin-active');
  await expect(active).toBeVisible();
  await expect(active).toContainText('Ativo');
  const checkbox = active.locator('input[type="checkbox"]');
  await expect(checkbox).toHaveCSS('width', '20px');
  await expect(checkbox).toHaveCSS('height', '20px');

  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    active: document.querySelector('.user-admin-active')?.getBoundingClientRect().toJSON()
  }));
  expect(metrics.html).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.active.right).toBeLessThanOrEqual(metrics.viewport + 1);
});
