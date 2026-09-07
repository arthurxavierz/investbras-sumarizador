'use strict';

const { json, preflight, fail, hasSupabase, supabase } = require('./_utils');
const { requireSession } = require('./_auth');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  try {
    requireSession(event);

    if (!hasSupabase()) {
      return json(200, {
        success: false,
        status: 'not-configured',
        error: 'Base de inscritos indisponivel sem Supabase.',
        data: { active: 0, unsubscribed: 0, total: 0, latest: [], campaigns: [] }
      }, 0);
    }

    const [active, unsubscribed, latest, campaigns] = await Promise.all([
      supabase('subscribers', { query: { select: 'email', status: 'eq.active', limit: '5000' } }),
      supabase('subscribers', { query: { select: 'email', status: 'eq.unsubscribed', limit: '5000' } }),
      supabase('subscribers', { query: { select: 'email,organization,created_at', order: 'created_at.desc', limit: '8' } }),
      supabase('email_campaigns', { query: { select: 'subject,status,recipient_count,is_test,sent_at', order: 'created_at.desc', limit: '8' } })
    ]);

    const activeCount = (active || []).length;
    const unsubscribedCount = (unsubscribed || []).length;

    return json(200, {
      success: true,
      source: 'Supabase',
      status: 'available',
      data: {
        active: activeCount,
        unsubscribed: unsubscribedCount,
        total: activeCount + unsubscribedCount,
        latest: latest || [],
        campaigns: campaigns || []
      }
    }, 0);
  } catch (error) {
    return fail(error, 'Nao foi possivel ler a base de inscritos.');
  }
};
