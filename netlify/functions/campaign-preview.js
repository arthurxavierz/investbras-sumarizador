'use strict';

/**
 * Simulador do e-mail. Devolve exatamente o HTML que o inscrito receberia,
 * gerado pelo mesmo modelo do disparo real.
 *
 * A resposta e um documento de topo, aberto em aba própria, e carrega a
 * própria CSP. Assim o e-mail renderiza com seus estilos embutidos sem
 * precisar afrouxar a política do site.
 */

const { requireMethod, httpError, text, isEmail } = require('./_utils');
const { verify } = require('./_auth');
const { buildHtml } = require('./_email');

const html = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"
  },
  body
});

const errorPage = message => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Prévia indisponível</title></head>
<body style="margin:0;padding:40px;background:#0C0B09;color:#F4F0E6;font-family:'Segoe UI',Arial,sans-serif;">
  <h1 style="font-size:20px;margin:0 0 10px;">Prévia indisponível</h1>
  <p style="color:#9A9389;font-size:14px;margin:0;">${message}</p>
</body></html>`;

/**
 * A prévia abre por submit em aba nova, então o corpo chega como formulario.
 * O conteúdo vai inteiro em um campo único, já em JSON.
 */
const readPayload = event => {
  const type = String(
    (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || ''
  );

  if (type.includes('application/x-www-form-urlencoded')) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');
    const field = new URLSearchParams(raw).get('payload');
    if (!field) throw httpError(400, 'Formulario sem conteúdo.');
    try {
      return JSON.parse(field);
    } catch {
      throw httpError(400, 'Conteúdo da prévia inválido.');
    }
  }

  try {
    return JSON.parse(event.body || '{}');
  } catch {
    throw httpError(400, 'JSON inválido.');
  }
};

exports.handler = async event => {
  try {
    requireMethod(event, ['POST']);
    const body = readPayload(event);

    // O token vem no corpo porque a prévia abre por submit de formulario em
    // aba nova, e nesse caminho não da para enviar cabecalho Authorization.
    const session = verify(body.token);

    const email = isEmail(body.email) ? String(body.email).trim().toLowerCase() : session.sub;

    const report = {
      title: text(body.title, { max: 180, field: 'título', required: true }),
      summary: text(body.summary, { max: 1200, field: 'resumo', required: true }),
      sections: body.sections && typeof body.sections === 'object' ? body.sections : {}
    };

    return html(200, buildHtml(report, email));
  } catch (error) {
    const status = error && error.statusCode ? error.statusCode : 500;
    const message = status === 401
      ? 'Sessão inválida ou expirada. Entre novamente no painel e repita a prévia.'
      : (error.message || 'Não foi possível montar a prévia.');
    return html(status, errorPage(message));
  }
};
