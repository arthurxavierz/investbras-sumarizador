'use strict';

const crypto = require('crypto');
const { httpError, timeoutFetch } = require('./_utils');

const SESSION_HOURS = 12;

const secret = () => {
  const value = process.env.SESSION_SECRET || '';
  if (value.length < 24) {
    throw httpError(503, 'Area administrativa sem SESSION_SECRET configurado no ambiente.');
  }
  return value;
};

const b64url = input => Buffer.from(input).toString('base64url');
const fromB64url = input => Buffer.from(input, 'base64url').toString('utf8');

const sign = payload => {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
};

const verify = token => {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) throw httpError(401, 'Sessao invalida.');

  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw httpError(401, 'Sessao invalida.');
  }

  let payload;
  try {
    payload = JSON.parse(fromB64url(body));
  } catch {
    throw httpError(401, 'Sessao invalida.');
  }
  if (!payload?.exp || Date.now() > payload.exp) throw httpError(401, 'Sessao expirada. Entre novamente.');
  return payload;
};

const issue = ({ email, name, role = 'editor', provider }) => {
  const expiresAt = Date.now() + SESSION_HOURS * 3600 * 1000;
  return {
    token: sign({ sub: email, name, role, provider, exp: expiresAt }),
    expiresAt: new Date(expiresAt).toISOString(),
    user: { email, name, role, provider }
  };
};

const bearer = event => {
  const raw = event.headers?.authorization || event.headers?.Authorization || '';
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
};

/** Usado por toda Function administrativa antes de qualquer efeito colateral. */
const requireSession = event => {
  const token = bearer(event);
  if (!token) throw httpError(401, 'Autenticacao necessaria.');
  return verify(token);
};

const constantTimeEquals = (a, b) => {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
};

const supabaseAuthConfigured = () => Boolean(
  (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  && (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
);

/** Login por Supabase Auth quando o projeto ja tem usuarios cadastrados. */
const supabaseLogin = async (email, password) => {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  const response = await timeoutFetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  }, 8000);

  if (!response.ok) return null;
  const payload = await response.json();
  if (!payload?.user?.email) return null;

  return {
    email: payload.user.email,
    name: payload.user.user_metadata?.name || payload.user.email.split('@')[0],
    provider: 'supabase'
  };
};

/** Fallback de operador unico, util antes do Supabase Auth estar populado. */
const envLogin = (email, password) => {
  const expectedEmail = process.env.ADMIN_EMAIL || '';
  const expectedPassword = process.env.ADMIN_PASSWORD || '';
  if (!expectedEmail || expectedPassword.length < 10) return null;
  if (!constantTimeEquals(email.toLowerCase(), expectedEmail.toLowerCase())) return null;
  if (!constantTimeEquals(password, expectedPassword)) return null;
  return { email: expectedEmail, name: process.env.ADMIN_NAME || 'Mesa Investbras', provider: 'env' };
};

const authConfigured = () => supabaseAuthConfigured()
  || Boolean(process.env.ADMIN_EMAIL && (process.env.ADMIN_PASSWORD || '').length >= 10);

module.exports = {
  issue,
  verify,
  requireSession,
  supabaseLogin,
  supabaseAuthConfigured,
  envLogin,
  authConfigured,
  SESSION_HOURS
};
