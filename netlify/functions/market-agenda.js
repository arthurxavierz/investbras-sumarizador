'use strict';

const { json, preflight, timeoutFetch, retryFetch, strip } = require('./_utils');

const CACHE_MS = 15 * 60 * 1000;
let cache = { at: 0, payload: null };

const DAYS_AHEAD = 21;

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo'
});

const dayFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Sao_Paulo'
});

const windowBounds = () => {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + DAYS_AHEAD);
  return { from, to };
};

const isoDate = date => date.toISOString().slice(0, 10);

const toEvent = ({ title, startsAt, source, category, allDay, url }) => ({
  title,
  startsAt: startsAt.toISOString(),
  day: dayFormatter.format(startsAt),
  time: allDay ? 'Dia todo' : timeFormatter.format(startsAt),
  allDay: Boolean(allDay),
  category: category || 'Agenda economica',
  source,
  url: url || null
});

/**
 * Calendario oficial de divulgacoes do IBGE. Cobre IPCA, PIB, PNAD e o
 * Levantamento Sistematico da Producao Agricola, que move o mercado de cafe.
 */
const RELEVANT_IBGE = [
  'ipca', 'inpc', 'pib', 'producao agricola', 'producao industrial',
  'pnad', 'comercio', 'servicos', 'custo', 'inpc', 'sistematico'
];

const fetchIbge = async () => {
  const { from, to } = windowBounds();
  const url = 'https://servicodados.ibge.gov.br/api/v3/calendario/?de=' + isoDate(from) + '&ate=' + isoDate(to);
  const response = await retryFetch(url, {}, 7000, 2);
  const payload = await response.json();
  const items = (payload && payload.items) || [];

  return items.map(item => {
    const raw = String(item.data_divulgacao || '');
    const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (!match) return null;

    const [, day, month, year, hour, minute] = match;
    const startsAt = new Date(
      year + '-' + month + '-' + day + 'T' + (hour || '09') + ':' + (minute || '00') + ':00-03:00'
    );
    if (Number.isNaN(startsAt.getTime())) return null;

    const title = strip(item.titulo || item.nome_produto);
    const relevant = RELEVANT_IBGE.some(term => title.toLowerCase().includes(term));

    return toEvent({
      title,
      startsAt,
      source: 'IBGE',
      category: relevant ? 'Indicador brasileiro' : 'Divulgacao IBGE',
      url: item.alias_produto ? 'https://www.ibge.gov.br/estatisticas/' + item.alias_produto + '.html' : null
    });
  }).filter(Boolean);
};

const unfoldIcs = text => String(text).replace(/\r?\n[ \t]/g, '');

const readField = (block, field) => {
  const match = block.match(new RegExp('^' + field + '(?:;[^:]*)?:(.*)$', 'mi'));
  return match ? match[1].trim() : '';
};

const parseIcsDate = value => {
  if (!value) return null;
  const match = String(value).replace('Z', '').match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(year + '-' + month + '-' + day + 'T' + (hour || '09') + ':' + (minute || '00') + ':00-03:00');
  return Number.isNaN(date.getTime()) ? null : { date, allDay: !hour };
};

const parseCalendar = (ics, source) => {
  const blocks = unfoldIcs(ics).match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  return blocks.map(block => {
    const parsed = parseIcsDate(readField(block, 'DTSTART'));
    if (!parsed) return null;
    return toEvent({
      title: strip(readField(block, 'SUMMARY')) || 'Evento economico',
      startsAt: parsed.date,
      allDay: parsed.allDay,
      source,
      category: 'Agenda configurada'
    });
  }).filter(Boolean);
};

const configuredCalendars = () => String(process.env.AGENDA_ICS_URLS || '')
  .split(',')
  .map(url => url.trim())
  .filter(Boolean)
  .slice(0, 5);

const fetchIcs = async url => {
  const response = await timeoutFetch(url, { headers: { Accept: 'text/calendar,text/plain,*/*' } }, 6500);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const host = new URL(url).hostname.replace(/^www\./, '');
  return parseCalendar(await response.text(), host);
};

const buildPayload = async () => {
  const sources = [];
  const tasks = [fetchIbge().then(items => { sources.push('IBGE'); return items; })];

  for (const url of configuredCalendars()) {
    tasks.push(fetchIcs(url).then(items => {
      sources.push(new URL(url).hostname.replace(/^www\./, ''));
      return items;
    }));
  }

  const results = await Promise.allSettled(tasks);
  const { from, to } = windowBounds();

  const seen = new Set();
  const items = results
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value)
    .filter(item => {
      const at = new Date(item.startsAt);
      return at >= from && at <= to;
    })
    .filter(item => {
      const key = item.startsAt.slice(0, 10) + '|' + item.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .slice(0, 24);

  const failures = results.filter(result => result.status === 'rejected').length;

  return {
    success: items.length > 0,
    source: sources.length ? sources.join(', ') : 'IBGE',
    status: items.length ? (failures ? 'partial' : 'available') : 'unavailable',
    error: items.length ? null : 'Nenhuma agenda respondeu. Configure AGENDA_ICS_URLS para somar calendarios proprios.',
    data: items
  };
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const now = Date.now();
  if (cache.payload && now - cache.at < CACHE_MS) {
    return json(200, Object.assign({}, cache.payload, { cached: true }), 300);
  }

  try {
    const payload = await buildPayload();
    if (payload.success) cache = { at: now, payload };
    return json(payload.success ? 200 : 503, payload, payload.success ? 300 : 0);
  } catch (error) {
    console.error('market-agenda', error);
    if (cache.payload) return json(200, Object.assign({}, cache.payload, { stale: true }), 60);
    return json(503, {
      success: false,
      source: 'Agenda economica',
      status: 'unavailable',
      error: 'Nenhuma agenda respondeu dentro do tempo limite.',
      data: []
    }, 0);
  }
};
