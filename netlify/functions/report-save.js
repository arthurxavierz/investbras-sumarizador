'use strict';

const { json, preflight, fail, httpError, requireMethod, readBody, text, hasSupabase, supabase, log } = require('./_utils');
const { requireSession } = require('./_auth');
const reportEndpoint = require('./report');

const SECTION_FIELDS = ['coffee', 'weather', 'brazil', 'global', 'geopolitics', 'commodities', 'agenda', 'notes'];

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const readReport = body => {
  const sections = {};
  for (const field of SECTION_FIELDS) {
    sections[field] = text(body[field], { max: 8000, field });
  }
  return {
    title: text(body.title, { max: 180, field: 'titulo', required: true }),
    summary: text(body.summary, { max: 1200, field: 'resumo', required: true }),
    editionDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body.editionDate || '')) ? body.editionDate : today(),
    sections
  };
};

/** Uma edicao por dia. Republicar sobrescreve a linha do mesmo dia. */
const findByDate = async editionDate => {
  const rows = await supabase('market_reports', {
    query: { select: 'id,status', edition_date: 'eq.' + editionDate, order: 'created_at.desc', limit: '1' }
  });
  return rows && rows[0];
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  try {
    requireMethod(event, ['POST']);
    const session = requireSession(event);

    if (!hasSupabase()) {
      return json(503, {
        success: false,
        status: 'not-configured',
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para publicar de forma compartilhada.'
      }, 0);
    }

    const body = readBody(event);
    const action = String(body.action || 'draft');
    if (!['draft', 'publish', 'unpublish'].includes(action)) {
      throw httpError(400, 'Acao invalida.');
    }

    if (action === 'unpublish') {
      const editionDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.editionDate || '')) ? body.editionDate : today();
      const existing = await findByDate(editionDate);
      if (!existing) throw httpError(404, 'Nenhuma edicao encontrada para esta data.');

      await supabase('market_reports', {
        method: 'PATCH',
        query: { id: 'eq.' + existing.id },
        body: { status: 'draft', published_at: null, updated_at: new Date().toISOString() },
        prefer: 'return=minimal'
      });

      reportEndpoint.invalidate();
      await log('info', 'report', 'Edicao despublicada', { editionDate, by: session.sub });
      return json(200, { success: true, status: 'unpublished', message: 'Edicao removida da area publica. O rascunho continua salvo.' }, 0);
    }

    const report = readReport(body);
    const publishing = action === 'publish';
    const existing = await findByDate(report.editionDate);

    const row = {
      title: report.title,
      summary: report.summary,
      content: report.sections,
      edition_date: report.editionDate,
      status: publishing ? 'published' : 'draft',
      author_name: session.name || session.sub,
      author_email: session.sub,
      updated_at: new Date().toISOString(),
      published_at: publishing ? new Date().toISOString() : null
    };

    let saved;
    if (existing) {
      saved = await supabase('market_reports', {
        method: 'PATCH',
        query: { id: 'eq.' + existing.id, select: 'id,status,published_at,updated_at' },
        body: row,
        prefer: 'return=representation'
      });
    } else {
      saved = await supabase('market_reports', {
        method: 'POST',
        query: { select: 'id,status,published_at,updated_at' },
        body: row,
        prefer: 'return=representation'
      });
    }

    reportEndpoint.invalidate();
    await log('info', 'report', publishing ? 'Edicao publicada' : 'Rascunho salvo', {
      editionDate: report.editionDate,
      by: session.sub
    });

    return json(200, {
      success: true,
      status: publishing ? 'published' : 'draft',
      message: publishing
        ? 'Edicao publicada. A area publica passa a exibir esta leitura.'
        : 'Rascunho salvo no Supabase e disponivel para a equipe.',
      data: (saved && saved[0]) || null
    }, 0);
  } catch (error) {
    return fail(error, 'Nao foi possivel salvar a edicao.');
  }
};
