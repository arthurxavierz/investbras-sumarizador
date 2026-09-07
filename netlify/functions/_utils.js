'use strict';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

/**
 * Resposta JSON padrao. cacheSeconds = 0 desliga cache (endpoints autenticados).
 */
const json = (statusCode, payload, cacheSeconds = 60) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheSeconds > 0
      ? `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 6}`
      : 'no-store, max-age=0',
    ...CORS,
    ...SECURITY
  },
  body: JSON.stringify({ fetchedAt: new Date().toISOString(), ...payload })
});

const preflight = () => ({ statusCode: 204, headers: { ...CORS, ...SECURITY }, body: '' });

/** Erro sem vazar stack para o cliente. */
const fail = (error, fallback = 'Nao foi possivel concluir a operacao.') => {
  const status = error?.statusCode || 500;
  if (status >= 500) console.error(error);
  return json(status, {
    success: false,
    status: 'error',
    error: error?.statusCode ? error.message : fallback
  }, 0);
};

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const requireMethod = (event, allowed) => {
  if (!allowed.includes(event.httpMethod)) {
    throw httpError(405, `Metodo nao permitido. Use ${allowed.join(' ou ')}.`);
  }
};

const readBody = event => {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw httpError(400, 'JSON invalido.');
  }
};

const timeoutFetch = async (url, options = {}, timeoutMs = 6500) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'InvestbrasIntelligence/2.0 (+https://investbras.achillesmedia.com.br)',
        Accept: 'application/json,text/xml,text/plain,*/*',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
};

/** Uma nova tentativa curta cobre a instabilidade tipica de feeds publicos. */
const retryFetch = async (url, options = {}, timeoutMs = 6500, attempts = 2) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await timeoutFetch(url, options, timeoutMs);
      if (response.ok) return response;
      lastError = httpError(502, `HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw lastError || httpError(502, 'Fonte sem resposta.');
};

const strip = value => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const decodeEntities = value => strip(value)
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ');

const isEmail = value => /^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$/.test(String(value || '').trim());

const text = (value, { max = 4000, field = 'campo', required = false } = {}) => {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) {
    if (required) throw httpError(400, `Preencha ${field}.`);
    return '';
  }
  if (clean.length > max) throw httpError(400, `O ${field} excede ${max} caracteres.`);
  return clean;
};

const clientIp = event => String(
  event.headers?.['x-nf-client-connection-ip']
  || (event.headers?.['x-forwarded-for'] || '').split(',')[0]
  || 'desconhecido'
).trim();

/**
 * Limite por instancia. Netlify reaproveita containers quentes, entao isso
 * segura rajadas obvias. O limite definitivo fica no Supabase quando ativo.
 */
const buckets = new Map();
const rateLimit = (key, { limit = 10, windowMs = 60000 } = {}) => {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) throw httpError(429, 'Muitas tentativas. Aguarde um instante.');
};

const supabaseConfig = () => {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return url && key ? { url, key } : null;
};

const hasSupabase = () => Boolean(supabaseConfig());

/** Cliente REST minimo do Supabase. Evita dependencia de npm nas Functions. */
const supabase = async (path, { method = 'GET', body, prefer, query } = {}) => {
  const config = supabaseConfig();
  if (!config) throw httpError(503, 'Supabase nao configurado neste ambiente.');

  const search = query ? `?${new URLSearchParams(query)}` : '';
  const response = await timeoutFetch(`${config.url}/rest/v1/${path}${search}`, {
    method,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }, 8000);

  const raw = await response.text();
  if (!response.ok) {
    console.error('Supabase', response.status, raw.slice(0, 400));
    throw httpError(response.status === 409 ? 409 : 502, `Supabase respondeu ${response.status}.`);
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const log = async (level, scope, message, metadata = {}) => {
  if (!hasSupabase()) return;
  try {
    await supabase('system_logs', { method: 'POST', body: { level, scope, message, metadata } });
  } catch {
    /* log nunca derruba a requisicao principal */
  }
};

module.exports = {
  json,
  preflight,
  fail,
  httpError,
  requireMethod,
  readBody,
  timeoutFetch,
  retryFetch,
  strip,
  decodeEntities,
  isEmail,
  text,
  clientIp,
  rateLimit,
  supabase,
  hasSupabase,
  log
};
