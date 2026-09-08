'use strict';

/**
 * Leitura de noticias para a pagina publica.
 *
 * Caminho normal: le o que a coleta agendada ja gravou no Supabase, o que
 * responde rapido e sempre com capa. Reserva: coleta ao vivo, com orcamento
 * curto, usada antes da primeira execucao do cron ou sem banco configurado.
 */

const { json, preflight, hasSupabase, supabase } = require('./_utils');
const { collect } = require('./_news');

const CACHE_MS = 5 * 60 * 1000;
const FRESH_HOURS = 6;
let cache = { at: 0, payload: null };

const fromRow = row => ({
  title: row.title,
  excerpt: row.summary || '',
  dek: row.dek || '',
  url: row.url,
  image: row.image_url || '',
  imageKind: row.image_kind || 'nenhuma',
  source: row.source,
  sourceDomain: row.source_domain || '',
  category: row.category || 'Mercado',
  relevance: Number(row.relevance) || 0,
  publishedAt: row.published_at
});

const summarize = items => {
  const byCategory = {};
  for (const item of items) byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  return {
    byCategory,
    withPhoto: items.filter(item => item.imageKind === 'foto').length,
    withExcerpt: items.filter(item => item.excerpt).length
  };
};

const fromDatabase = async () => {
  const since = new Date(Date.now() - FRESH_HOURS * 3600 * 1000).toISOString();
  const rows = await supabase('news_items', {
    query: {
      select: 'title,summary,dek,category,source,source_domain,url,image_url,image_kind,relevance,published_at',
      fetched_at: 'gte.' + since,
      order: 'relevance.desc',
      limit: '24'
    }
  });

  if (!rows || !rows.length) return null;
  const items = rows.map(fromRow);

  return {
    success: true,
    source: 'Coleta agendada',
    status: 'available',
    error: null,
    data: items,
    meta: Object.assign({ origin: 'supabase' }, summarize(items))
  };
};

const live = async () => {
  // Orcamento curto: esta funcao responde a um visitante, nao ao cron.
  const { items, meta } = await collect({ feedTimeout: 5000, enrichCount: 6, enrichTimeout: 3500 });
  return {
    success: items.length > 0,
    source: 'Coleta ao vivo',
    status: items.length ? (meta.failures ? 'partial' : 'available') : 'unavailable',
    error: items.length ? null : 'Nenhum feed respondeu dentro do tempo limite.',
    data: items,
    meta: Object.assign({ origin: 'ao-vivo' }, meta)
  };
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const now = Date.now();
  if (!event.forceRefresh && cache.payload && now - cache.at < CACHE_MS) {
    return json(200, Object.assign({}, cache.payload, { cached: true }), 240);
  }

  try {
    let payload = null;

    if (hasSupabase()) {
      try {
        payload = await fromDatabase();
      } catch (error) {
        console.error('market-news supabase', error.message);
      }
    }

    if (!payload) payload = await live();

    if (payload.success) cache = { at: now, payload };
    return json(payload.success ? 200 : 503, payload, payload.success ? 240 : 0);
  } catch (error) {
    console.error('market-news', error);
    if (cache.payload) return json(200, Object.assign({}, cache.payload, { stale: true }), 60);
    return json(503, {
      success: false,
      source: 'Feeds RSS publicos',
      status: 'unavailable',
      error: 'Nenhum feed respondeu dentro do tempo limite.',
      data: []
    }, 0);
  }
};
