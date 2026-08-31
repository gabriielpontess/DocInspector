import { test, expect } from '@playwright/test';

test('new confidential PDF upload stays retired even when legacy controls are rendered later', async ({ page }) => {
  await page.goto('/?e2e-auth-bypass=1');

  await page.evaluate(() => {
    globalThis.__pdfUploadLegacyEvents = 0;
    const actions = document.createElement('div');
    actions.id = 'confidential-documents-actions';
    actions.innerHTML = '<button id="confidential-upload" type="button">Enviar PDF confidencial</button><input id="confidential-upload-input" type="file">';
    const button = actions.querySelector('#confidential-upload');
    const input = actions.querySelector('#confidential-upload-input');
    button.addEventListener('click', () => { globalThis.__pdfUploadLegacyEvents += 1; });
    input.addEventListener('change', () => { globalThis.__pdfUploadLegacyEvents += 1; });
    document.body.append(actions);
  });

  const button = page.locator('#confidential-upload');
  const input = page.locator('#confidential-upload-input');
  await expect(button).toBeHidden();
  await expect(button).toBeDisabled();
  await expect(input).toBeDisabled();
  await expect(page.locator('[data-pdf-upload-retired]')).toContainText('Novos uploads de PDF foram descontinuados');

  const result = await page.evaluate(() => {
    const button = document.querySelector('#confidential-upload');
    const input = document.querySelector('#confidential-upload-input');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    return globalThis.__pdfUploadLegacyEvents;
  });
  expect(result).toBe(0);
});
