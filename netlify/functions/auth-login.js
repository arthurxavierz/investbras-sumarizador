'use strict';

const { json, fail, preflight, requireMethod, readBody, isEmail, rateLimit, clientIp, log } = require('./_utils');
const { issue, supabaseLogin, supabaseAuthConfigured, envLogin, authConfigured } = require('./_auth');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  try {
    requireMethod(event, ['POST']);

    if (!authConfigured()) {
      return json(503, {
        success: false,
        status: 'auth-not-configured',
        error: 'Configure SUPABASE_ANON_KEY ou ADMIN_EMAIL e ADMIN_PASSWORD no ambiente para liberar o painel.'
      }, 0);
    }

    rateLimit(`login:${clientIp(event)}`, { limit: 8, windowMs: 300000 });

    const body = readBody(event);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!isEmail(email) || password.length < 6) {
      return json(400, { success: false, status: 'invalid-credentials', error: 'E-mail ou senha invalidos.' }, 0);
    }

    let account = null;
    if (supabaseAuthConfigured()) account = await supabaseLogin(email, password);
    if (!account) account = envLogin(email, password);

    if (!account) {
      await log('warning', 'auth', 'Tentativa de login recusada', { email, ip: clientIp(event) });
      return json(401, { success: false, status: 'unauthorized', error: 'E-mail ou senha invalidos.' }, 0);
    }

    const session = issue(account);
    await log('info', 'auth', 'Login autorizado', { email: account.email, provider: account.provider });

    return json(200, { success: true, status: 'authenticated', data: session }, 0);
  } catch (error) {
    return fail(error, 'Nao foi possivel validar o acesso agora.');
  }
};
