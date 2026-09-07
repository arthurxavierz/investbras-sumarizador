'use strict';

const { json, preflight, timeoutFetch, retryFetch, decodeEntities } = require('./_utils');

const DEFAULT_FEEDS = [
  // Busca dedicada ao cafe. Garante cobertura do tema central da mesa.
  'https://news.google.com/rss/search?q=%22caf%C3%A9%22+(mercado+OR+arabica+OR+saca+OR+exporta%C3%A7%C3%A3o)&hl=pt-BR&gl=BR&ceid=BR:pt-419',
  'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml',
  'https://agenciabrasil.ebc.com.br/rss/internacional/feed.xml',
  'https://www.canalrural.com.br/feed/',
  'https://www.moneytimes.com.br/feed/',
  'https://www.infomoney.com.br/feed/'
];

const CACHE_MS = 8 * 60 * 1000;
let cache = { at: 0, payload: null };

const feeds = () => String(process.env.NEWS_RSS_FEEDS || DEFAULT_FEEDS.join(','))
  .split(',')
  .map(item => item.trim())
  .filter(Boolean)
  .slice(0, 8);

/**
 * Peso editorial da mesa: cafe primeiro, depois cadeia agro, macro e cambio.
 * Serve para ordenar o feed, nunca para reescrever a manchete.
 */
const TOPICS = [
  { tag: 'Cafe', weight: 60, terms: ['cafe', 'café', 'arabica', 'arábica', 'robusta', 'conilon', 'coffee', 'cafeeiro'] },
  { tag: 'Agro', weight: 30, terms: ['safra', 'agro', 'agronegocio', 'agronegócio', 'lavoura', 'colheita', 'fertilizante', 'defensivo', 'soja', 'milho', 'acucar', 'açúcar', 'cooperativa', 'exportacao', 'exportação', 'commodities'] },
  { tag: 'Cambio', weight: 24, terms: ['dolar', 'dólar', 'cambio', 'câmbio', 'ptax'] },
  { tag: 'Juros', weight: 20, terms: ['copom', 'selic', 'juros', 'fed', 'inflacao', 'inflação', 'ipca', 'banco central'] },
  { tag: 'Energia', weight: 16, terms: ['petroleo', 'petróleo', 'diesel', 'combustivel', 'combustível', 'frete', 'fretes'] },
  { tag: 'Global', weight: 12, terms: ['china', 'estados unidos', 'europa', 'tarifa', 'tarifas', 'guerra', 'sancao', 'sanção', 'geopolitica', 'geopolítica'] }
];

const WORD_EDGE = '[^a-z0-9áàâãéêíóôõúüç]';

/** Casa termo inteiro. Evita que "real" dentro de "realizar" vire cambio. */
const mentions = (haystack, term) => new RegExp(
  '(^|' + WORD_EDGE + ')' + term + '(' + WORD_EDGE + '|$)', 'i'
).test(haystack);

const readAttribute = (xml, name) => {
  const match = xml.match(new RegExp(name + '=["\']([^"\']+)["\']', 'i'));
  return match ? decodeEntities(match[1]) : '';
};

const tag = (xml, name) => {
  const match = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  return match ? decodeEntities(match[1]) : '';
};

const firstImageFromHtml = html => {
  const match = String(html || '').match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? decodeEntities(match[1]) : '';
};

const isGenericImage = url => {
  const value = String(url || '').toLowerCase();
  if (!value) return true;
  return value.endsWith('.svg')
    || value.includes('/logo')
    || value.includes('logo-')
    || value.includes('placeholder')
    || value.includes('avatar')
    || value.includes('gravatar')
    || value.includes('assets-ebc')
    || value.includes('/ebc.png')
    || value.includes('/ebc.gif');
};

const imageFromItem = (block, itemUrl, sourceUrl) => {
  const media = (block.match(/<media:(?:content|thumbnail)[^>]+>/i) || [])[0];
  const enclosure = (block.match(/<enclosure[^>]+>/i) || [])[0];
  const candidates = [
    tag(block, 'imagem-destaque'),
    media ? readAttribute(media, 'url') : '',
    enclosure && /type=["']image\//i.test(enclosure) ? readAttribute(enclosure, 'url') : '',
    firstImageFromHtml(tag(block, 'content:encoded')),
    firstImageFromHtml(tag(block, 'description'))
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const absolute = new URL(candidate, itemUrl || sourceUrl).toString();
      if (!isGenericImage(absolute)) return absolute;
    } catch {
      continue;
    }
  }
  return '';
};

const classify = item => {
  const haystack = (item.title + ' ' + item.summary).toLowerCase();
  let score = 0;
  let topic = 'Mercado';

  for (const entry of TOPICS) {
    if (entry.terms.some(term => mentions(haystack, term))) {
      score += entry.weight;
      if (topic === 'Mercado') topic = entry.tag;
    }
  }

  const publishedAt = item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
  const hoursOld = publishedAt ? (Date.now() - publishedAt) / 3600000 : 72;
  return { topic, score: score - Math.min(hoursOld, 72) * 0.6 };
};

const parseItems = (xml, sourceUrl) => {
  const host = new URL(sourceUrl).hostname.replace(/^www\./, '');
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  return blocks.map(block => {
    const url = tag(block, 'link');
    const published = tag(block, 'pubDate');
    const parsedDate = published ? new Date(published) : null;

    let title = tag(block, 'title');
    let source = host;
    if (host === 'news.google.com') {
      const split = title.lastIndexOf(' - ');
      if (split > 20) {
        source = title.slice(split + 3).trim();
        title = title.slice(0, split).trim();
      }
    }

    const item = {
      title,
      summary: tag(block, 'description').slice(0, 320),
      url,
      image: imageFromItem(block, url, sourceUrl),
      source,
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
      fetchedAt: new Date().toISOString()
    };

    const classification = classify(item);
    item.category = classification.topic;
    item.relevance = classification.score;
    return item;
  }).filter(item => item.title && item.url);
};

const imageFromArticle = async item => {
  if (item.image && !isGenericImage(item.image)) return item;
  if (process.env.NEWS_FETCH_IMAGES === 'false') return Object.assign({}, item, { image: '' });

  try {
    const response = await timeoutFetch(item.url, { headers: { Accept: 'text/html,*/*' } }, 4000);
    if (!response.ok) return Object.assign({}, item, { image: '' });
    const html = await response.text();
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (!og || !og[1]) return Object.assign({}, item, { image: '' });
    const image = new URL(decodeEntities(og[1]), item.url).toString();
    return Object.assign({}, item, { image: isGenericImage(image) ? '' : image });
  } catch {
    return Object.assign({}, item, { image: '' });
  }
};

const buildPayload = async () => {
  const list = feeds();
  const results = await Promise.allSettled(list.map(async feed => {
    const response = await retryFetch(feed, { headers: { Accept: 'application/rss+xml,text/xml,*/*' } }, 7000, 2);
    return parseItems(await response.text(), feed);
  }));

  const seen = new Set();
  const ranked = results
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value)
    .filter(item => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.relevance - a.relevance);

  // O cafe lidera, mas cambio, juros e cadeia global precisam de espaco proprio.
  // Sem essa reserva a busca dedicada ocupa o feed inteiro.
  const coffee = ranked.filter(item => item.category === 'Cafe').slice(0, 10);
  const rest = ranked.filter(item => item.category !== 'Cafe').slice(0, 8);
  const items = coffee.concat(rest).sort((a, b) => b.relevance - a.relevance);

  const enrichedTop = await Promise.all(items.slice(0, 8).map(imageFromArticle));
  const enriched = enrichedTop.concat(items.slice(8));

  const failures = results.filter(result => result.status === 'rejected').length;

  return {
    success: enriched.length > 0,
    source: 'Feeds RSS publicos',
    status: enriched.length ? (failures ? 'partial' : 'available') : 'unavailable',
    error: enriched.length ? null : 'Nenhum feed respondeu dentro do tempo limite.',
    data: enriched,
    meta: { feeds: list.length, failures, coffeeItems: enriched.filter(item => item.category === 'Cafe').length }
  };
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const now = Date.now();
  if (cache.payload && now - cache.at < CACHE_MS) {
    return json(200, Object.assign({}, cache.payload, { cached: true }), 240);
  }

  try {
    const payload = await buildPayload();
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
