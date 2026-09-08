'use strict';

/**
 * Coleta manual, disparada pelo botao "Atualizar informacoes" do painel.
 *
 * O Netlify bloqueia invocacao HTTP direta de funcao agendada, entao o cron
 * nao serve como gatilho da mesa. Esta funcao faz a mesma coleta com um
 * orcamento apertado, para caber no limite de 10 segundos de uma chamada
 * comum: feeds em paralelo com 5s e oito aberturas de materia com 3,5s.
 *
 * Se ainda assim estourar, nada se perde: a coleta agendada roda a cada
 * 20 minutos com folga bem maior.
 */

const { json, preflight, fail, requireMethod, hasSupabase, log } = require('./_utils');
const { requireSession } = require('./_auth');
const { collect, store } = require('./_news');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  try {
    requireMethod(event, ['POST']);
    const session = requireSession(event);

    const started = Date.now();
    const { items, meta } = await collect({
      feedTimeout: 5000,
      enrichCount: 8,
      enrichTimeout: 3500
    });

    if (!items.length) {
      return json(200, {
        success: false,
        source: 'investbras-collect-news',
        status: 'empty',
        error: 'Nenhum feed respondeu nesta tentativa. A coleta agendada tenta de novo em ate 20 minutos.',
        data: { stored: 0, meta }
      }, 0);
    }

    let stored = 0;
    let storeError = null;

    if (hasSupabase()) {
      try {
        stored = await store(items);
      } catch (error) {
        // Falha de gravacao nao invalida a coleta: a leitura ao vivo cobre.
        storeError = 'Coleta feita, mas a gravacao falhou. Confira se a migracao'
          + ' 0002_news_and_subscribers.sql ja foi aplicada no Supabase.';
        console.error('collect-news store', error.message);
      }
    } else {
      storeError = 'Supabase nao configurado: as noticias seguem em leitura ao vivo.';
    }

    await log('info', 'news', 'Coleta manual', {
      by: session.sub, collected: items.length, stored, failures: meta.failures
    });

    return json(200, {
      success: true,
      source: 'investbras-collect-news',
      status: stored ? 'stored' : 'collected',
      message: stored
        ? stored + ' materias atualizadas no banco.'
        : (storeError || items.length + ' materias coletadas.'),
      data: {
        collected: items.length,
        stored,
        storeError,
        elapsedMs: Date.now() - started,
        meta
      }
    }, 0);
  } catch (error) {
    return fail(error, 'Nao foi possivel atualizar as noticias agora.');
  }
};
