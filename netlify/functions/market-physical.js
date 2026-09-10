'use strict';

/**
 * Mercado físico e clima das regioes produtoras.
 *
 * Duas fontes que faltavam para a mesa fechar a leitura do café:
 *
 * 1. Indicadores de preço do mercado físico brasileiro: café arábica e
 *    robusta, soja, boi gordo e milho. A bolsa de Nova York diz quanto vale o
 *    contrato; o indicador diz quanto vale a saca aqui. A diferença entre as
 *    duas leituras é o que a mesa negocia.
 *
 * 2. Clima nas quatro praças produtoras. Geada no Sul de Minas e chuva na
 *    florada mexem no preço antes de qualquer relatório sair.
 *
 * Fica separado de market-data de propósito: se uma fonte cair, a outra
 * continua chegando.
 *
 * O último valor de cada indicador é gravado a cada coleta. Quando a fonte não
 * responde, a leitura anterior entra no lugar, sempre rotulada com a data de
 * referência e a idade em dias.
 */

const { json, preflight, timeoutFetch, hasSupabase, supabase } = require('./_utils');
const { collect: collectIndicators } = require('./_indicators');

const CACHE_MS = 30 * 60 * 1000;
let cache = { at: 0, payload: null };

/* ------------------------------------------------------------- clima */

const REGIONS = [
  { key: 'sul-minas', name: 'Sul de Minas', city: 'Varginha', crop: 'Arabica', lat: -21.55, lon: -45.43 },
  { key: 'cerrado', name: 'Cerrado Mineiro', city: 'Patrocínio', crop: 'Arabica', lat: -18.94, lon: -46.99 },
  { key: 'mogiana', name: 'Mogiana', city: 'Franca', crop: 'Arabica', lat: -20.54, lon: -47.40 },
  { key: 'espirito-santo', name: 'Espírito Santo', city: 'Linhares', crop: 'Conilon', lat: -19.39, lon: -40.07 }
];

const sum = values => values.reduce((total, value) => total + (Number(value) || 0), 0);

/**
 * Geada e o risco que mais move o preco do arabica. Abaixo de 4 graus já há
 * risco em cultivo baixo; abaixo de 2, risco severo. O limiar e declarado na
 * resposta para a interface não precisar adivinhar.
 */
const FROST_LABEL = {
  none: 'sem risco',
  watch: 'observar',
  alert: 'atenção',
  severe: 'risco severo',
  unknown: 'sem leitura'
};

const frostRisk = minimum => {
  if (minimum === null) return 'unknown';
  if (minimum <= 2) return 'severe';
  if (minimum <= 4) return 'alert';
  if (minimum <= 7) return 'watch';
  return 'none';
};

const fetchWeather = async () => {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + REGIONS.map(region => region.lat).join(',')
    + '&longitude=' + REGIONS.map(region => region.lon).join(',')
    + '&daily=temperature_2m_min,temperature_2m_max,precipitation_sum'
    + '&past_days=7&forecast_days=7&timezone=America%2FSao_Paulo';

  const response = await timeoutFetch(url, {}, 7000);
  if (!response.ok) throw new Error('HTTP ' + response.status);

  const payload = await response.json();
  const locations = Array.isArray(payload) ? payload : [payload];

  return REGIONS.map((region, index) => {
    const daily = locations[index] && locations[index].daily;
    if (!daily) {
      return Object.assign({}, region, { status: 'unavailable', error: 'Sem retorno para a praça.' });
    }

    // past_days=7 coloca os sete primeiros dias no passado e o resto a frente.
    const past = { rain: sum(daily.precipitation_sum.slice(0, 7)) };
    const ahead = {
      rain: sum(daily.precipitation_sum.slice(7)),
      minTemp: Math.min.apply(null, daily.temperature_2m_min.slice(7).filter(Number.isFinite)),
      maxTemp: Math.max.apply(null, daily.temperature_2m_max.slice(7).filter(Number.isFinite))
    };

    const minAhead = Number.isFinite(ahead.minTemp) ? ahead.minTemp : null;

    return Object.assign({}, region, {
      status: 'available',
      rainLast7: Math.round(past.rain * 10) / 10,
      rainNext7: Math.round(ahead.rain * 10) / 10,
      minTempNext7: minAhead,
      maxTempNext7: Number.isFinite(ahead.maxTemp) ? ahead.maxTemp : null,
      frostRisk: frostRisk(minAhead),
      source: 'Open-Meteo'
    });
  });
};

/* -------------------------------------------- último valor conhecido */

const storedIndicators = async () => {
  if (!hasSupabase()) return new Map();
  try {
    const rows = await supabase('physical_indicators', {
      query: { select: 'key,name,value,unit,reference_date,source,origin,change_percent,updated_at' }
    });
    return new Map((rows || []).map(row => [row.key, row]));
  } catch {
    return new Map();
  }
};

/** Guarda o que a coleta automática conseguiu, para servir de reserva depois. */
const persistIndicator = async item => {
  if (!hasSupabase() || item.status !== 'available' || !item.referenceDate) return;
  try {
    await supabase('physical_indicators', {
      method: 'POST',
      body: {
        key: item.key,
        name: item.name,
        value: item.value,
        unit: item.unit,
        reference_date: item.referenceDate,
        source: item.source,
        change_percent: item.changePercent,
        origin: 'auto',
        updated_at: new Date().toISOString()
      },
      prefer: 'resolution=merge-duplicates,return=minimal'
    });
  } catch {
    /* gravar a reserva nunca pode derrubar a leitura */
  }
};

/** Idade do dado em dias, para a interface dizer se já envelheceu. */
const ageInDays = referenceDate => {
  if (!referenceDate) return null;
  const reference = new Date(referenceDate + 'T12:00:00-03:00');
  if (Number.isNaN(reference.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - reference.getTime()) / 86400000));
};

/* ------------------------------------------------------------ payload */

const buildPayload = async () => {
  const [liveResults, weatherResult, stored] = await Promise.all([
    collectIndicators().catch(() => []),
    fetchWeather().catch(() => null),
    storedIndicators()
  ]);

  await Promise.all(liveResults.map(persistIndicator));

  // Quando a coleta automática falha, entra o último valor conhecido, sempre
  // rotulado com a data de referência e a origem.
  const indicatorResults = liveResults.map(item => {
    if (item.status === 'available') {
      return Object.assign({}, item, { origin: 'auto', ageDays: ageInDays(item.referenceDate) });
    }

    const fallback = stored.get(item.key);
    if (!fallback) return Object.assign({}, item, { origin: null, ageDays: null });

    return {
      key: item.key,
      name: fallback.name || item.name,
      value: Number(fallback.value),
      unit: fallback.unit || item.unit,
      highlight: item.highlight,
      changePercent: fallback.change_percent === null || fallback.change_percent === undefined
        ? null
        : Number(fallback.change_percent),
      referenceDate: fallback.reference_date,
      source: fallback.source || 'Notícias Agrícolas',
      origin: fallback.origin || 'manual',
      ageDays: ageInDays(fallback.reference_date),
      status: 'available',
      fromCache: true
    };
  });

  const available = indicatorResults.filter(item => item.status === 'available');
  const arabica = indicatorResults.find(item => item.key === 'arabica');

  return {
    success: available.length > 0 || Boolean(weatherResult),
    source: 'Indicadores do mercado físico e Open-Meteo',
    status: available.length === indicatorResults.length && weatherResult
      ? 'available'
      : (available.length || weatherResult ? 'partial' : 'unavailable'),
    error: available.length || weatherResult ? null : 'Nenhuma fonte de mercado físico respondeu.',
    data: {
      indicators: indicatorResults,
      physicalArabica: arabica && arabica.status === 'available' ? arabica : null,
      weather: weatherResult || [],
      weatherAvailable: Boolean(weatherResult),
      activeIndicators: available.length,
      totalIndicators: indicatorResults.length,
      liveIndicators: liveResults.filter(item => item.status === 'available').length,
      canCollectDirectly: liveResults.some(item => item.status === 'available')
    }
  };
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const now = Date.now();
  if (!event.forceRefresh && cache.payload && now - cache.at < CACHE_MS) {
    return json(200, Object.assign({}, cache.payload, { cached: true }), 900);
  }

  try {
    const payload = await buildPayload();
    // Cache curto quando nenhum indicador veio: não vale segurar meia hora um
    // resultado incompleto só porque o clima respondeu.
    const complete = payload.data.activeIndicators === payload.data.totalIndicators;
    if (payload.success) cache = { at: complete ? now : now - (CACHE_MS - 5 * 60 * 1000), payload };
    return json(payload.success ? 200 : 503, payload, payload.success ? (complete ? 900 : 300) : 0);
  } catch (error) {
    console.error('market-physical', error);
    if (cache.payload) return json(200, Object.assign({}, cache.payload, { stale: true }), 120);
    return json(503, {
      success: false,
      source: 'Indicadores do mercado físico e Open-Meteo',
      status: 'unavailable',
      error: 'Nenhuma fonte de mercado físico respondeu.',
      data: { indicators: [], physicalArabica: null, weather: [], weatherAvailable: false }
    }, 0);
  }
};

exports.REGIONS = REGIONS;
exports.FROST_LABEL = FROST_LABEL;
