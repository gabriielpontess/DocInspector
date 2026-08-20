import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.111.0';

const EXACT_ORIGINS = new Set([
  'https://docinspector.netlify.app',
  'https://app.docinspector.com.br',
  'http://127.0.0.1:4173',
  'http://localhost:4173'
]);

const NETLIFY_PREVIEW = /^https:\/\/[a-z0-9-]+--docinspector\.netlify\.app$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function allowedOrigin(req: Request) {
  const origin = String(req.headers.get('Origin') || '').trim();
  if (EXACT_ORIGINS.has(origin) || NETLIFY_PREVIEW.test(origin)) return origin;
  return '';
}

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(status: number, body: unknown, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeName(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function normalizeCode(value: unknown) {
  return String(value ?? '').toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12);
}

function normalizeMessage(value: unknown) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, 500) : null;
}

Deno.serve(async (req: Request) => {
  const origin = allowedOrigin(req);
  if (!origin) return new Response('Origin not allowed', { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' }, origin);

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) return json(500, { error: 'Serviço de solicitação indisponível.' }, origin);

    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const displayName = normalizeName(body?.displayName);
    const requestCode = normalizeCode(body?.requestCode);
    const message = normalizeMessage(body?.message);
    const website = String(body?.website ?? '').trim();
    const elapsedMs = Number(body?.elapsedMs ?? 0);

    // Honeypot: respond as accepted without persisting automated submissions.
    if (website) return json(202, { ok: true }, origin);

    if (!EMAIL_RE.test(email) || email.length > 254) {
      return json(400, { error: 'Informe um e-mail válido.' }, origin);
    }
    if (displayName.length < 2) {
      return json(400, { error: 'Informe seu nome.' }, origin);
    }
    if (!/^[0-9A-F]{12}$/.test(requestCode)) {
      return json(400, { error: 'Informe um código de workspace válido.' }, origin);
    }
    if (!Number.isFinite(elapsedMs) || elapsedMs < 800) {
      return json(400, { error: 'Revise os dados e tente novamente.' }, origin);
    }

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const { data: accessCode, error: accessCodeError } = await admin
      .from('docinspector_workspace_access_codes')
      .select('workspace_id')
      .eq('request_code', requestCode)
      .maybeSingle();

    if (accessCodeError) throw accessCodeError;
    if (!accessCode?.workspace_id) {
      return json(400, { error: 'Código de workspace inválido ou expirado.' }, origin);
    }

    const workspaceId = accessCode.workspace_id;
    const { data: activeRequest, error: activeRequestError } = await admin
      .from('docinspector_access_requests')
      .select('id,status')
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .in('status', ['PENDING', 'PROCESSING'])
      .maybeSingle();

    if (activeRequestError) throw activeRequestError;

    if (activeRequest?.id) {
      if (activeRequest.status === 'PENDING') {
        const { error: updateError } = await admin
          .from('docinspector_access_requests')
          .update({ display_name: displayName, message, source_origin: origin })
          .eq('id', activeRequest.id)
          .eq('status', 'PENDING');
        if (updateError) throw updateError;
      }
      return json(202, { ok: true, updated: activeRequest.status === 'PENDING' }, origin);
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await admin
      .from('docinspector_access_requests')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .gte('created_at', since);

    if (countError) throw countError;
    if ((count || 0) >= 3) {
      return json(429, { error: 'Muitas solicitações recentes para este e-mail. Tente novamente mais tarde.' }, origin);
    }

    const { error: insertError } = await admin
      .from('docinspector_access_requests')
      .insert({
        workspace_id: workspaceId,
        email,
        display_name: displayName,
        message,
        source_origin: origin
      });

    if (insertError?.code === '23505') {
      // A concurrent request already created the active row. Treat the submission as idempotently accepted.
      return json(202, { ok: true, deduplicated: true }, origin);
    }
    if (insertError) throw insertError;
    return json(202, { ok: true }, origin);
  } catch (error) {
    console.error('docinspector-access-request', error);
    return json(500, { error: 'Não foi possível registrar a solicitação agora.' }, origin);
  }
});
