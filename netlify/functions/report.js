'use strict';

const { json, preflight, fail, hasSupabase, supabase } = require('./_utils');

const CACHE_MS = 60 * 1000;
let cache = { at: 0, payload: null };

const shape = row => ({
  id: row.id,
  title: row.title,
  summary: row.summary,
  editionDate: row.edition_date,
  publishedAt: row.published_at,
  updatedAt: row.updated_at,
  author: row.author_name || null,
  sections: row.content || {}
});

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  if (!hasSupabase()) {
    return json(200, {
      success: false,
      source: 'Supabase',
      status: 'not-configured',
      error: 'Persistencia de edições desativada. Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.',
      data: null
    }, 0);
  }

  const now = Date.now();
  if (cache.payload && now - cache.at < CACHE_MS) {
    return json(200, Object.assign({}, cache.payload, { cached: true }), 60);
  }

  try {
    const rows = await supabase('market_reports', {
      query: {
        select: 'id,title,summary,content,edition_date,published_at,updated_at,author_name',
        status: 'eq.published',
        order: 'published_at.desc',
        limit: '1'
      }
    });

    const row = rows && rows[0];
    const payload = {
      success: Boolean(row),
      source: 'Supabase',
      status: row ? 'published' : 'empty',
      error: row ? null : 'Nenhuma edição publicada até agora.',
      data: row ? shape(row) : null
    };

    if (row) cache = { at: now, payload };
    return json(200, payload, row ? 60 : 0);
  } catch (error) {
    return fail(error, 'Não foi possível ler a última edição publicada.');
  }
};

exports.invalidate = () => { cache = { at: 0, payload: null }; };
