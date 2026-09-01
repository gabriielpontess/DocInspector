import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

async function authVisualReport(page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        rect.width > 2 && rect.height > 2;
    };
    const describe = element => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        id: String(element.id || '').slice(0, 80),
        className: String(element.className || '').slice(0, 120),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        text: String(element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)
      };
    };
    const uniqueTops = rects => {
      const tops = [];
      rects.forEach(rect => {
        if (rect.width <= .5 || rect.height <= .5) return;
        const top = Math.round(rect.top * 2) / 2;
        if (!tops.some(value => Math.abs(value - top) <= 1)) tops.push(top);
      });
      return tops;
    };

    const elements = [...document.querySelectorAll('.auth-screen *')].filter(visible);
    const outsideViewport = elements.flatMap(element => {
      const rect = element.getBoundingClientRect();
      if (rect.left >= -1 && rect.right <= viewport + 1) return [];
      return [describe(element)];
    }).slice(0, 12);

    const fragmentedWords = [];
    [...document.querySelectorAll('.auth-screen button')].filter(visible).forEach(button => {
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const text = node.nodeValue || '';
        const pattern = /[\p{L}\p{N}]{4,}/gu;
        let match;
        while ((match = pattern.exec(text))) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const lines = uniqueTops([...range.getClientRects()]).length;
          if (lines > 1) {
            fragmentedWords.push({ ...describe(button), word: match[0], lines });
            break;
          }
        }
        node = walker.nextNode();
      }
    });

    return {
      viewport,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      outsideViewport,
      fragmentedWords: fragmentedWords.slice(0, 12)
    };
  });
}

async function expectAuthVisualHealth(page, label) {
  const report = await authVisualReport(page);
  expect(report.outsideViewport, `${label}: elementos de autenticação saíram da viewport ${JSON.stringify(report.outsideViewport)}`).toEqual([]);
  expect(report.fragmentedWords, `${label}: botão de autenticação fragmentou palavra ${JSON.stringify(report.fragmentedWords)}`).toEqual([]);
  expect(report.htmlScrollWidth, `${label}: documentElement criou overflow horizontal`).toBeLessThanOrEqual(report.viewport + 1);
  expect(report.bodyScrollWidth, `${label}: body criou overflow horizontal`).toBeLessThanOrEqual(report.viewport + 1);
}

test('login e solicitação de acesso permanecem legíveis em breakpoints críticos', async ({ page }) => {
  const viewports = [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 768, height: 800 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Entrar no DocInspector' })).toBeVisible();
    await expectAuthVisualHealth(page, `Login ${viewport.width}px`);

    await page.getByRole('button', { name: 'Solicitar cadastro' }).click();
    await expect(page.getByRole('heading', { name: 'Solicitar cadastro' })).toBeVisible();
    await expect(page.locator('#access-request-form')).toBeVisible();
    await page.locator('#access-request-name').fill(`Usuário ${'Muito Longo '.repeat(6)}`);
    await page.locator('#access-request-email').fill(`usuario-${'x'.repeat(80)}@example.com`);
    await page.locator('#access-request-message').fill(`Contexto ${'operacional extenso '.repeat(12)}`);
    await expectAuthVisualHealth(page, `Solicitar cadastro ${viewport.width}px`);

    await page.getByRole('button', { name: 'Voltar para entrar' }).click();
    await expect(page.getByRole('heading', { name: 'Entrar no DocInspector' })).toBeVisible();
  }
});
