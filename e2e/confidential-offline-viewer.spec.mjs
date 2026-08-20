import { test, expect } from '@playwright/test';

const PDF_BASE64 = 'JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCAyMDAgMjAwIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODIwMTg0NDUwKzAwJzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODIwMTg0NDUwKzAwJzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxMDkKPj4Kc3RyZWFtCkdhcFFoMEU9RiwwVVxIM1RccE5ZVF5RS2s/dGM+SVAsO1cjVTFeMjNpaFBFTV8/Q1c0S0lTaFwmZEFPSStoN3B1MCk8VlxILFRyZGFYLWFPJEVjayRZKm9cQD1VSDxVKzw6ZW8hL2kqOmFvfj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMDkyIDAwMDAwIG4gCjAwMDAwMDAxOTkgMDAwMDAgbiAKMDAwMDAwMDM5MiAwMDAwMCBuIAowMDAwMDAwNDYwIDAwMDAwIG4gCjAwMDAwMDA3MjEgMDAwMDAgbiAKMDAwMDAwMDc4MCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzwxMzBhZmNjZmE1MmEzOTA0YzlkNDdlODFlYjMzNTg5ZD48MTMwYWZjY2ZhNTJhMzkwNGM5ZDQ3ZTgxZWIzMzU4OWQ+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDUgMCBSCi9Sb290IDQgMCBSCi9TaXplIDgKPj4Kc3RhcnR4cmVmCjk3OQolJUVPRgo=';

test('confidential ciphertext stays in IndexedDB and PDF.js renders from self-hosted assets', async ({ page }) => {
  await page.goto('/?e2e-auth-bypass=1');

  const result = await page.evaluate(async pdfBase64 => {
    const offline = await import('/js/confidential-offline.js');
    const viewerModule = await import('/js/confidential-viewer.js');

    await offline.clearAllConfidentialCiphertext();

    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const inspectionId = '22222222-2222-4222-8222-222222222222';
    const fileId = '33333333-3333-4333-8333-333333333333';

    const encoder = new TextEncoder();
    const ciphertext = new Uint8Array(32).fill(9);
    const header = encoder.encode(JSON.stringify({
      version: 'DIPDF1',
      chunks: [{ iv: 'AAAAAAAAAAAAAAAA', length: ciphertext.byteLength }]
    }));
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, header.byteLength, false);
    const magic = encoder.encode('DIPDF1\n');
    const container = new Uint8Array(magic.byteLength + length.byteLength + header.byteLength + ciphertext.byteLength);
    let offset = 0;
    for (const part of [magic, length, header, ciphertext]) {
      container.set(part, offset);
      offset += part.byteLength;
    }

    const docRow = {
      id: fileId,
      workspace_id: workspaceId,
      inspection_id: inspectionId,
      object_path: `${workspaceId}/${inspectionId}/${fileId}.dipdf`,
      crypto_version: 'DIPDF1',
      workspace_key_version: 1,
      wrapped_file_key: '\\x' + 'aa'.repeat(48),
      metadata_ciphertext: '\\x' + 'bb'.repeat(48),
      metadata_iv: '\\x' + 'cc'.repeat(12),
      plaintext_size: 1200,
      ciphertext_size: container.byteLength,
      chunk_count: 1,
      ciphertext_sha256: 'd'.repeat(64),
      status: 'ACTIVE'
    };

    await offline.cacheConfidentialCiphertext({ document: docRow, container });
    const cached = await offline.getCachedConfidentialCiphertext({ workspaceId, inspectionId, fileId });

    const cacheUrls = [];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) cacheUrls.push(request.url);
    }

    const binary = atob(pdfBase64);
    const pdfBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) pdfBytes[i] = binary.charCodeAt(i);

    const viewer = await viewerModule.createConfidentialPdfViewer({ plaintext: pdfBytes });
    const canvas = document.createElement('canvas');
    const rendered = await viewer.renderPage({ pageNumber: 1, canvas, scale: 1 });
    const info = {
      cachedMatches: cached?.container?.byteLength === container.byteLength,
      cachedMagic: new TextDecoder().decode(cached.container.subarray(0, 7)),
      cacheStorageHasDipdf: cacheUrls.some(url => url.toLowerCase().includes('.dipdf')),
      pdfjsVersion: viewerModule.PDFJS_VERSION,
      moduleLocal: viewerModule.PDFJS_MODULE_URL.startsWith(location.origin + '/vendor/pdfjs/'),
      workerLocal: viewerModule.PDFJS_WORKER_URL.startsWith(location.origin + '/vendor/pdfjs/'),
      pages: viewer.numPages,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      renderedWidth: rendered.width,
      renderedHeight: rendered.height
    };
    await viewer.destroy();
    pdfBytes.fill(0);
    await offline.clearAllConfidentialCiphertext();
    return info;
  }, PDF_BASE64);

  expect(result.cachedMatches).toBe(true);
  expect(result.cachedMagic).toBe('DIPDF1\n');
  expect(result.cacheStorageHasDipdf).toBe(false);
  expect(result.pdfjsVersion).toBe('6.2.108');
  expect(result.moduleLocal).toBe(true);
  expect(result.workerLocal).toBe(true);
  expect(result.pages).toBe(1);
  expect(result.canvasWidth).toBeGreaterThan(0);
  expect(result.canvasHeight).toBeGreaterThan(0);
  expect(result.renderedWidth).toBeGreaterThan(0);
  expect(result.renderedHeight).toBeGreaterThan(0);
});

test('service worker app shell exposes pinned PDF.js assets', async ({ page }) => {
  const [moduleResponse, workerResponse] = await Promise.all([
    page.request.get('/vendor/pdfjs/pdf.min.mjs'),
    page.request.get('/vendor/pdfjs/pdf.worker.min.mjs')
  ]);
  expect(moduleResponse.ok()).toBe(true);
  expect(workerResponse.ok()).toBe(true);
  expect((await moduleResponse.text()).length).toBeGreaterThan(100000);
  expect((await workerResponse.text()).length).toBeGreaterThan(100000);
});
