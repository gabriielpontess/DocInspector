import { test, expect } from '@playwright/test';

const LONG_NAME = `Administrador ${'NOME '.repeat(18)}FINAL`;
const LONG_EMAIL = `usuario-${'segmento'.repeat(10)}@empresa-exemplo-muito-longa.com.br`;
const LONG_WORKSPACE = `Workspace ${'SKYRAIL-'.repeat(15)}OPERACIONAL`;
const LONG_MESSAGE = 'Solicitação administrativa com contexto operacional extenso para validar crescimento vertical, quebra de dados e preservação dos controles. '.repeat(5);

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 768, height: 800 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 }
];

test.setTimeout(120_000);

async function mountAdministrativeFixture(page) {
  await page.goto('/?e2e-auth-bypass=1');
  await expect(page.locator('.topbar h1')).toHaveText('Início');
  const settings = page.locator('[data-nav="settings"]:visible').first();
  await expect(settings).toBeVisible();
  await settings.click();
  await expect(page.locator('.settings-grid')).toBeVisible();

  await page.evaluate(({ name, email, workspace, message }) => {
    document.querySelector('#settings-user-admin')?.remove();
    document.querySelector('.auth-account-card')?.remove();
    document.querySelector('#auth-password-dialog')?.remove();

    const grid = document.querySelector('.settings-grid');
    if (!grid) throw new Error('settings-grid indisponível para fixture administrativa');

    const admin = document.createElement('section');
    admin.className = 'card settings-user-admin';
    admin.id = 'settings-user-admin';
    admin.innerHTML = `
      <div class="section-title">
        <div><span class="section-kicker">ACESSO E PERFIS</span><h2>Usuários</h2></div>
        <span class="subtitle">${workspace}</span>
      </div>
      <p class="subtitle">Convide usuários e defina o perfil de acesso deste workspace. Apenas Administradores podem alterar estas permissões.</p>
      <form class="user-admin-invite">
        <div class="field"><label>Nome</label><input value="${name}" aria-label="Nome"></div>
        <div class="field"><label>E-mail</label><input value="${email}" aria-label="E-mail"></div>
        <div class="field"><label>Perfil</label><select aria-label="Perfil do convite"><option>Inspetor</option><option>Administrador</option></select></div>
        <button class="btn btn-primary" type="button">Enviar convite</button>
      </form>
      <div class="user-admin-message success">Convite enviado e acesso configurado com sucesso para um usuário com identificação extensa.</div>
      <div class="alert"><span>Há uma rotação E2EE pendente · 128 PDF(s) aguardando rewrap.</span> <button class="btn btn-compact" type="button">Retomar rotação E2EE</button></div>
      <div class="user-admin-members">
        <article class="user-admin-member">
          <div class="user-admin-member-copy">
            <strong>${name}</strong>
            <span>${email}</span>
            <small>Convite enviado · Ativo · Você</small>
          </div>
          <div class="user-admin-member-controls">
            <select aria-label="Perfil de ${email}"><option>Administrador</option><option>Inspetor</option></select>
            <label class="user-admin-active"><input type="checkbox" checked><span>Ativo</span></label>
            <button class="btn" type="button">Salvar</button>
          </div>
        </article>
      </div>
      <section class="user-admin-access-panel">
        <div class="user-admin-access-head">
          <div><span class="section-kicker">SOLICITAÇÕES</span><h3>Pedidos de cadastro</h3></div>
          <button class="btn" type="button">Atualizar</button>
        </div>
        <p class="subtitle">Compartilhe o código abaixo com quem precisa pedir acesso. A solicitação não cria conta nem permissão até sua aprovação.</p>
        <div class="user-admin-request-code">
          <div><small>Código do workspace</small><strong>A1B2C3D4E5F6</strong></div>
          <button class="btn" type="button">Copiar código</button>
        </div>
        <div class="user-admin-access-requests">
          <article class="user-admin-access-request">
            <div class="user-admin-access-request-copy">
              <strong>${name}</strong>
              <span>${email}</span>
              <small>31/08/2026, 16:00:00</small>
              <p>${message}</p>
            </div>
            <div class="user-admin-access-request-actions">
              <label>Perfil<select><option>Inspetor</option><option>Administrador</option></select></label>
              <button class="btn btn-primary" type="button">Aprovar e convidar</button>
              <button class="btn" type="button">Rejeitar</button>
            </div>
          </article>
        </div>
      </section>`;
    grid.append(admin);

    const footer = document.querySelector('.sidebar-footer');
    if (footer) {
      const account = document.createElement('div');
      account.className = 'auth-account-card';
      account.innerHTML = `
        <div class="auth-account-copy"><span>${name}</span><strong>Administrador</strong><small>${workspace}</small></div>
        <div class="auth-account-actions"><button type="button">Senha</button><button type="button">Sair</button></div>`;
      footer.prepend(account);
    }

    const dialog = document.createElement('dialog');
    dialog.id = 'auth-password-dialog';
    dialog.className = 'auth-password-dialog';
    dialog.innerHTML = `
      <form class="auth-password-form">
        <div class="auth-password-head"><div><span class="auth-kicker">SEGURANÇA</span><h2>Alterar senha</h2></div><button class="auth-password-close" type="button" aria-label="Fechar">×</button></div>
        <p>Use pelo menos 12 caracteres. A nova senha passa a valer imediatamente nesta conta.</p>
        <label>Nova senha<input type="password" value="SenhaMuitoLonga123!"></label>
        <label>Confirmar senha<input type="password" value="SenhaMuitoLonga123!"></label>
        <div class="auth-password-actions"><button type="button" class="btn">Cancelar</button><button type="button" class="btn btn-primary">Salvar nova senha</button></div>
      </form>`;
    document.body.append(dialog);
  }, { name: LONG_NAME, email: LONG_EMAIL, workspace: LONG_WORKSPACE, message: LONG_MESSAGE });
}

async function visualReport(page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 2 && rect.height > 2;
    };
    const describe = element => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        className: String(element.className || '').slice(0, 100),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        text: String(element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)
      };
    };
    const outside = [...document.querySelectorAll('body *')]
      .filter(visible)
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > viewport + 1;
      })
      .map(describe)
      .slice(0, 16);

    const uniqueTops = rects => {
      const tops = [];
      rects.forEach(rect => {
        if (rect.width <= .5 || rect.height <= .5) return;
        const top = Math.round(rect.top * 2) / 2;
        if (!tops.some(value => Math.abs(value - top) <= 1)) tops.push(top);
      });
      return tops;
    };
    const fragmentedLabels = [];
    [...document.querySelectorAll('button,[role="button"],[role="menuitem"],summary')].filter(visible).forEach(control => {
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
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
            fragmentedLabels.push({ ...describe(control), word: match[0], lines });
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
      outside,
      fragmentedLabels: fragmentedLabels.slice(0, 16)
    };
  });
}

async function expectHealthy(page, label) {
  const report = await visualReport(page);
  expect(report.outside, `${label}: elementos administrativos saíram da viewport ${JSON.stringify(report.outside)}`).toEqual([]);
  expect(report.htmlScrollWidth, `${label}: documentElement criou overflow horizontal`).toBeLessThanOrEqual(report.viewport + 1);
  expect(report.bodyScrollWidth, `${label}: body criou overflow horizontal`).toBeLessThanOrEqual(report.viewport + 1);
  expect(report.fragmentedLabels, `${label}: rótulos administrativos fragmentaram palavras ${JSON.stringify(report.fragmentedLabels)}`).toEqual([]);
}

test('administração, permissões e solicitações permanecem contidas e legíveis em breakpoints críticos', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await mountAdministrativeFixture(page);

    await expect(page.locator('#settings-user-admin')).toBeVisible();
    await expectHealthy(page, `Administração ${viewport.width}px`);

    const passwordDialog = page.locator('#auth-password-dialog');
    await passwordDialog.evaluate(element => element.showModal());
    await expect(passwordDialog).toBeVisible();
    await expectHealthy(page, `Alteração de senha ${viewport.width}px`);
    await passwordDialog.evaluate(element => element.close());
  }
});
