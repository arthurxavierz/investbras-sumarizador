'use strict';

/**
 * Mercado fisico e clima das regioes produtoras.
 *
 * Duas fontes que faltavam para a mesa fechar a leitura do cafe:
 *
 * 1. Indicadores CEPEA/ESALQ, que sao a referencia de preco fisico no Brasil.
 *    A bolsa de Nova York diz quanto vale o contrato; o CEPEA diz quanto vale
 *    a saca aqui. A diferenca entre os dois e o que a mesa negocia.
 *
 * 2. Clima nas quatro pracas produtoras. Geada no Sul de Minas e chuva na
 *    florada mexem no preco antes de qualquer relatorio sair.
 *
 * Fica separado de market-data de proposito: se o CEPEA cair, as cotacoes de
 * bolsa continuam chegando, e vice-versa.
 */

const { json, preflight, timeoutFetch, retryFetch } = require('./_utils');

const CACHE_MS = 30 * 60 * 1000;
let cache = { at: 0, payload: null };

/* ------------------------------------------------------- CEPEA / ESALQ */

const CEPEA_WIDGET = 'https://www.cepea.org.br/br/widgetproduto.js.php'
  + '?fonte=arial&tamanho=10&largura=400px&id_indicador[]=';

const INDICATORS = [
  { id: 23, key: 'arabica', name: 'Cafe arabica', unit: 'BRL/saca 60kg', highlight: true },
  { id: 24, key: 'robusta', name: 'Cafe robusta', unit: 'BRL/saca 60kg', highlight: true },
  { id: 53, key: 'sugar', name: 'Acucar cristal SP', unit: 'BRL/saca 50kg', highlight: false },
  { id: 2, key: 'cattle', name: 'Boi gordo', unit: 'BRL/arroba', highlight: false }
];

/** "1.659,93" no formato brasileiro vira 1659.93. */
const parseBrNumber = value => {
  const clean = String(value || '').replace(/\./g, '').replace(',', '.');
  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
};

const parseIsoDate = value => {
  const match = String(value || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return match[3] + '-' + match[2] + '-' + match[1];
};

const fetchIndicator = async indicator => {
  try {
    // O indicador de arabica e o numero central do produto, entao vale mais
    // uma tentativa nele do que nos demais.
    const attempts = indicator.highlight ? 3 : 2;
    const response = await retryFetch(CEPEA_WIDGET + indicator.id, {
      headers: { Accept: 'text/javascript,*/*' },
      redirect: 'follow'
    }, 8000, attempts);

    const raw = (await response.text()).replace(/\\n/g, ' ').replace(/\\t/g, ' ');
    const body = (raw.match(/<tbody>[\s\S]*?<\/tbody>/i) || [''])[0];
    const spans = Array.from(body.matchAll(/<span class="maior">([^<]+)<\/span>/g), match => match[1].trim());
    if (spans.length < 2) throw new Error('Widget sem linha de valor');

    const value = parseBrNumber(spans[spans.length - 1]);
    if (value === null) throw new Error('Valor nao numerico');

    return {
      key: indicator.key,
      name: indicator.name,
      label: spans[0],
      value,
      unit: indicator.unit,
      highlight: indicator.highlight,
      referenceDate: parseIsoDate(body),
      source: 'CEPEA/ESALQ',
      status: 'available'
    };
  } catch (error) {
    return {
      key: indicator.key,
      name: indicator.name,
      value: null,
      unit: indicator.unit,
      highlight: indicator.highlight,
      referenceDate: null,
      source: 'CEPEA/ESALQ',
      status: 'unavailable',
      error: 'Indicador indisponivel: ' + error.message
    };
  }
};

/* ------------------------------------------------------------- clima */

const REGIONS = [
  { key: 'sul-minas', name: 'Sul de Minas', city: 'Varginha', crop: 'Arabica', lat: -21.55, lon: -45.43 },
  { key: 'cerrado', name: 'Cerrado Mineiro', city: 'Patrocinio', crop: 'Arabica', lat: -18.94, lon: -46.99 },
  { key: 'mogiana', name: 'Mogiana', city: 'Franca', crop: 'Arabica', lat: -20.54, lon: -47.40 },
  { key: 'espirito-santo', name: 'Espirito Santo', city: 'Linhares', crop: 'Conilon', lat: -19.39, lon: -40.07 }
];

const sum = values => values.reduce((total, value) => total + (Number(value) || 0), 0);

/**
 * Geada e o risco que mais move o preco do arabica. Abaixo de 4 graus ja ha
 * risco em cultivo baixo; abaixo de 2, risco severo. O limiar e declarado na
 * resposta para a interface nao precisar adivinhar.
 */
const frostRisk = minimum => {
  if (minimum === null) return 'desconhecido';
  if (minimum <= 2) return 'severo';
  if (minimum <= 4) return 'atencao';
  if (minimum <= 7) return 'observar';
  return 'sem risco';
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
      return Object.assign({}, region, { status: 'unavailable', error: 'Sem retorno para a praca.' });
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

/* ------------------------------------------------------------ payload */

const buildPayload = async () => {
  const [indicatorResults, weatherResult] = await Promise.all([
    Promise.all(INDICATORS.map(fetchIndicator)),
    fetchWeather().catch(() => null)
  ]);

  const available = indicatorResults.filter(item => item.status === 'available');
  const arabica = indicatorResults.find(item => item.key === 'arabica');

  return {
    success: available.length > 0 || Boolean(weatherResult),
    source: 'CEPEA/ESALQ e Open-Meteo',
    status: available.length === indicatorResults.length && weatherResult
      ? 'available'
      : (available.length || weatherResult ? 'partial' : 'unavailable'),
    error: available.length || weatherResult ? null : 'Nenhuma fonte de mercado fisico respondeu.',
    data: {
      indicators: indicatorResults,
      physicalArabica: arabica && arabica.status === 'available' ? arabica : null,
      weather: weatherResult || [],
      weatherAvailable: Boolean(weatherResult),
      activeIndicators: available.length,
      totalIndicators: indicatorResults.length
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
    if (payload.success) cache = { at: now, payload };
    return json(payload.success ? 200 : 503, payload, payload.success ? 900 : 0);
  } catch (error) {
    console.error('market-physical', error);
    if (cache.payload) return json(200, Object.assign({}, cache.payload, { stale: true }), 120);
    return json(503, {
      success: false,
      source: 'CEPEA/ESALQ e Open-Meteo',
      status: 'unavailable',
      error: 'Nenhuma fonte de mercado fisico respondeu.',
      data: { indicators: [], physicalArabica: null, weather: [], weatherAvailable: false }
    }, 0);
  }
};

exports.REGIONS = REGIONS;
