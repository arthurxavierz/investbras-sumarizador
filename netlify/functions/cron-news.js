'use strict';

/**
 * Coleta agendada de noticias.
 *
 * Roda de 20 em 20 minutos, com folga de tempo para abrir as materias atras
 * de capa e linha fina, e grava o resultado no Supabase. A funcao publica so
 * le a tabela, entao a pagina nunca espera por feed lento nem estoura o
 * limite de 10 segundos do Netlify.
 */

const { json, hasSupabase, supabase, log } = require('./_utils');
const { collect } = require('./_news');

const toRow = item => ({
  title: item.title,
  summary: item.excerpt || null,
  dek: item.dek || null,
  category: item.category,
  source: item.source,
  source_domain: item.sourceDomain || null,
  url: item.url,
  image_url: item.image || null,
  image_kind: item.imageKind || null,
  relevance: item.relevance,
  published_at: item.publishedAt,
  fetched_at: new Date().toISOString()
});

const run = async () => {
  const started = Date.now();
  const { items, meta } = await collect({
    feedTimeout: 9000,
    enrichCount: 14,
    enrichTimeout: 7000
  });

  if (!items.length) {
    await log('warning', 'news', 'Coleta sem resultado', meta);
    return { stored: 0, meta, elapsedMs: Date.now() - started };
  }

  if (!hasSupabase()) {
    return { stored: 0, meta, elapsedMs: Date.now() - started, skipped: 'supabase-nao-configurado' };
  }

  // url tem restricao unica, entao a mesma materia so atualiza a linha dela.
  await supabase('news_items', {
    method: 'POST',
    body: items.map(toRow),
    prefer: 'resolution=merge-duplicates,return=minimal'
  });

  try {
    await supabase('rpc/purge_old_news', { method: 'POST', body: { days: 14 } });
  } catch {
    /* limpeza nao pode derrubar a coleta */
  }

  await log('info', 'news', 'Coleta concluida', {
    stored: items.length,
    withPhoto: meta.withPhoto,
    failures: meta.failures
  });

  return { stored: items.length, meta, elapsedMs: Date.now() - started };
};

exports.handler = async () => {
  try {
    const result = await run();
    return json(200, {
      success: true,
      source: 'investbras-cron-news',
      status: 'collected',
      message: 'Coleta executada.',
      data: result
    }, 0);
  } catch (error) {
    console.error('cron-news', error);
    await log('error', 'news', 'Coleta falhou', { message: error.message });
    return json(500, {
      success: false,
      source: 'investbras-cron-news',
      status: 'failed',
      error: 'Nao foi possivel concluir a coleta.'
    }, 0);
  }
};

exports.run = run;
