import { AUTH_CONFIG } from './auth-config.js';

function normalizeError(data, response) {
  const message = String(data?.error || '').trim();
  if (message) return message;
  if (response.status === 429) return 'Muitas solicitações recentes. Tente novamente mais tarde.';
  if (response.status >= 500) return 'Serviço temporariamente indisponível. Tente novamente em alguns minutos.';
  return 'Não foi possível enviar a solicitação.';
}

export async function submitAccessRequest({ email, displayName, requestCode, message = '', website = '', elapsedMs = 0 } = {}) {
  if (!navigator.onLine) throw new Error('Conecte-se à internet para solicitar acesso.');

  const response = await fetch(`${AUTH_CONFIG.projectUrl}/functions/v1/docinspector-access-request`, {
    method: 'POST',
    headers: {
      apikey: AUTH_CONFIG.publishableKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, displayName, requestCode, message, website, elapsedMs })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(normalizeError(data, response));
  return data || { ok: true };
}
