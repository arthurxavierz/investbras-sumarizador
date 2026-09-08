'use strict';

/**
 * Coleta e classificacao de noticias.
 *
 * A funcao publica /market-news roda dentro do limite de 10 segundos do
 * Netlify, entao ela nao pode buscar dez feeds e ainda abrir cada materia
 * atras de imagem. Este modulo concentra a logica e e usado por dois
 * caminhos: a coleta agendada, que tem folga de tempo e grava no Supabase,
 * e a coleta ao vivo, usada como reserva quando o banco esta vazio.
 */

const { timeoutFetch, retryFetch, decodeEntities, strip } = require('./_utils');

const googleNews = query => 'https://news.google.com/rss/search?q='
  + encodeURIComponent(query) + '&hl=pt-BR&gl=BR&ceid=BR:pt-419';

/**
 * Portais diretos primeiro: entregam texto e foto proprios. As buscas do
 * Google entram para garantir cobertura de tema quando os portais nao
 * publicaram nada do assunto no dia.
 */
const DEFAULT_FEEDS = [
  'https://www.canalrural.com.br/feed/',
  'https://www.infomoney.com.br/feed/',
  'https://www.moneytimes.com.br/feed/',
  'https://www.agrolink.com.br/rss/noticias.xml',
  'https://g1.globo.com/rss/g1/economia/agronegocios/',
  'https://g1.globo.com/rss/g1/mundo/',
  'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml',
  'https://agenciabrasil.ebc.com.br/rss/internacional/feed.xml',
  googleNews('café (arábica OR robusta OR conilon OR saca OR "mercado físico" OR exportação OR safra) preço'),
  googleNews('commodities (soja OR milho OR açúcar OR boi OR trigo OR algodão) preço mercado'),
  googleNews('(petróleo OR diesel OR fertilizante OR frete marítimo) preço mercado'),
  googleNews('geopolítica (tarifa OR sanção OR acordo comercial OR conflito) comércio global')
];

/** Cotas por eixo. Sem elas o cafe ocupa o feed inteiro. */
const TOPICS = [
  {
    tag: 'Cafe', weight: 60, quota: 6,
    terms: ['cafe', 'café', 'arabica', 'arábica', 'robusta', 'conilon', 'coffee', 'cafeeiro', 'cafeicultura']
  },
  {
    tag: 'Commodities', weight: 38, quota: 5,
    terms: ['safra', 'agro', 'agronegocio', 'agronegócio', 'lavoura', 'colheita', 'soja', 'milho', 'trigo',
      'algodao', 'algodão', 'acucar', 'açúcar', 'etanol', 'boi', 'carne', 'commodities', 'graos', 'grãos',
      'fertilizante', 'fertilizantes', 'defensivo', 'cooperativa', 'usda', 'conab']
  },
  {
    tag: 'Energia', weight: 30, quota: 3,
    terms: ['petroleo', 'petróleo', 'brent', 'diesel', 'combustivel', 'combustível', 'gas', 'gás',
      'energia', 'frete', 'fretes', 'porto', 'container', 'contêiner', 'logistica', 'logística', 'opep']
  },
  {
    tag: 'Geopolitica', weight: 26, quota: 4,
    terms: ['geopolitica', 'geopolítica', 'tarifa', 'tarifas', 'sancao', 'sanção', 'sancoes', 'sanções',
      'guerra', 'conflito', 'acordo comercial', 'embargo', 'china', 'estados unidos', 'uniao europeia',
      'união europeia', 'mercosul', 'brics', 'oriente medio', 'oriente médio']
  },
  {
    tag: 'Cambio', weight: 22, quota: 3,
    terms: ['dolar', 'dólar', 'cambio', 'câmbio', 'ptax', 'euro', 'yuan', 'moeda']
  },
  {
    tag: 'Juros', weight: 20, quota: 3,
    terms: ['copom', 'selic', 'juros', 'fed', 'inflacao', 'inflação', 'ipca', 'banco central', 'bce']
  }
];

/**
 * Manchete que casa um termo de mercado por acidente. "Furto de cafe em
 * mercado" nao e leitura de mesa, e a busca por tema traz esse tipo de item.
 */
const NOISE = [
  'furto', 'roubo', 'assalto', 'preso', 'presa por', 'homicid', 'assassin', 'estupro',
  'traficante', 'apreendid', 'morre', 'morto', 'morta', 'acidente', 'atropel',
  'receita de', 'como fazer', 'horoscopo', 'horóscopo', 'loteria', 'sorteio',
  'bbb', 'novela', 'celebridade', 'influencer', 'futebol', 'campeonato'
];

const isNoise = title => {
  const value = title.toLowerCase();
  return NOISE.some(term => value.includes(term));
};

const TOTAL_ITEMS = 24;
const WORD_EDGE = '[^a-z0-9áàâãéêíóôõúüç]';

const mentions = (haystack, term) => new RegExp(
  '(^|' + WORD_EDGE + ')' + term.replace(/\s+/g, '\\s+') + '(' + WORD_EDGE + '|$)', 'i'
).test(haystack);

const feeds = () => (process.env.NEWS_RSS_FEEDS
  ? String(process.env.NEWS_RSS_FEEDS).split(',')
  : DEFAULT_FEEDS)
  .map(item => String(item).trim())
  .filter(Boolean)
  .slice(0, 14);

/* ------------------------------------------------------------------- XML */

const tag = (xml, name) => {
  const match = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  return match ? decodeEntities(match[1]) : '';
};

const attribute = (fragment, name) => {
  const match = String(fragment || '').match(new RegExp(name + '=["\']([^"\']+)["\']', 'i'));
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
    || value.includes('news.google.com')
    || value.includes('/ebc.png');
};

const imageFromItem = (block, itemUrl, sourceUrl) => {
  const media = (block.match(/<media:(?:content|thumbnail)[^>]+>/i) || [])[0];
  const enclosure = (block.match(/<enclosure[^>]+>/i) || [])[0];
  const candidates = [
    tag(block, 'imagem-destaque'),
    media ? attribute(media, 'url') : '',
    enclosure && /image/i.test(enclosure) ? attribute(enclosure, 'url') : '',
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

/** O resumo pode estar em qualquer um destes campos, conforme o portal. */
const excerptFromItem = block => {
  for (const field of ['description', 'content:encoded', 'summary', 'dc:description']) {
    const value = strip(tag(block, field));
    if (value.length > 45) return value.slice(0, 420);
  }
  return '';
};

const cleanTitle = value => strip(value).replace(/\s*[|·]\s*[^|·]{2,40}$/, '').trim();

const classify = item => {
  const haystack = (item.title + ' ' + item.excerpt).toLowerCase();
  let score = 0;
  let topic = null;

  for (const entry of TOPICS) {
    if (entry.terms.some(term => mentions(haystack, term))) {
      score += entry.weight;
      if (!topic) topic = entry.tag;
    }
  }

  const publishedAt = item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
  const hoursOld = publishedAt ? (Date.now() - publishedAt) / 3600000 : 72;
  return { topic: topic || 'Mercado', score: Math.round((score - Math.min(hoursOld, 72) * 0.6) * 10) / 10 };
};

const parseItems = (xml, sourceUrl) => {
  const host = new URL(sourceUrl).hostname.replace(/^www\./, '');
  const isAggregator = host === 'news.google.com';
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  return blocks.map(block => {
    const url = tag(block, 'link');
    const published = tag(block, 'pubDate') || tag(block, 'dc:date');
    const parsedDate = published ? new Date(published) : null;

    let title = tag(block, 'title');
    let source = host;
    let sourceDomain = host;

    if (isAggregator) {
      // O agregador entrega "Manchete - Veiculo" e um <source url> com o site real.
      const split = title.lastIndexOf(' - ');
      if (split > 20) {
        source = title.slice(split + 3).trim();
        title = title.slice(0, split).trim();
      }
      const sourceTag = (block.match(/<source[^>]*>/i) || [])[0];
      const declared = attribute(sourceTag, 'url');
      sourceDomain = '';
      if (declared) {
        try {
          sourceDomain = new URL(declared).hostname.replace(/^www\./, '');
        } catch {
          sourceDomain = '';
        }
      }
    }

    const item = {
      title: cleanTitle(title),
      // A descricao do agregador e so um link repetido, nao serve de resumo.
      excerpt: isAggregator ? '' : excerptFromItem(block),
      dek: '',
      url,
      image: isAggregator ? '' : imageFromItem(block, url, sourceUrl),
      imageKind: '',
      source,
      sourceDomain,
      aggregated: isAggregator,
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null
    };

    const classification = classify(item);
    item.category = classification.topic;
    item.relevance = classification.score;
    return item;
  }).filter(item => item.title && item.url && !isNoise(item.title));
};

/* ------------------------------------------------------- enriquecimento */

const metaContent = (html, patterns) => {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return decodeEntities(match[1]).trim();
  }
  return '';
};

/**
 * Abre a materia para buscar capa e linha fina. Nao vale a pena fazer isso
 * nos links do agregador: eles nao redirecionam e a pagina e do proprio
 * Google, entao a imagem que voltaria seria o logotipo dele.
 */
const enrich = async (item, timeoutMs = 5000) => {
  if (item.aggregated || (item.image && item.excerpt.length > 80)) return item;

  try {
    const response = await timeoutFetch(item.url, { headers: { Accept: 'text/html,*/*' } }, timeoutMs);
    if (!response.ok) return item;

    const finalUrl = response.url || item.url;
    const html = (await response.text()).slice(0, 200000);

    const image = metaContent(html, [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
    ]);

    const description = metaContent(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i
    ]);

    let resolved = item.image;
    if (image) {
      try {
        const absolute = new URL(image, finalUrl).toString();
        if (!isGenericImage(absolute)) resolved = absolute;
      } catch {
        /* origem devolveu url invalida */
      }
    }

    const cleanDescription = strip(description);
    const sameAsExcerpt = cleanDescription.slice(0, 60).toLowerCase()
      === item.excerpt.slice(0, 60).toLowerCase();

    return Object.assign({}, item, {
      image: isGenericImage(resolved) ? '' : resolved,
      excerpt: item.excerpt || cleanDescription.slice(0, 420),
      dek: !sameAsExcerpt && cleanDescription.length > 40 ? cleanDescription.slice(0, 240) : item.dek
    });
  } catch {
    return item;
  }
};

/** Sem foto, a miniatura vira a marca do veiculo. Nunca um bloco vazio. */
const withThumbnail = item => {
  if (item.image) return Object.assign({}, item, { imageKind: 'foto' });
  if (!item.sourceDomain) return Object.assign({}, item, { imageKind: 'nenhuma' });
  return Object.assign({}, item, {
    image: 'https://www.google.com/s2/favicons?sz=128&domain=' + encodeURIComponent(item.sourceDomain),
    imageKind: 'marca'
  });
};

const applyQuotas = (ranked, total = TOTAL_ITEMS) => {
  const chosen = [];
  const used = new Set();

  for (const topic of TOPICS) {
    let taken = 0;
    for (const item of ranked) {
      if (taken >= topic.quota) break;
      if (used.has(item.url) || item.category !== topic.tag) continue;
      chosen.push(item);
      used.add(item.url);
      taken += 1;
    }
  }

  for (const item of ranked) {
    if (chosen.length >= total) break;
    if (used.has(item.url)) continue;
    chosen.push(item);
    used.add(item.url);
  }

  return chosen.slice(0, total).sort((a, b) => b.relevance - a.relevance);
};

/**
 * @param {object} options
 * @param {number} options.feedTimeout  tempo por feed
 * @param {number} options.enrichCount  quantas materias abrir atras de capa
 * @param {number} options.enrichTimeout tempo por materia
 */
const collect = async (options = {}) => {
  const feedTimeout = options.feedTimeout || 7000;
  const enrichCount = options.enrichCount === undefined ? 10 : options.enrichCount;
  const enrichTimeout = options.enrichTimeout || 5000;

  const list = feeds();
  const results = await Promise.allSettled(list.map(async feed => {
    const response = await retryFetch(
      feed,
      { headers: { Accept: 'application/rss+xml,text/xml,*/*' } },
      feedTimeout,
      1
    );
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

  const selected = applyQuotas(ranked);

  const head = enrichCount > 0 && process.env.NEWS_FETCH_IMAGES !== 'false'
    ? await Promise.all(selected.slice(0, enrichCount).map(item => enrich(item, enrichTimeout)))
    : selected.slice(0, enrichCount);

  const items = head.concat(selected.slice(enrichCount)).map(withThumbnail);

  const byCategory = {};
  for (const item of items) byCategory[item.category] = (byCategory[item.category] || 0) + 1;

  return {
    items,
    meta: {
      feeds: list.length,
      failures: results.filter(result => result.status === 'rejected').length,
      byCategory,
      withPhoto: items.filter(item => item.imageKind === 'foto').length,
      withExcerpt: items.filter(item => item.excerpt).length
    }
  };
};

module.exports = { collect, TOPICS, DEFAULT_FEEDS };
