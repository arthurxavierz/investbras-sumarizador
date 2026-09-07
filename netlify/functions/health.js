'use strict';

const { json, preflight, hasSupabase } = require('./_utils');
const { authConfigured, supabaseAuthConfigured } = require('./_auth');

const check = (ok, ready, pending) => ({ ok, detail: ok ? ready : pending });

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const checks = {
    session: check(
      (process.env.SESSION_SECRET || '').length >= 24,
      'SESSION_SECRET definido.',
      'Defina SESSION_SECRET com 24+ caracteres para liberar o painel.'
    ),
    auth: check(
      authConfigured(),
      supabaseAuthConfigured() ? 'Supabase Auth ativo.' : 'Operador unico por ADMIN_EMAIL.',
      'Configure Supabase Auth ou ADMIN_EMAIL e ADMIN_PASSWORD.'
    ),
    database: check(
      hasSupabase(),
      'Supabase conectado para edicoes e inscritos.',
      'Sem SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY. Publicacao fica local ao navegador.'
    ),
    email: check(
      Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
      'Resend pronto para disparo.',
      'Configure RESEND_API_KEY e EMAIL_FROM para enviar a edicao.'
    ),
    ai: check(
      Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY),
      'Geracao assistida disponivel.',
      'Sem chave de IA. O rascunho sai apenas em modo tecnico.'
    ),
    agenda: check(
      true,
      process.env.AGENDA_ICS_URLS ? 'IBGE e calendarios ICS proprios.' : 'Calendario oficial do IBGE.',
      ''
    ),
    news: check(
      true,
      process.env.NEWS_RSS_FEEDS ? 'Feeds proprios configurados.' : 'Feeds publicos padrao.',
      ''
    )
  };

  const required = ['session', 'auth'];
  const blocked = required.filter(key => !checks[key].ok);

  return json(200, {
    success: blocked.length === 0,
    source: 'investbras-intelligence',
    status: blocked.length === 0 ? 'available' : 'partial',
    error: blocked.length ? 'Pendencias de configuracao: ' + blocked.join(', ') + '.' : null,
    data: { runtime: 'netlify-functions', checks }
  }, 0);
};
