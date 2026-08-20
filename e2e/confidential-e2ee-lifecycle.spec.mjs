import { test, expect } from '@playwright/test';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

async function installAuthenticatedContext(page, role = 'ADMIN') {
  await page.goto('/?e2e-auth-bypass=1');
  await page.evaluate(async ({ workspaceId, userId, role }) => {
    globalThis.supabase = {
      createClient() {
        return {
          auth: {
            getSession: async () => ({ data: { session: { user: { id: userId, email: 'e2e@example.invalid' } } }, error: null }),
            getUser: async () => ({ data: { user: { id: userId, email: 'e2e@example.invalid' } }, error: null }),
            signOut: async () => ({ error: null })
          },
          rpc: async name => {
            if (name !== 'docinspector_my_workspaces') return { data: null, error: { message: `Unexpected RPC ${name}` } };
            return {
              data: [{ workspace_id: workspaceId, workspace_name: 'E2E Workspace', role, member_active: true }],
              error: null
            };
          },
          from(table) {
            const chain = {
              select() { return chain; },
              eq() { return chain; },
              async maybeSingle() {
                if (table === 'docinspector_profiles') {
                  return { data: { user_id: userId, display_name: 'E2E User' }, error: null };
                }
                return { data: null, error: null };
              }
            };
            return chain;
          }
        };
      }
    };
    const [{ resetAuthClientForTests }, { resolveAuthContext }] = await Promise.all([
      import('/js/auth.js'),
      import('/js/auth-context.js')
    ]);
    resetAuthClientForTests();
    const resolved = await resolveAuthContext({ allowOffline: false });
    if (!resolved || resolved.workspaceId !== workspaceId || resolved.role !== role) {
      throw new Error('Failed to establish deterministic authenticated E2E context.');
    }
  }, { workspaceId: WORKSPACE_ID, userId: USER_ID, role });
}

async function seedKeyAndEnvelope(page) {
  return page.evaluate(async ({ workspaceId, userId }) => {
    const keyVersion = 1;
    const pair = await crypto.subtle.generateKey({
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    }, false, ['encrypt', 'decrypt']);

    const openDb = (name, version, upgrade) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => upgrade(request.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const txDone = tx => new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    const keyDb = await openDb('docinspector-confidential-keys-v1', 1, db => {
      if (!db.objectStoreNames.contains('member-private-keys')) db.createObjectStore('member-private-keys', { keyPath: 'id' });
    });
    try {
      const tx = keyDb.transaction('member-private-keys', 'readwrite');
      tx.objectStore('member-private-keys').put({
        id: `${workspaceId}:${userId}:${keyVersion}`,
        workspaceId,
        userId,
        keyVersion,
        privateKey: pair.privateKey,
        storedAt: new Date().toISOString()
      });
      await txDone(tx);
    } finally {
      keyDb.close();
    }

    const rawWorkspaceKey = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pair.publicKey, rawWorkspaceKey));
    const wrappedHex = `\\x${[...wrapped].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;

    const originalKey = await crypto.subtle.importKey('raw', rawWorkspaceKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = new Uint8Array(12);
    const probe = new TextEncoder().encode('docinspector-offline-wk-probe');
    const expected = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, originalKey, probe));
    const expectedBase64 = btoa(String.fromCharCode(...expected));

    const { cacheCurrentWorkspaceEnvelope } = await import('/js/confidential-offline-key.js');
    await cacheCurrentWorkspaceEnvelope({
      workspaceId,
      status: {
        workspaceKey: { status: 'ACTIVE', key_version: 1 },
        envelope: { member_key_version: keyVersion, wrapped_workspace_key: wrappedHex }
      }
    });

    rawWorkspaceKey.fill(0);
    wrapped.fill(0);
    return expectedBase64;
  }, { workspaceId: WORKSPACE_ID, userId: USER_ID });
}

test('WK cached as RSA envelope unlocks after browser goes offline', async ({ page, context }) => {
  await installAuthenticatedContext(page, 'ADMIN');
  const expectedBase64 = await seedKeyAndEnvelope(page);

  await context.setOffline(true);
  try {
    const result = await page.evaluate(async ({ workspaceId, expectedBase64 }) => {
      const { unlockCachedWorkspaceKey, hasCachedWorkspaceEnvelope } = await import('/js/confidential-offline-key.js');
      const hasEnvelope = await hasCachedWorkspaceEnvelope({ workspaceId, keyVersion: 1 });
      const unlocked = await unlockCachedWorkspaceKey({ workspaceId, keyVersion: 1 });
      const iv = new Uint8Array(12);
      const probe = new TextEncoder().encode('docinspector-offline-wk-probe');
      const actual = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, unlocked.key, probe));
      return {
        hasEnvelope,
        source: unlocked.source,
        keyVersion: unlocked.keyVersion,
        extractable: unlocked.key.extractable,
        matches: btoa(String.fromCharCode(...actual)) === expectedBase64
      };
    }, { workspaceId: WORKSPACE_ID, expectedBase64 });

    expect(result.hasEnvelope).toBe(true);
    expect(result.source).toBe('offline-envelope');
    expect(result.keyVersion).toBe(1);
    expect(result.extractable).toBe(false);
    expect(result.matches).toBe(true);
  } finally {
    await context.setOffline(false);
  }
});

test('explicit logout clears local MEK, WK envelopes and confidential ciphertext', async ({ page }) => {
  await installAuthenticatedContext(page, 'ADMIN');
  await seedKeyAndEnvelope(page);

  await page.evaluate(async () => {
    const openDb = (name, version, upgrade) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => upgrade(request.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const txDone = tx => new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    const db = await openDb('docinspector-confidential-vault-v1', 1, database => {
      if (!database.objectStoreNames.contains('ciphertext')) database.createObjectStore('ciphertext', { keyPath: 'cacheKey' });
    });
    try {
      const tx = db.transaction('ciphertext', 'readwrite');
      tx.objectStore('ciphertext').put({ cacheKey: 'logout-probe', marker: true });
      await txDone(tx);
    } finally {
      db.close();
    }

    await import('/js/permission-ui.js');
  });

  const signOut = page.locator('#auth-signout');
  await expect(signOut).toHaveCount(1);
  await Promise.all([
    page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
    page.evaluate(() => document.querySelector('#auth-signout')?.click())
  ]);
  await page.waitForLoadState('domcontentloaded');

  const counts = await page.evaluate(async () => {
    async function countStore(dbName, storeName) {
      return new Promise(resolve => {
        const request = indexedDB.open(dbName);
        request.onerror = () => resolve(-1);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve(0);
            return;
          }
          const tx = db.transaction(storeName, 'readonly');
          const count = tx.objectStore(storeName).count();
          count.onsuccess = () => { const value = count.result; db.close(); resolve(value); };
          count.onerror = () => { db.close(); resolve(-1); };
        };
      });
    }
    return {
      keys: await countStore('docinspector-confidential-keys-v1', 'member-private-keys'),
      envelopes: await countStore('docinspector-confidential-envelopes-v1', 'workspace-envelopes'),
      ciphertext: await countStore('docinspector-confidential-vault-v1', 'ciphertext')
    };
  });

  expect(counts).toEqual({ keys: 0, envelopes: 0, ciphertext: 0 });
});

test('SUPERVISOR authenticated runtime remains read-only in navigation', async ({ page }) => {
  await installAuthenticatedContext(page, 'SUPERVISOR');
  await page.evaluate(async () => { await import('/js/permission-ui.js'); });

  const settings = page.locator('[data-nav="settings"]');
  expect(await settings.evaluateAll(nodes => nodes.every(node => node.hidden && node.disabled))).toBe(true);
  await expect(page.locator('#auth-signout')).toHaveCount(1);
  await expect(page.locator('.auth-account-card strong')).toHaveText('Supervisor');
});
