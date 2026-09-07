'use strict';

const crypto = require('crypto');
const { hasSupabase, supabase, log } = require('./_utils');

/**
 * Token derivado do e-mail. Permite o descadastro em um clique, sem login,
 * e sem aceitar remocao de qualquer endereco por quem adivinhar a URL.
 */
const tokenFor = email => crypto
  .createHmac('sha256', process.env.SESSION_SECRET || 'investbras-fallback-secret')
  .update(String(email).trim().toLowerCase())
  .digest('base64url')
  .slice(0, 32);

const page = (title, message, tone) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title} | Investbras Intelligence</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
    background:#0C0B09; color:#F4F0E6; font:16px/1.6 system-ui, "Segoe UI", sans-serif; }
  main { max-width:520px; border:1px solid #262320; border-radius:4px; padding:40px; background:#131210; }
  h1 { font-size:24px; margin:0 0 12px; letter-spacing:-.01em; }
  p { color:#98928A; margin:0 0 24px; }
  strong { color:${tone === 'ok' ? '#D8AF58' : '#E0736B'}; }
  a { display:inline-block; padding:12px 18px; border-radius:4px; background:#D8AF58; color:#151310;
    text-decoration:none; font-weight:600; font-size:14px; }
</style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">Voltar para a central de mercado</a>
  </main>
</body>
</html>`;

const html = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  },
  body
});

exports.handler = async event => {
  const params = event.queryStringParameters || {};
  const email = String(params.email || '').trim().toLowerCase();
  const token = String(params.token || '');

  if (!email || !token || token !== tokenFor(email)) {
    return html(400, page('Link invalido', 'Este link de descadastro nao confere. Responda a ultima edicao recebida e a mesa remove o endereco manualmente.', 'error'));
  }

  if (!hasSupabase()) {
    return html(503, page('Cadastro indisponivel', 'A base de inscritos nao esta conectada neste ambiente. Nenhuma alteracao foi feita.', 'error'));
  }

  try {
    await supabase('subscribers', {
      method: 'PATCH',
      query: { email: 'eq.' + email },
      body: { status: 'unsubscribed', updated_at: new Date().toISOString() },
      prefer: 'return=minimal'
    });
    await log('info', 'subscribe', 'Descadastro concluido', { email });
    return html(200, page('Descadastro concluido', 'O endereco <strong>' + email + '</strong> nao recebe mais o giro diario da Investbras.', 'ok'));
  } catch (error) {
    console.error('unsubscribe', error);
    return html(502, page('Nao foi possivel concluir', 'A base nao respondeu agora. Tente novamente em alguns minutos.', 'error'));
  }
};

exports.tokenFor = tokenFor;
