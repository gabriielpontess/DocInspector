import { test, expect } from '@playwright/test';

async function openRequestForm(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar no DocInspector' })).toBeVisible();
  await page.getByRole('button', { name: 'Solicitar cadastro' }).click();
  await expect(page.getByRole('heading', { name: 'Solicitar cadastro' })).toBeVisible();
  await expect(page.locator('#access-request-form')).toBeVisible();
}

async function fillValidRequest(page, email = 'campo@example.com') {
  await page.locator('#access-request-name').fill('Usuário de Campo');
  await page.locator('#access-request-email').fill(email);
  await page.locator('#access-request-code').fill('A1B2C3D4E5F6');
  await page.locator('#access-request-message').fill('Equipe AMV');
}

test('solicitação de cadastro é separada do login e retorna confirmação segura', async ({ page }) => {
  let submitted = null;
  await page.route('**/functions/v1/docinspector-access-request', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });

  await openRequestForm(page);
  await fillValidRequest(page);
  await page.waitForTimeout(850);
  await page.getByRole('button', { name: 'Enviar solicitação' }).click();

  await expect(page.getByRole('heading', { name: 'Entrar no DocInspector' })).toBeVisible();
  await expect(page.locator('#auth-message')).toContainText('Solicitação enviada');
  expect(submitted).toMatchObject({
    email: 'campo@example.com',
    displayName: 'Usuário de Campo',
    requestCode: 'A1B2C3D4E5F6',
    message: 'Equipe AMV'
  });
  expect(submitted.elapsedMs).toBeGreaterThanOrEqual(800);
});

test('código inválido é barrado antes de qualquer chamada remota', async ({ page }) => {
  let calls = 0;
  await page.route('**/functions/v1/docinspector-access-request', async route => {
    calls += 1;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await openRequestForm(page);
  await page.locator('#access-request-name').fill('Usuário Teste');
  await page.locator('#access-request-email').fill('teste@example.com');
  await page.locator('#access-request-code').fill('ABC');
  await page.getByRole('button', { name: 'Enviar solicitação' }).click();

  await expect(page.locator('.auth-message')).toContainText('código de 12 caracteres');
  expect(calls).toBe(0);
});

test('falha real de rede usa mensagem controlada e preserva o formulário', async ({ page }) => {
  await page.route('**/functions/v1/docinspector-access-request', route => route.abort('failed'));

  await openRequestForm(page);
  await fillValidRequest(page, 'rede@example.com');
  await page.getByRole('button', { name: 'Enviar solicitação' }).click();

  await expect(page.locator('.auth-message')).toContainText('Não foi possível conectar ao serviço de solicitação');
  await expect(page.locator('#access-request-email')).toHaveValue('rede@example.com');
  await expect(page.locator('#access-request-code')).toHaveValue('A1B2C3D4E5F6');
});

test('modo offline bloqueia envio sem chamar o endpoint', async ({ page, context }) => {
  let calls = 0;
  await page.route('**/functions/v1/docinspector-access-request', async route => {
    calls += 1;
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await openRequestForm(page);
  await fillValidRequest(page, 'offline@example.com');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Enviar solicitação' }).click();

  await expect(page.locator('.auth-message')).toContainText('Conecte-se à internet para solicitar acesso');
  expect(calls).toBe(0);
  await context.setOffline(false);
});

test('fluxo de solicitação continua utilizável em viewport mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRequestForm(page);
  await expect(page.locator('#access-request-name')).toBeVisible();
  await expect(page.locator('#access-request-submit')).toBeVisible();
  await page.getByRole('button', { name: 'Voltar para entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar no DocInspector' })).toBeVisible();
});
