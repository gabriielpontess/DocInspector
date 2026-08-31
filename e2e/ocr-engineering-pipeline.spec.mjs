import { test, expect } from '@playwright/test';

test('engineering OCR keeps exact-character safety and uses dedicated fallbacks', async ({ page }) => {
  await page.goto('/?e2e-auth-bypass=1');

  const result = await page.evaluate(async () => {
    const calls = [];
    const texts = [
      'quadro sem código',
      'texto parcial',
      'observações gerais',
      'sem identificação',
      'CODIGO: DE 17 02 02 00 6P5 1302',
      'REV: C'
    ];
    globalThis.Tesseract = {
      async createWorker() {
        let index = 0;
        return {
          async setParameters(parameters) { calls.push({ type: 'params', parameters }); },
          async recognize(canvas) {
            calls.push({ type: 'recognize', width: canvas.width, height: canvas.height });
            const text = texts[index] || '';
            index += 1;
            return { data: { text, confidence: 88 } };
          },
          async terminate() { calls.push({ type: 'terminate' }); }
        };
      }
    };

    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111';
    context.font = '24px sans-serif';
    context.fillText('synthetic drawing', 800, 700);

    const { recognizeEngineeringDrawing } = await import('/js/vision.js');
    const documents = [
      { id: 'target', code: 'DE-17.02.02.00/6P5-1302' },
      { id: 'near-miss', code: 'DE-17.02.12.00/6P5-1302' }
    ];
    const ocr = await recognizeEngineeringDrawing(canvas, documents);
    return {
      exact: ocr.analysis.exact,
      matchedId: ocr.analysis.document?.id || null,
      detectedCode: ocr.analysis.detectedCode,
      revision: ocr.revision,
      regions: ocr.regions.map(item => item.region),
      recognizeCalls: calls.filter(item => item.type === 'recognize').length,
      dedicatedWhitelistUsed: calls.some(item => item.type === 'params' && String(item.parameters?.tessedit_char_whitelist || '').includes('0123456789')),
      terminated: calls.some(item => item.type === 'terminate')
    };
  });

  expect(result.exact).toBe(true);
  expect(result.matchedId).toBe('target');
  expect(result.detectedCode.replace(/[^A-Z0-9]/gi, '')).toBe('DE170202006P51302');
  expect(result.revision).toBe('C');
  expect(result.regions).toContain('codigo-dedicado');
  expect(result.regions).toContain('revisao-dedicada');
  expect(result.recognizeCalls).toBe(6);
  expect(result.dedicatedWhitelistUsed).toBe(true);
  expect(result.terminated).toBe(true);
});

test('OCR does not repair a wrong alphanumeric character to fit the list', async ({ page }) => {
  await page.goto('/?e2e-auth-bypass=1');
  const result = await page.evaluate(async () => {
    const { analyzeDocumentFromText } = await import('/js/vision.js');
    return analyzeDocumentFromText(
      'CODIGO: DE 17 O2 02 00 6P5 1302',
      [{ id: 'target', code: 'DE-17.02.02.00/6P5-1302' }]
    );
  });
  expect(result.exact).toBe(false);
  expect(result.document).toBeNull();
});
