'use strict';

const { json, preflight, fail, httpError, requireMethod, readBody, text, timeoutFetch, hasSupabase, supabase, log } = require('./_utils');
const { requireSession } = require('./_auth');
const { tokenFor } = require('./unsubscribe');

const BATCH_SIZE = 100;

const SITE_URL = () => (process.env.SITE_URL || 'https://investbras.achillesmedia.com.br').replace(/\/$/, '');

const escapeHtml = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const paragraphs = value => String(value || '')
  .split(/\n{2,}/)
  .map(block => block.trim())
  .filter(Boolean)
  .map(block => '<p style="margin:0 0 14px;color:#3c3a35;font-size:15px;line-height:1.65;">'
    + escapeHtml(block).replace(/\n/g, '<br>') + '</p>')
  .join('');

const SECTION_LABELS = [
  ['coffee', 'Cafe'],
  ['brazil', 'Brasil'],
  ['global', 'Exterior'],
  ['commodities', 'Commodities'],
  ['geopolitics', 'Geopolitica e cadeia'],
  ['agenda', 'Agenda']
];

const buildHtml = (report, email) => {
  const sections = SECTION_LABELS
    .filter(([key]) => String(report.sections && report.sections[key] || '').trim())
    .map(([key, label]) => `
      <tr><td style="padding:26px 32px 0;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a7a4e;">${label}</p>
        ${paragraphs(report.sections[key])}
      </td></tr>`)
    .join('');

  const unsubscribeUrl = SITE_URL() + '/.netlify/functions/unsubscribe?email='
    + encodeURIComponent(email) + '&token=' + tokenFor(email);

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
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
        <a href="${unsubscribeUrl}" style="color:#7d7973;">Cancelar o recebimento</a>
      </p>
    </td></tr>
  </table>
</body></html>`;
};

const buildText = report => {
  const blocks = [report.title, '', report.summary, ''];
  for (const [key, label] of SECTION_LABELS) {
    const value = String(report.sections && report.sections[key] || '').trim();
    if (value) blocks.push(label.toUpperCase(), value, '');
  }
  blocks.push('Conteudo informativo. Nao constitui recomendacao de investimento.');
  return blocks.join('\n');
};

const activeSubscribers = async () => {
  const rows = await supabase('subscribers', {
    query: { select: 'email', status: 'eq.active', order: 'created_at.asc', limit: '5000' }
  });
  return (rows || []).map(row => row.email).filter(Boolean);
};

const sendBatch = async (apiKey, from, subject, recipients, report) => {
  const response = await timeoutFetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(recipients.map(email => ({
      from,
      to: [email],
      subject,
      html: buildHtml(report, email),
      text: buildText(report)
    })))
  }, 20000);

  if (!response.ok) {
    const detail = await response.text();
    throw httpError(502, 'Resend respondeu ' + response.status + ': ' + detail.slice(0, 200));
  }
  return recipients.length;
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  try {
    requireMethod(event, ['POST']);
    const session = requireSession(event);
    const body = readBody(event);

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      return json(503, {
        success: false,
        status: 'provider-not-configured',
        error: 'Configure RESEND_API_KEY e EMAIL_FROM no ambiente para liberar o disparo.'
      }, 0);
    }

    const subject = text(body.subject, { max: 160, field: 'assunto', required: true });
    const report = {
      title: text(body.title, { max: 180, field: 'titulo', required: true }),
      summary: text(body.summary, { max: 1200, field: 'resumo', required: true }),
      sections: body.sections && typeof body.sections === 'object' ? body.sections : {}
    };

    const isTest = Boolean(body.test);
    let recipients;

    if (isTest) {
      recipients = [session.sub];
    } else {
      if (body.confirm !== true) {
        throw httpError(400, 'Disparo real exige confirmacao explicita.');
      }
      if (!hasSupabase()) {
        return json(503, {
          success: false,
          status: 'list-not-configured',
          error: 'Base de inscritos indisponivel. Configure o Supabase antes do disparo real.'
        }, 0);
      }
      recipients = await activeSubscribers();
      if (!recipients.length) {
        return json(409, { success: false, status: 'empty-list', error: 'Nenhum inscrito ativo na base.' }, 0);
      }
    }

    let sent = 0;
    const failures = [];
    for (let index = 0; index < recipients.length; index += BATCH_SIZE) {
      const slice = recipients.slice(index, index + BATCH_SIZE);
      try {
        sent += await sendBatch(apiKey, from, subject, slice, report);
      } catch (error) {
        failures.push(error.message);
      }
    }

    if (hasSupabase()) {
      try {
        await supabase('email_campaigns', {
          method: 'POST',
          body: {
            subject,
            preview: report.summary.slice(0, 240),
            provider: 'resend',
            status: failures.length ? (sent ? 'partial' : 'failed') : 'sent',
            recipient_count: sent,
            is_test: isTest,
            sent_at: new Date().toISOString(),
            created_by: session.sub
          },
          prefer: 'return=minimal'
        });
      } catch {
        /* historico nao bloqueia o disparo */
      }
    }

    await log(failures.length ? 'warning' : 'info', 'email', 'Disparo executado', {
      sent, failures: failures.length, isTest, by: session.sub
    });

    return json(failures.length && !sent ? 502 : 200, {
      success: sent > 0,
      status: failures.length ? (sent ? 'partial' : 'failed') : 'sent',
      message: isTest
        ? 'Teste enviado para ' + session.sub + '.'
        : 'Disparo concluido para ' + sent + ' inscrito(s).',
      data: { sent, failures }
    }, 0);
  } catch (error) {
    return fail(error, 'Nao foi possivel disparar a edicao agora.');
  }
};
