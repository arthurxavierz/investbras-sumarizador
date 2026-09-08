'use strict';

const { json, preflight, timeoutFetch, retryFetch } = require('./_utils');

/** 1 saca de 60 kg = 132,2774 libras. Base das conversoes para R$/saca. */
const LB_PER_BAG = 132.2774;
const KG_PER_BAG = 60;

const ASSETS = [
  { id: 'coffee-c', name: 'Cafe arabica', symbol: 'KC=F', contract: 'KC (ICE NY)', unit: 'c/lb', group: 'cafe', source: 'ICE via Yahoo Finance' },
  { id: 'usd-brl', name: 'Dolar spot', symbol: 'BRL=X', unit: 'BRL', group: 'cambio', source: 'Yahoo Finance' },
  { id: 'ibovespa', name: 'Ibovespa', symbol: '^BVSP', unit: 'pts', group: 'bolsas', source: 'B3 via Yahoo Finance' },
  { id: 'sp500', name: 'S&P 500', symbol: '^GSPC', unit: 'pts', group: 'bolsas', source: 'Yahoo Finance' },
  { id: 'nasdaq', name: 'Nasdaq', symbol: '^IXIC', unit: 'pts', group: 'bolsas', source: 'Yahoo Finance' },
  { id: 'hang-seng', name: 'Hang Seng', symbol: '^HSI', unit: 'pts', group: 'bolsas', source: 'Yahoo Finance' },
  { id: 'sugar', name: 'Acucar', symbol: 'SB=F', unit: 'c/lb', group: 'commodities', source: 'ICE via Yahoo Finance' },
  { id: 'oil-wti', name: 'Petroleo WTI', symbol: 'CL=F', unit: 'USD/bbl', group: 'commodities', source: 'NYMEX via Yahoo Finance' },
  { id: 'gold', name: 'Ouro', symbol: 'GC=F', unit: 'USD/oz', group: 'commodities', source: 'COMEX via Yahoo Finance' },
  { id: 'soybean', name: 'Soja', symbol: 'ZS=F', unit: 'c/bu', group: 'commodities', source: 'CBOT via Yahoo Finance' },
  { id: 'corn', name: 'Milho', symbol: 'ZC=F', unit: 'c/bu', group: 'commodities', source: 'CBOT via Yahoo Finance' }
];

// O Yahoo nao serve robusta em simbolo publico estavel. Quando a mesa tiver
// uma fonte propria, basta apontar ROBUSTA_SYMBOL para o ticker correspondente.
if (process.env.ROBUSTA_SYMBOL) {
  ASSETS.splice(1, 0, {
    id: 'coffee-robusta',
    name: 'Cafe robusta',
    symbol: process.env.ROBUSTA_SYMBOL,
    contract: process.env.ROBUSTA_CONTRACT || 'Robusta',
    unit: process.env.ROBUSTA_UNIT || 'USD/t',
    group: 'cafe',
    source: 'Fonte configurada'
  });
}

const BY_SYMBOL = new Map(ASSETS.map(asset => [asset.symbol, asset]));

/**
 * Cache no escopo do modulo. O Netlify reaproveita containers quentes, entao
 * isso evita bater no limite de requisicoes do Yahoo a cada visita.
 */
const CACHE_MS = 90 * 1000;
const STALE_MS = 20 * 60 * 1000;
let cache = { at: 0, payload: null };

const unavailable = (asset, error) => ({
  ...asset,
  value: null,
  change: null,
  changePercent: null,
  high: null,
  low: null,
  open: null,
  previousClose: null,
  series: [],
  fetchedAt: new Date().toISOString(),
  status: 'unavailable',
  error
});

const percent = (value, previous) => (
  Number.isFinite(value) && Number.isFinite(previous) && previous !== 0
    ? ((value - previous) / previous) * 100
    : null
);

/** Serie compacta para o sparkline. Mantem no maximo 60 pontos. */
const compactSeries = values => {
  const clean = (values || []).filter(point => Number.isFinite(point));
  if (clean.length <= 60) return clean;
  const step = clean.length / 60;
  return Array.from({ length: 60 }, (_, index) => clean[Math.floor(index * step)]);
};

const fromChart = (asset, result) => {
  const meta = result && result.meta;
  const price = meta && meta.regularMarketPrice;
  if (!Number.isFinite(price)) throw new Error('Resposta sem preco regular');

  const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
  const closes = (quote && quote.close) || (result.close) || [];

  // A janela de 5 dias torna chartPreviousClose inutil para a variacao do dia,
  // entao o percentual sai do proprio metadado da sessao regular.
  const metaPercent = Number.isFinite(meta.regularMarketChangePercent) ? meta.regularMarketChangePercent : null;
  let previousClose = Number.isFinite(meta.previousClose) ? meta.previousClose : null;
  if (previousClose === null && metaPercent !== null && metaPercent !== -100) {
    previousClose = price / (1 + metaPercent / 100);
  }
  if (previousClose === null && Number.isFinite(meta.chartPreviousClose)) {
    previousClose = meta.chartPreviousClose;
  }

  return Object.assign({}, asset, {
    value: price,
    change: Number.isFinite(previousClose) ? price - previousClose : null,
    changePercent: metaPercent !== null ? metaPercent : percent(price, previousClose),
    high: meta.regularMarketDayHigh != null ? meta.regularMarketDayHigh : null,
    low: meta.regularMarketDayLow != null ? meta.regularMarketDayLow : null,
    open: meta.regularMarketOpen != null ? meta.regularMarketOpen : null,
    previousClose,
    currency: meta.currency || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    series: compactSeries(closes),
    fetchedAt: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
    status: 'available'
  });
};

/** Uma chamada cobre todos os simbolos e reduz muito o risco de bloqueio. */
const fetchSpark = async symbols => {
  const list = symbols.map(encodeURIComponent).join(',');
  const url = 'https://query1.finance.yahoo.com/v7/finance/spark?symbols=' + list + '&range=5d&interval=1h';
  const response = await retryFetch(url, {}, 8000, 2);
  const payload = await response.json();
  const rows = Array.isArray(payload)
    ? payload
    : (payload && payload.spark && payload.spark.result) || Object.values(payload || {});

  const found = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = (row.response && row.response[0]) || row;
    const symbol = (item.meta && item.meta.symbol) || row.symbol;
    const asset = BY_SYMBOL.get(symbol);
    if (!asset || !item.meta) continue;
    try {
      found.set(symbol, fromChart(asset, item));
    } catch {
      continue;
    }
  }
  return found;
};

const fetchChart = async (asset, range) => {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
    + encodeURIComponent(asset.symbol) + '?range=' + (range || '5d') + '&interval=1h';
  const response = await retryFetch(url, {}, 8000, 2);
  const payload = await response.json();
  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  if (!result) throw new Error('Sem serie retornada pela fonte');
  return fromChart(asset, result);
};

const bcbDate = offsetDays => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offsetDays);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return mm + '-' + dd + '-' + date.getUTCFullYear();
};

const fetchPtax = async () => {
  for (let offset = 0; offset < 8; offset += 1) {
    const url = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)'
      + '?@dataCotacao=%27' + bcbDate(offset) + '%27&$top=1&$format=json';
    try {
      const response = await timeoutFetch(url, {}, 6000);
      if (!response.ok) continue;
      const body = await response.json();
      const quote = body && body.value && body.value[0];
      if (!quote || !quote.cotacaoVenda) continue;
      return {
        id: 'usd-ptax',
        name: 'Dolar PTAX',
        symbol: 'USD/BRL',
        unit: 'BRL',
        group: 'cambio',
        value: quote.cotacaoVenda,
        buy: quote.cotacaoCompra != null ? quote.cotacaoCompra : null,
        change: null,
        changePercent: null,
        high: null,
        low: null,
        open: null,
        previousClose: null,
        series: [],
        currency: 'BRL',
        source: 'Banco Central do Brasil',
        fetchedAt: quote.dataHoraCotacao
          ? new Date(String(quote.dataHoraCotacao).replace(' ', 'T') + '-03:00').toISOString()
          : new Date().toISOString(),
        status: 'available'
      };
    } catch {
      continue;
    }
  }
  return null;
};

/** Series abertas do Banco Central: Selic meta e IPCA mensal. */
const fetchSgs = async (code, label, unit) => {
  try {
    const url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + code + '/dados/ultimos/1?formato=json';
    const response = await timeoutFetch(url, {}, 5000);
    if (!response.ok) return null;
    const rows = await response.json();
    const row = rows && rows[0];
    if (!row || !row.valor) return null;
    return {
      id: 'sgs-' + code,
      label,
      value: Number(row.valor),
      unit,
      reference: String(row.data),
      source: 'Banco Central do Brasil'
    };
  } catch {
    return null;
  }
};

/**
 * Equivalencia em R$/saca de 60 kg. Sao apenas as duas cotacoes reais
 * multiplicadas, nunca um preco de mercado fisico.
 */
const bagEquivalents = (assets, usdBrl) => {
  if (!Number.isFinite(usdBrl)) return [];
  const equivalents = [];

  const arabica = assets.find(asset => asset.id === 'coffee-c');
  if (arabica && arabica.status === 'available') {
    equivalents.push({
      id: 'arabica-bag',
      name: 'Arabica equivalente',
      reference: 'ICE Nova York',
      value: (arabica.value / 100) * LB_PER_BAG * usdBrl,
      changePercent: arabica.changePercent,
      unit: 'BRL/saca 60kg',
      formula: '(' + arabica.value + ' c/lb / 100) x ' + LB_PER_BAG + ' lb x ' + usdBrl.toFixed(4)
    });
  }

  const robusta = assets.find(asset => asset.id === 'coffee-robusta');
  if (robusta && robusta.status === 'available') {
    equivalents.push({
      id: 'robusta-bag',
      name: 'Robusta equivalente',
      reference: 'ICE Londres',
      value: (robusta.value / 1000) * KG_PER_BAG * usdBrl,
      changePercent: robusta.changePercent,
      unit: 'BRL/saca 60kg',
      formula: '(' + robusta.value + ' USD/t / 1000) x ' + KG_PER_BAG + ' kg x ' + usdBrl.toFixed(4)
    });
  }

  return equivalents;
};

const buildPayload = async () => {
  let quotes = new Map();

  try {
    quotes = await fetchSpark(ASSETS.map(asset => asset.symbol));
  } catch {
    quotes = new Map();
  }

  // O cafe arabica precisa de OHLC completo, entao sempre usa a serie detalhada.
  try {
    quotes.set('KC=F', await fetchChart(BY_SYMBOL.get('KC=F'), '5d'));
  } catch {
    /* mantem o que veio do spark, se houver */
  }

  // Complementa apenas o que faltou, em serie, para nao disparar bloqueio.
  for (const asset of ASSETS) {
    if (quotes.has(asset.symbol)) continue;
    try {
      quotes.set(asset.symbol, await fetchChart(asset, '5d'));
    } catch (error) {
      quotes.set(asset.symbol, unavailable(asset, 'Fonte indisponivel: ' + error.message));
    }
  }

  const yahooAssets = ASSETS.map(asset => quotes.get(asset.symbol) || unavailable(asset, 'Sem resposta da fonte.'));

  const results = await Promise.all([
    fetchPtax(),
    fetchSgs(432, 'Selic meta', '% a.a.'),
    fetchSgs(433, 'IPCA no mes', '%')
  ]);
  const ptax = results[0];
  const macro = [results[1], results[2]].filter(Boolean);

  // PTAX entra logo depois dos contratos de cafe, antes do restante.
  const coffeeCount = ASSETS.filter(asset => asset.group === 'cafe').length;
  const assets = ptax
    ? yahooAssets.slice(0, coffeeCount).concat([ptax], yahooAssets.slice(coffeeCount))
    : yahooAssets;

  const spot = yahooAssets.find(asset => asset.id === 'usd-brl');
  const usdBrl = spot && spot.status === 'available' ? spot.value : (ptax ? ptax.value : null);

  const available = assets.filter(asset => asset.status === 'available').length;
  const status = available === assets.length ? 'available' : available > 0 ? 'partial' : 'unavailable';

  return {
    success: available > 0,
    source: 'Investbras market-data',
    status,
    error: available > 0 ? null : 'Nenhuma fonte publica respondeu dentro do tempo limite.',
    data: {
      assets,
      coffee: assets.find(asset => asset.id === 'coffee-c') || null,
      robusta: assets.find(asset => asset.id === 'coffee-robusta') || null,
      bagEquivalents: bagEquivalents(assets, usdBrl),
      macro,
      usdBrlReference: Number.isFinite(usdBrl) ? usdBrl : null,
      activeSources: available,
      totalSources: assets.length
    }
  };
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const now = Date.now();
  if (!event.forceRefresh && cache.payload && now - cache.at < CACHE_MS) {
    return json(200, Object.assign({}, cache.payload, { cached: true }), 60);
  }

  try {
    const payload = await buildPayload();
    if (payload.success) cache = { at: now, payload };
    return json(payload.success ? 200 : 503, payload, payload.success ? 60 : 0);
  } catch (error) {
    console.error('market-data', error);
    if (cache.payload && now - cache.at < STALE_MS) {
      return json(200, Object.assign({}, cache.payload, {
        status: 'stale',
        stale: true,
        error: 'Fontes instaveis agora. Exibindo a ultima leitura valida.'
      }), 30);
    }
    return json(503, {
      success: false,
      source: 'Investbras market-data',
      status: 'unavailable',
      error: 'Nenhuma fonte publica respondeu dentro do tempo limite.',
      data: { assets: [], coffee: null, robusta: null, bagEquivalents: [], macro: [], activeSources: 0, totalSources: ASSETS.length }
    }, 0);
  }
};

exports.ASSETS = ASSETS;
