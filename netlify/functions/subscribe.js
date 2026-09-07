'use strict';

const { json, preflight, fail, requireMethod, readBody, isEmail, text, rateLimit, clientIp, hasSupabase, supabase, log } = require('./_utils');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  try {
    requireMethod(event, ['POST']);
    rateLimit('subscribe:' + clientIp(event), { limit: 6, windowMs: 300000 });

    const body = readBody(event);

    // Honeypot: bots preenchem campos ocultos. Resposta neutra, sem gravar.
    if (body.company) {
      return json(202, { success: true, status: 'ignored', message: 'Cadastro recebido.' }, 0);
    }

    const email = String(body.email || '').trim().toLowerCase();
    if (!isEmail(email)) {
      return json(400, { success: false, status: 'invalid-email', error: 'Informe um e-mail valido.' }, 0);
    }

    const name = text(body.name, { max: 120, field: 'nome' });
    const company = text(body.organization, { max: 160, field: 'empresa' });

    if (!hasSupabase()) {
      return json(202, {
        success: true,
        source: 'investbras-intelligence',
        status: 'validated-not-persisted',
        message: 'E-mail validado. A lista sera gravada assim que o Supabase estiver configurado.',
        data: { email }
      }, 0);
    }

    await supabase('subscribers', {
      method: 'POST',
      body: {
        email,
        name: name || null,
        organization: company || null,
        status: 'active',
        source: 'website',
        updated_at: new Date().toISOString()
      },
      prefer: 'resolution=merge-duplicates,return=minimal'
    });

    await log('info', 'subscribe', 'Novo inscrito', { email });

    return json(200, {
      success: true,
      source: 'Supabase',
      status: 'subscribed',
      message: 'Cadastro confirmado. Voce recebe a edicao assim que ela for publicada.'
    }, 0);
  } catch (error) {
    return fail(error, 'Nao foi possivel concluir o cadastro agora.');
  }
};
