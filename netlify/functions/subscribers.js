'use strict';

/**
 * Base de inscritos: leitura e escrita, ambas restritas a sessão da mesa.
 * GET  lista com busca e filtro de status, mais o resumo do painel.
 * POST aplica uma acao: add, status ou remove.
 */

const { json, preflight, fail, httpError, readBody, text, isEmail, hasSupabase, supabase, log } = require('./_utils');
const { requireSession } = require('./_auth');

const PAGE_SIZE = 50;
const IMPORT_LIMIT = 2000;

/**
 * Guarda só o que dá para discar: dígitos, e o "+" quando vier código de país.
 * Não válida operadora nem formato regional, porque base de cliente chega em
 * todo tipo de formato e recusar por máscara perderia contato bom.
 */
const cleanPhone = value => {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  if (digits.replace(/\D/g, '').length < 8) return null;
  return digits.slice(0, 20);
};

const empty = {
  active: 0,
  unsubscribed: 0,
  bounced: 0,
  total: 0,
  list: [],
  campaigns: []
};

const notConfigured = () => json(200, {
  success: false,
  status: 'not-configured',
  error: 'Base de inscritos indisponível. Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.',
  data: empty
}, 0);

const countBy = async status => {
  const rows = await supabase('subscribers', { query: { select: 'id', status: 'eq.' + status, limit: '10000' } });
  return (rows || []).length;
};

const listSubscribers = async params => {
  const query = {
    select: 'id,email,name,phone,organization,status,source,notes,created_at,updated_at',
    order: 'created_at.desc',
    limit: String(PAGE_SIZE)
  };

  const status = String(params.status || '').trim();
  if (['active', 'unsubscribed', 'bounced'].includes(status)) query.status = 'eq.' + status;

  const search = String(params.search || '').trim().toLowerCase().slice(0, 80);
  if (search) {
    // Escapa virgula e parenteses para não quebrar a sintaxe do filtro or.
    const safe = search.replace(/[(),*]/g, ' ').trim();
    if (safe) query.or = '(email.ilike.*' + safe + '*,name.ilike.*' + safe + '*,organization.ilike.*' + safe + '*)';
  }

  return (await supabase('subscribers', { query })) || [];
};

const readList = async event => {
  const params = event.queryStringParameters || {};
  const [list, active, unsubscribed, bounced, campaigns] = await Promise.all([
    listSubscribers(params),
    countBy('active'),
    countBy('unsubscribed'),
    countBy('bounced'),
    supabase('email_campaigns', {
      query: { select: 'subject,status,recipient_count,is_test,sent_at', order: 'created_at.desc', limit: '8' }
    })
  ]);

  return json(200, {
    success: true,
    source: 'Supabase',
    status: 'available',
    data: {
      active,
      unsubscribed,
      bounced,
      total: active + unsubscribed + bounced,
      list,
      campaigns: campaigns || [],
      pageSize: PAGE_SIZE
    }
  }, 0);
};

const applyAction = async (event, session) => {
  const body = readBody(event);
  const action = String(body.action || '');

  if (action === 'add') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!isEmail(email)) throw httpError(400, 'Informe um e-mail válido.');

    const name = text(body.name, { max: 120, field: 'nome', required: true });

    await supabase('subscribers', {
      method: 'POST',
      body: {
        email,
        name,
        phone: cleanPhone(body.phone),
        organization: text(body.organization, { max: 160, field: 'empresa' }) || null,
        notes: text(body.notes, { max: 400, field: 'observação' }) || null,
        status: 'active',
        source: 'mesa',
        created_by: session.sub,
        updated_at: new Date().toISOString()
      },
      prefer: 'resolution=merge-duplicates,return=minimal'
    });

    await log('info', 'subscribe', 'Inscrito adicionado pela mesa', { email, by: session.sub });
    return { status: 'added', message: 'Inscrito ' + email + ' cadastrado.' };
  }

  if (action === 'import') {
    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!rows || !rows.length) throw httpError(400, 'Nenhuma linha para importar.');
    if (rows.length > IMPORT_LIMIT) {
      throw httpError(400, 'Importação limitada a ' + IMPORT_LIMIT + ' linhas por vez.');
    }

    const seen = new Set();
    const valid = [];
    const rejected = [];

    for (const row of rows) {
      const email = String((row && row.email) || '').trim().toLowerCase();
      const name = String((row && row.name) || '').trim().slice(0, 120);

      if (!isEmail(email)) { rejected.push({ email: email || '(vazio)', reason: 'e-mail inválido' }); continue; }
      if (!name) { rejected.push({ email, reason: 'sem nome' }); continue; }
      if (seen.has(email)) { rejected.push({ email, reason: 'repetido no arquivo' }); continue; }

      seen.add(email);
      valid.push({
        email,
        name,
        phone: cleanPhone(row.phone),
        organization: String((row && row.organization) || '').trim().slice(0, 160) || null,
        status: 'active',
        source: 'importação',
        created_by: session.sub,
        updated_at: new Date().toISOString()
      });
    }

    if (!valid.length) {
      throw httpError(400, 'Nenhuma linha do arquivo tinha e-mail e nome válidos.');
    }

    // Lotes de 200 para não estourar o corpo da requisição ao PostgREST.
    for (let index = 0; index < valid.length; index += 200) {
      await supabase('subscribers', {
        method: 'POST',
        body: valid.slice(index, index + 200),
        prefer: 'resolution=merge-duplicates,return=minimal'
      });
    }

    await log('info', 'subscribe', 'Importação de base', {
      imported: valid.length, rejected: rejected.length, by: session.sub
    });

    return {
      status: 'imported',
      message: valid.length + ' contato(s) importado(s)'
        + (rejected.length ? ', ' + rejected.length + ' ignorado(s).' : '.'),
      rejected: rejected.slice(0, 20)
    };
  }

  if (action === 'status') {
    const email = String(body.email || '').trim().toLowerCase();
    const status = String(body.status || '');
    if (!isEmail(email)) throw httpError(400, 'Informe um e-mail válido.');
    if (!['active', 'unsubscribed', 'bounced'].includes(status)) throw httpError(400, 'Status inválido.');

    await supabase('subscribers', {
      method: 'PATCH',
      query: { email: 'eq.' + email },
      body: { status, updated_at: new Date().toISOString() },
      prefer: 'return=minimal'
    });

    await log('info', 'subscribe', 'Status alterado pela mesa', { email, status, by: session.sub });
    return { status: 'updated', message: 'Status de ' + email + ' agora e ' + status + '.' };
  }

  if (action === 'remove') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!isEmail(email)) throw httpError(400, 'Informe um e-mail válido.');

    await supabase('subscribers', {
      method: 'DELETE',
      query: { email: 'eq.' + email },
      prefer: 'return=minimal'
    });

    await log('warning', 'subscribe', 'Inscrito removido pela mesa', { email, by: session.sub });
    return { status: 'removed', message: email + ' removido da base.' };
  }

  throw httpError(400, 'Acao inválida.');
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  try {
    const session = requireSession(event);
    if (!hasSupabase()) return notConfigured();

    if (event.httpMethod === 'GET') return readList(event);
    if (event.httpMethod === 'POST') {
      const result = await applyAction(event, session);
      return json(200, {
        success: true,
        status: result.status,
        message: result.message,
        data: result.rejected ? { rejected: result.rejected } : null
      }, 0);
    }

    throw httpError(405, 'Metodo não permitido.');
  } catch (error) {
    return fail(error, 'Não foi possível acessar a base de inscritos.');
  }
};
