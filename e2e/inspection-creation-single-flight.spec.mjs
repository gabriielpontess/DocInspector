import { test, expect } from '@playwright/test';

test('criação de inspeção rejeita abertura e submissão duplicadas', async ({ page }) => {
  await page.goto('/?e2e-auth-bypass=1');
  await expect(page.locator('.topbar h1')).toHaveText('Início');

  await page.evaluate(() => {
    const button = document.querySelector('#new-inspection-hero');
    if (!button) throw new Error('Botão Nova inspeção não encontrado.');
    const click = () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    click();
    click();
  });

  const dialog = page.getByRole('dialog', { name: 'Nova inspeção' });
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toBeVisible();

  await page.evaluate(() => {
    const button = document.querySelector('#read-file');
    if (!button) throw new Error('Botão Continuar não encontrado.');
    const click = () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    click();
    click();
  });

  await expect(page.locator('.toast').filter({ hasText: 'Selecione uma planilha.' })).toHaveCount(1);

  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);

  await page.locator('#new-inspection-hero').click();
  await expect(page.getByRole('dialog', { name: 'Nova inspeção' })).toHaveCount(1);
});
