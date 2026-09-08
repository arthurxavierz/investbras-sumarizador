'use strict';

/**
 * Modelo do e-mail da edicao. Fica separado porque duas funcoes precisam do
 * mesmo HTML: o disparo real e o simulador do painel. Se cada uma tivesse a
 * sua copia, a previa mentiria sobre o que o inscrito recebe.
 */

const crypto = require('crypto');

const SITE_URL = () => String(process.env.SITE_URL || 'https://investbras.achillesmedia.com.br').replace(/\/$/, '');

const escapeHtml = value => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Token de descadastro derivado do e-mail, para o link de um clique. */
const tokenFor = email => crypto
  .createHmac('sha256', process.env.SESSION_SECRET || 'investbras-fallback-secret')
  .update(String(email).trim().toLowerCase())
  .digest('base64url')
  .slice(0, 32);

const SECTION_LABELS = [
  ['coffee', 'Cafe'],
  ['weather', 'Lavoura e clima'],
  ['brazil', 'Brasil'],
  ['global', 'Exterior'],
  ['commodities', 'Commodities'],
  ['geopolitics', 'Geopolitica e cadeia'],
  ['agenda', 'Agenda']
];

const paragraphs = value => String(value || '')
  .split(/\n{2,}/)
  .map(block => block.trim())
  .filter(Boolean)
  .map(block => '<p style="margin:0 0 14px;color:#3c3a35;font-size:15px;line-height:1.65;">'
    + escapeHtml(block).replace(/\n/g, '<br>') + '</p>')
  .join('');

const buildHtml = (report, email) => {
  const sections = SECTION_LABELS
    .filter(([key]) => String((report.sections && report.sections[key]) || '').trim())
    .map(([key, label]) => `
      <tr><td style="padding:26px 32px 0;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a7a4e;">${label}</p>
        ${paragraphs(report.sections[key])}
      </td></tr>`)
    .join('');

  const unsubscribeUrl = SITE_URL() + '/.netlify/functions/unsubscribe?email='
    + encodeURIComponent(email) + '&token=' + tokenFor(email);

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.title)}</title></head>
<body style="margin:0;padding:24px 12px;background:#efece4;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #ddd8cc;">
    <tr><td style="padding:28px 32px;background:#0C0B09;">
      <p style="margin:0;font-size:11px;letter-spacing:.28em;color:#D8AF58;">INVESTBRAS INTELLIGENCE</p>
      <p style="margin:6px 0 0;font-size:12px;color:#98928A;">Giro do mercado de cafe e commodities</p>
    </td></tr>
    <tr><td style="padding:32px 32px 0;">
      <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;color:#17150f;">${escapeHtml(report.title)}</h1>
      ${paragraphs(report.summary)}
    </td></tr>
    ${sections}
    <tr><td style="padding:30px 32px 34px;">
      <a href="${SITE_URL()}" style="display:inline-block;padding:13px 22px;background:#D8AF58;color:#151310;text-decoration:none;font-weight:700;font-size:14px;">Ver a edicao completa</a>
    </td></tr>
    <tr><td style="padding:20px 32px 28px;border-top:1px solid #e6e1d6;">
      <p style="margin:0 0 10px;font-size:11px;line-height:1.6;color:#7d7973;">
        Conteudo informativo. Nao constitui recomendacao de investimento, oferta ou garantia de resultado.
        Cotacoes sao das fontes citadas em cada bloco e podem sofrer revisao.
      </p>
      <p style="margin:0;font-size:11px;color:#7d7973;">
        Enviado para ${escapeHtml(email)}. <a href="${unsubscribeUrl}" style="color:#7d7973;">Cancelar o recebimento</a>
      </p>
    </td></tr>
  </table>
</body></html>`;
};

const buildText = report => {
  const blocks = [report.title, '', report.summary, ''];
  for (const [key, label] of SECTION_LABELS) {
    const value = String((report.sections && report.sections[key]) || '').trim();
    if (value) blocks.push(label.toUpperCase(), value, '');
  }
  blocks.push('Conteudo informativo. Nao constitui recomendacao de investimento.');
  return blocks.join('\n');
};

module.exports = { buildHtml, buildText, tokenFor, escapeHtml, SECTION_LABELS, SITE_URL };
