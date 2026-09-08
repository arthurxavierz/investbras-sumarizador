'use strict';

const { json, preflight, fail, httpError, requireMethod, readBody, text, timeoutFetch, hasSupabase, supabase, log } = require('./_utils');
const { requireSession } = require('./_auth');
const { buildHtml, buildText } = require('./_email');

const BATCH_SIZE = 100;

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
