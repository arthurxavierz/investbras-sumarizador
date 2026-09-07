/* Investbras Intelligence - area publica.
   Nenhum dado e inventado no cliente: tudo vem das Functions e, quando a fonte
   nao responde, a interface diz que nao respondeu. */

const $ = selector => document.querySelector(selector);

const API = {
  data: '/.netlify/functions/market-data',
  news: '/.netlify/functions/market-news',
  agenda: '/.netlify/functions/market-agenda',
  report: '/.netlify/functions/report',
  subscribe: '/.netlify/functions/subscribe'
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------------------------------------------------------------- formato */

const nf = (value, options) => new Intl.NumberFormat('pt-BR', options).format(value);

const isNumber = value => value !== null && value !== undefined && Number.isFinite(Number(value));

const formatQuantity = (value, unit) => {
  if (!isNumber(value)) return 'Indisponivel';
  const digits = Math.abs(Number(value)) >= 1000 ? 0 : 2;
  const amount = nf(Number(value), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return unit ? amount + ' ' + unit : amount;
};

const formatBrl = value => (isNumber(value)
  ? nf(Number(value), { style: 'currency', currency: 'BRL' })
  : 'Indisponivel');

const formatPercent = value => {
  if (!isNumber(value)) return '--';
  const number = Number(value);
  return (number > 0 ? '+' : '') + nf(number, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
};

const formatDateTime = value => {
  if (!value) return 'Aguardando';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Aguardando';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo'
  }).format(date);
};

const direction = value => {
  if (!isNumber(value)) return 'flat';
  if (Number(value) > 0) return 'up';
  if (Number(value) < 0) return 'down';
  return 'flat';
};

const setText = (selector, value) => {
  const node = typeof selector === 'string' ? $(selector) : selector;
  if (node) node.textContent = value;
};

const escapeHtml = value => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/* --------------------------------------------------------------- graficos */

const svgEl = (name, attributes) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attributes) node.setAttribute(key, attributes[key]);
  return node;
};

/** Caminhos de linha e area para uma serie de valores igualmente espacados. */
const seriesPaths = (values, width, height, padding) => {
  const min = Math.min.apply(null, values);
  const max = Math.max.apply(null, values);
  const span = max - min || Math.abs(max) * 0.01 || 1;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const points = values.map((value, index) => ({
    x: padding.left + (values.length === 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth),
    y: padding.top + innerHeight - ((value - min) / span) * innerHeight,
    value
  }));

  const line = points.map((point, index) => (index ? 'L' : 'M') + point.x.toFixed(1) + ' ' + point.y.toFixed(1)).join(' ');
  const area = line
    + ' L' + points[points.length - 1].x.toFixed(1) + ' ' + (height - padding.bottom).toFixed(1)
    + ' L' + points[0].x.toFixed(1) + ' ' + (height - padding.bottom).toFixed(1) + ' Z';

  return { line, area, points, min, max };
};

/** Sparkline do hero: acompanha o numero grande, sem eixos nem rotulos. */
const renderSparkline = (holder, values) => {
  holder.replaceChildren();
  if (!values || values.length < 2) {
    const empty = document.createElement('div');
    empty.className = 'spark-empty';
    empty.textContent = 'Serie de 5 pregoes indisponivel na fonte.';
    holder.appendChild(empty);
    return;
  }

  const width = holder.clientWidth || 360;
  const height = 82;
  const paths = seriesPaths(values, width, height, { top: 12, right: 20, bottom: 10, left: 20 });

  const svg = svgEl('svg', {
    class: 'spark', viewBox: '0 0 ' + width + ' ' + height, width: '100%', height: String(height),
    role: 'img',
    'aria-label': 'Tendencia do cafe arabica nos ultimos 5 pregoes, de '
      + formatQuantity(paths.min) + ' a ' + formatQuantity(paths.max) + ' centavos por libra.'
  });

  const gradientId = 'spark-fill';
  const defs = svgEl('defs', {});
  const gradient = svgEl('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.appendChild(svgEl('stop', { offset: '0', 'stop-color': '#D8AF58', 'stop-opacity': '.26' }));
  gradient.appendChild(svgEl('stop', { offset: '1', 'stop-color': '#D8AF58', 'stop-opacity': '0' }));
  defs.appendChild(gradient);
  svg.appendChild(defs);

  svg.appendChild(svgEl('path', { d: paths.area, fill: 'url(#' + gradientId + ')' }));
  svg.appendChild(svgEl('path', {
    d: paths.line, fill: 'none', stroke: '#D8AF58', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  }));

  const last = paths.points[paths.points.length - 1];
  svg.appendChild(svgEl('circle', { cx: last.x, cy: last.y, r: '3.5', fill: '#D8AF58' }));

  holder.appendChild(svg);
};

/**
 * Grafico principal com camada de hover: linha de referencia, ponto e tooltip.
 * A tabela de OHLC ao lado cumpre o papel de leitura tabular do mesmo dado.
 */
const renderAreaChart = (holder, values, meta) => {
  holder.replaceChildren();
  if (!values || values.length < 2) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = 'A fonte nao devolveu serie historica nesta consulta. Os valores da sessao seguem ao lado.';
    holder.appendChild(empty);
    return;
  }

  const width = holder.clientWidth || 640;
  const height = Math.max(200, Math.min(290, Math.round(width * 0.45)));
  const padding = { top: 22, right: 58, bottom: 24, left: 14 };
  const paths = seriesPaths(values, width, height, padding);

  const svg = svgEl('svg', {
    class: 'chart-area', viewBox: '0 0 ' + width + ' ' + height, width: '100%', height: String(height),
    role: 'img',
    'aria-label': 'Cafe arabica nos ultimos 5 pregoes, variando entre '
      + formatQuantity(paths.min, meta.unit) + ' e ' + formatQuantity(paths.max, meta.unit) + '.'
  });

  const defs = svgEl('defs', {});
  const gradient = svgEl('linearGradient', { id: 'area-fill', x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.appendChild(svgEl('stop', { offset: '0', 'stop-color': '#D8AF58', 'stop-opacity': '.22' }));
  gradient.appendChild(svgEl('stop', { offset: '1', 'stop-color': '#D8AF58', 'stop-opacity': '0' }));
  defs.appendChild(gradient);
  svg.appendChild(defs);

  // Grade recessiva: apenas maxima, media e minima da janela.
  [0, 0.5, 1].forEach(ratio => {
    const y = padding.top + (height - padding.top - padding.bottom) * ratio;
    svg.appendChild(svgEl('line', {
      x1: padding.left, x2: width - padding.right, y1: y, y2: y,
      stroke: '#262320', 'stroke-width': '1'
    }));
  });

  svg.appendChild(svgEl('path', { d: paths.area, fill: 'url(#area-fill)' }));
  svg.appendChild(svgEl('path', {
    d: paths.line, fill: 'none', stroke: '#D8AF58', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  }));

  // Rotulos diretos apenas nos extremos da janela.
  const labelFor = (value, y, anchorTop) => {
    const label = svgEl('text', {
      x: width - padding.right + 8,
      y: y + (anchorTop ? 4 : 4),
      fill: '#6E6961',
      'font-family': 'Geist Mono, monospace',
      'font-size': '11'
    });
    label.textContent = nf(value, { maximumFractionDigits: 2 });
    return label;
  };

  const highPoint = paths.points.find(point => point.value === paths.max);
  const lowPoint = paths.points.find(point => point.value === paths.min);
  if (highPoint) svg.appendChild(labelFor(paths.max, padding.top, true));
  if (lowPoint) svg.appendChild(labelFor(paths.min, height - padding.bottom, false));

  const crosshair = svgEl('line', {
    y1: padding.top, y2: height - padding.bottom, stroke: '#37322B', 'stroke-width': '1', opacity: '0'
  });
  const marker = svgEl('circle', { r: '4', fill: '#D8AF58', stroke: '#0C0B09', 'stroke-width': '2', opacity: '0' });
  svg.appendChild(crosshair);
  svg.appendChild(marker);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tip';
  tooltip.hidden = true;

  const move = event => {
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * width;
    let nearest = paths.points[0];
    for (const point of paths.points) {
      if (Math.abs(point.x - x) < Math.abs(nearest.x - x)) nearest = point;
    }
    crosshair.setAttribute('x1', nearest.x);
    crosshair.setAttribute('x2', nearest.x);
    crosshair.setAttribute('opacity', '1');
    marker.setAttribute('cx', nearest.x);
    marker.setAttribute('cy', nearest.y);
    marker.setAttribute('opacity', '1');
    tooltip.hidden = false;
    tooltip.textContent = formatQuantity(nearest.value, meta.unit);
    const left = (nearest.x / width) * box.width;
    tooltip.style.left = Math.min(Math.max(left, 34), box.width - 34) + 'px';
    tooltip.style.top = ((nearest.y / height) * box.height - 34) + 'px';
  };

  const leave = () => {
    crosshair.setAttribute('opacity', '0');
    marker.setAttribute('opacity', '0');
    tooltip.hidden = true;
  };

  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', leave);

  holder.appendChild(svg);
  holder.appendChild(tooltip);
};

/* ------------------------------------------------------ sessao de mercado */

/** Cafe C negocia das 4h15 as 13h30 em Nova York, de segunda a sexta. */
const marketSession = () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(now);

  const read = type => parts.find(part => part.type === type)?.value || '';
  const weekday = read('weekday');
  const minutes = Number(read('hour')) * 60 + Number(read('minute'));
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const open = isWeekday && minutes >= 255 && minutes <= 810;

  const brt = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo'
  }).format(now);

  return { open, label: brt + ' BRT / ICE ' + (open ? 'aberta' : 'fechada') };
};

const tickSession = () => {
  const chip = $('#session-chip');
  const session = marketSession();
  if (chip) chip.dataset.session = session.open ? 'open' : 'closed';
  setText('#session-label', session.label);
};

/* ------------------------------------------------------------ market data */

const skeletonGrid = () => {
  const grid = $('#market-grid');
  if (!grid) return;
  grid.innerHTML = Array.from({ length: 8 }, () => (
    '<article class="quote-cell is-loading"><h3>Carregando</h3><span class="value">0000</span><footer>fonte</footer></article>'
  )).join('');
};

const renderTape = assets => {
  const track = $('#tape-track');
  if (!track) return;

  const visible = assets.filter(asset => asset.status === 'available');
  if (!visible.length) {
    track.innerHTML = '<span class="tape-empty">Nenhuma referencia de mercado disponivel agora.</span>';
    track.style.animation = 'none';
    return;
  }

  const item = asset => '<span class="tape-item" data-dir="' + direction(asset.changePercent) + '">'
    + escapeHtml(asset.name)
    + '<strong>' + escapeHtml(formatQuantity(asset.value, asset.unit)) + '</strong>'
    + '<em class="delta">' + escapeHtml(formatPercent(asset.changePercent)) + '</em></span>';

  // Conteudo duplicado para o laco da fita nao mostrar corte.
  const markup = visible.map(item).join('');
  track.innerHTML = markup + markup;
  track.style.animation = '';
};

const renderGrid = assets => {
  const grid = $('#market-grid');
  if (!grid) return;
  grid.setAttribute('aria-busy', 'false');

  if (!assets.length) {
    grid.innerHTML = '<article class="quote-cell"><h3>Mercados</h3><span class="value" data-empty="true">Indisponivel</span>'
      + '<footer>Nenhuma fonte publica respondeu.</footer></article>';
    return;
  }

  grid.innerHTML = assets.map(asset => {
    const ok = asset.status === 'available';
    return '<article class="quote-cell" data-dir="' + direction(asset.changePercent) + '">'
      + '<h3>' + escapeHtml(asset.name) + '</h3>'
      + '<span class="value"' + (ok ? '' : ' data-empty="true"') + '>'
      + escapeHtml(ok ? formatQuantity(asset.value, asset.unit) : 'Indisponivel') + '</span>'
      + '<span class="delta">' + escapeHtml(ok ? formatPercent(asset.changePercent) : '--') + '</span>'
      + '<footer>' + escapeHtml(ok ? asset.source + ' / ' + formatDateTime(asset.fetchedAt) : (asset.error || 'Fonte sem resposta.')) + '</footer>'
      + '</article>';
  }).join('');
};

const renderMacro = macro => {
  const strip = $('#macro-strip');
  if (!strip) return;
  if (!macro || !macro.length) {
    strip.hidden = true;
    return;
  }
  strip.hidden = false;
  strip.innerHTML = macro.map(item => '<div>' + escapeHtml(item.label)
    + '<strong>' + escapeHtml(nf(item.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + item.unit) + '</strong>'
    + '<small>ref. ' + escapeHtml(item.reference) + '</small></div>').join('');
};

const renderConversions = equivalents => {
  const list = $('#convert-list');
  if (!list) return;

  if (!equivalents || !equivalents.length) {
    list.innerHTML = '<div class="empty-state">Conversao indisponivel: falta cotacao de bolsa ou de cambio nesta consulta.</div>';
    return;
  }

  list.innerHTML = equivalents.map(item => '<div class="convert-item">'
    + '<span>' + escapeHtml(item.name) + '<br><small class="convert-ref">' + escapeHtml(item.reference || '') + '</small></span>'
    + '<strong>' + escapeHtml(formatBrl(item.value)) + '</strong>'
    + '</div>').join('');
};

const renderCoffee = (coffee, usdBrl) => {
  if (!coffee) return;

  const available = coffee.status === 'available';
  const line = $('#panel-quote-line');
  if (line) line.dataset.dir = direction(coffee.changePercent);

  setText('#panel-contract', coffee.contract || coffee.symbol || 'KC');
  setText('#panel-value', available ? nf(coffee.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--');
  setText('#panel-unit', coffee.unit || 'c/lb');
  setText('#panel-delta', formatPercent(coffee.changePercent));

  setText('#coffee-change', formatPercent(coffee.changePercent));
  const changeNode = $('#coffee-change');
  if (changeNode) changeNode.dataset.dir = direction(coffee.changePercent);

  setText('#coffee-open', formatQuantity(coffee.open, coffee.unit));
  setText('#coffee-high', formatQuantity(coffee.high, coffee.unit));
  setText('#coffee-low', formatQuantity(coffee.low, coffee.unit));
  setText('#coffee-previous', formatQuantity(coffee.previousClose, coffee.unit));
  setText('#coffee-usd', isNumber(usdBrl) ? formatBrl(usdBrl) : 'Indisponivel');
  setText('#coffee-updated', available ? 'Atualizado ' + formatDateTime(coffee.fetchedAt) : 'Fonte sem resposta');
  setText('#chart-range', coffee.contract || 'KC (ICE NY)');
  setText('#chart-low', 'Minima da janela ' + formatQuantity(coffee.series && coffee.series.length ? Math.min.apply(null, coffee.series) : null));
  setText('#chart-high', 'Maxima da janela ' + formatQuantity(coffee.series && coffee.series.length ? Math.max.apply(null, coffee.series) : null));

  setText('#coffee-source', available
    ? 'Fonte: ' + coffee.source + '. Valor exibido sem interpretacao automatica e sujeito a atraso da bolsa.'
    : 'Cafe arabica indisponivel: nenhuma fonte confiavel respondeu nesta consulta.');

  const sparkHolder = $('#panel-spark-holder');
  if (sparkHolder) renderSparkline(sparkHolder, coffee.series);

  const chartHolder = $('#chart-holder');
  if (chartHolder) renderAreaChart(chartHolder, coffee.series, { unit: coffee.unit });
};

const setFreshness = (state, label) => {
  const node = $('#data-freshness');
  if (node) node.dataset.state = state;
  setText('#data-freshness-label', label);
};

let lastCoffee = null;
let lastUsd = null;

const loadMarketData = async () => {
  skeletonGrid();
  try {
    const response = await fetch(API.data);
    const payload = await response.json();
    const data = payload.data || {};
    const assets = data.assets || [];

    renderGrid(assets);
    renderTape(assets);
    renderMacro(data.macro);
    renderConversions(data.bagEquivalents);

    lastCoffee = data.coffee;
    lastUsd = data.usdBrlReference;
    renderCoffee(data.coffee, data.usdBrlReference);

    setText('#sources-meta', (data.activeSources || 0) + '/' + (data.totalSources || 0) + ' fontes ativas');

    if (payload.stale) setFreshness('stale', 'Ultima leitura valida');
    else if (payload.status === 'partial') setFreshness('stale', 'Fontes parciais');
    else if (payload.success) setFreshness('live', 'Sincronizado ' + formatDateTime(payload.fetchedAt));
    else setFreshness('down', 'Fontes indisponiveis');

    const bag = (data.bagEquivalents || [])[0];
    setText('#panel-bag', bag ? formatBrl(bag.value) : 'Indisponivel');
    setText('#panel-bag-note', bag
      ? 'Saca de 60 kg pelo dolar de ' + formatBrl(data.usdBrlReference) + '.'
      : 'Precisa de cotacao de bolsa e de cambio na mesma consulta.');
  } catch {
    setFreshness('down', 'Sem conexao com as fontes');
    renderGrid([]);
    renderTape([]);
    renderConversions([]);
    setText('#sources-meta', 'Camada server-side offline');
    setText('#panel-bag', 'Indisponivel');
  }
};

/* ---------------------------------------------------------------- noticias */

const proxiedImage = value => {
  if (!value) return '';
  try {
    return '/.netlify/functions/news-image?src=' + encodeURIComponent(new URL(value).toString());
  } catch {
    return '';
  }
};

const renderNews = items => {
  const list = $('#news-list');
  if (!list) return;
  list.setAttribute('aria-busy', 'false');

  if (!items || !items.length) {
    list.innerHTML = '<div class="empty-state"><strong>Feeds sem resposta</strong>'
      + 'Nenhuma fonte publica respondeu nesta consulta. Configure NEWS_RSS_FEEDS para usar feeds proprios.</div>';
    return;
  }

  list.innerHTML = items.slice(0, 10).map((item, index) => {
    const image = proxiedImage(item.image);
    const thumb = image
      ? '<span class="news-thumb"><img src="' + escapeHtml(image) + '" alt="" loading="'
        + (index > 1 ? 'lazy' : 'eager') + '" decoding="async" width="108" height="74"></span>'
      : '<span class="news-thumb" aria-hidden="true"></span>';

    return '<a class="news-card" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">'
      + thumb
      + '<div>'
      + '<span class="news-tag">' + escapeHtml(item.category || 'Mercado') + '</span>'
      + '<h3>' + escapeHtml(item.title) + '</h3>'
      + '<p>' + escapeHtml(String(item.summary || '').slice(0, 130)) + '</p>'
      + '<div class="news-meta">' + escapeHtml(item.source || 'Fonte publica') + ' / ' + escapeHtml(formatDateTime(item.publishedAt)) + '</div>'
      + '</div></a>';
  }).join('');

  list.querySelectorAll('.news-thumb img').forEach(image => {
    image.addEventListener('error', () => image.remove(), { once: true });
  });
};

const loadNews = async () => {
  try {
    const response = await fetch(API.news);
    const payload = await response.json();
    renderNews(payload.data);
    const meta = payload.meta || {};
    setText('#news-meta', payload.success
      ? (payload.data || []).length + ' materias / ' + (meta.coffeeItems || 0) + ' sobre cafe'
      : 'Feeds indisponiveis');
  } catch {
    renderNews([]);
    setText('#news-meta', 'Feeds indisponiveis');
  }
};

/* ------------------------------------------------------------------ agenda */

const renderAgenda = items => {
  const list = $('#agenda-list');
  if (!list) return;

  if (!items || !items.length) {
    list.innerHTML = '<div class="empty-state">Nenhum evento na janela consultada. '
      + 'Configure AGENDA_ICS_URLS para somar calendarios proprios.</div>';
    return;
  }

  list.innerHTML = items.slice(0, 8).map(item => '<article class="agenda-row">'
    + '<time datetime="' + escapeHtml(item.startsAt) + '">' + escapeHtml(item.day) + '<span>' + escapeHtml(item.time) + '</span></time>'
    + '<div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.source) + '</small></div>'
    + '</article>').join('');
};

const loadAgenda = async () => {
  try {
    const response = await fetch(API.agenda);
    const payload = await response.json();
    renderAgenda(payload.data);
  } catch {
    renderAgenda([]);
  }
};

/* ------------------------------------------------------------ giro do dia */

const EDITION_BLOCKS = [
  ['coffee', 'Cafe'],
  ['brazil', 'Brasil'],
  ['global', 'Exterior'],
  ['commodities', 'Commodities'],
  ['geopolitics', 'Geopolitica e cadeia'],
  ['agenda', 'Agenda']
];

const paragraphs = value => String(value || '')
  .split(/\n{2,}/)
  .map(block => block.trim())
  .filter(Boolean)
  .map(block => '<p>' + escapeHtml(block).replace(/\n/g, '<br>') + '</p>')
  .join('');

const renderEdition = report => {
  const body = $('#edition-body');
  const index = $('#edition-index');
  if (!body || !index) return;

  const blocks = EDITION_BLOCKS.filter(entry => String(report.sections?.[entry[0]] || '').trim());

  index.innerHTML = blocks.map(entry => '<a href="#bloco-' + entry[0] + '">' + escapeHtml(entry[1]) + '</a>').join('');

  body.innerHTML = '<h2>' + escapeHtml(report.title) + '</h2>'
    + '<div class="edition-lead">' + paragraphs(report.summary) + '</div>'
    + blocks.map(entry => '<section class="edition-block" id="bloco-' + entry[0] + '">'
      + '<h3>' + escapeHtml(entry[1]) + '</h3>'
      + paragraphs(report.sections[entry[0]])
      + '</section>').join('')
    + '<div class="edition-byline">'
    + '<span>Publicado ' + escapeHtml(formatDateTime(report.publishedAt)) + '</span>'
    + (report.author ? '<span>Mesa: ' + escapeHtml(report.author) + '</span>' : '')
    + '</div>';

  setText('#edition-status', 'Edicao de ' + formatDateTime(report.publishedAt));
};

const loadEdition = async () => {
  try {
    const response = await fetch(API.report);
    const payload = await response.json();
    if (payload.success && payload.data) {
      renderEdition(payload.data);
      return;
    }
    setText('#edition-status', payload.status === 'not-configured' ? 'Publicacao local' : 'Sem edicao publicada');
  } catch {
    setText('#edition-status', 'Sem edicao publicada');
  }

  // Preview local do painel enquanto o Supabase nao esta ligado.
  try {
    const local = JSON.parse(localStorage.getItem('investbras-published-report') || 'null');
    if (local && local.title) {
      renderEdition({
        title: local.title,
        summary: local.summary,
        publishedAt: local.publishedAt,
        author: local.author || null,
        sections: local
      });
      setText('#edition-status', 'Preview local desta maquina');
    }
  } catch {
    localStorage.removeItem('investbras-published-report');
  }
};

/* ------------------------------------------------------------- newsletter */

const setupNewsletter = () => {
  const form = $('#newsletter-form');
  const feedback = $('#form-feedback');
  const emailInput = $('#sub-email');
  if (!form) return;

  const say = (message, state) => {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.dataset.state = state || '';
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#sub-submit');
    const values = Object.fromEntries(new FormData(form));
    const email = String(values.email || '').trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      emailInput?.setAttribute('aria-invalid', 'true');
      emailInput?.focus();
      say('Informe um e-mail valido.', 'error');
      return;
    }

    emailInput?.removeAttribute('aria-invalid');
    button.disabled = true;
    button.textContent = 'Enviando';
    say('');

    try {
      const response = await fetch(API.subscribe, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: values.name || '',
          organization: values.organization || '',
          company: values.company || ''
        })
      });
      const payload = await response.json();
      say(payload.message || payload.error || 'Cadastro processado.', response.ok ? 'ok' : 'error');
      if (response.ok) form.reset();
    } catch {
      say('Nao foi possivel conectar ao cadastro agora.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Cadastrar';
    }
  });
};

/* -------------------------------------------------------------- interface */

const setupMenu = () => {
  const button = $('#menu-button');
  const nav = $('#mobile-nav');
  if (!button || !nav) return;

  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    nav.classList.toggle('is-open', !open);
  });

  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    button.setAttribute('aria-expanded', 'false');
    nav.classList.remove('is-open');
  }));
};

/** Revelacao de entrada. IntersectionObserver, nunca listener de scroll. */
const setupReveal = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const targets = document.querySelectorAll('.section-head, .coffee-layout, .market-grid, .risk-inner, .news-layout, .newsletter-inner');
  targets.forEach(target => target.classList.add('reveal'));

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });

  targets.forEach(target => observer.observe(target));
};

/** Redesenha os graficos quando a largura muda de faixa. */
const setupResize = () => {
  let width = window.innerWidth;
  let timer;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - width) < 60) return;
    width = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (lastCoffee) renderCoffee(lastCoffee, lastUsd);
    }, 220);
  });
};

const boot = () => {
  const editionDate = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo'
  }).format(new Date());
  setText('#edition-date', '/ ' + editionDate);

  tickSession();
  setInterval(tickSession, 30000);

  setupMenu();
  setupNewsletter();
  setupReveal();
  setupResize();

  loadMarketData();
  loadNews();
  loadAgenda();
  loadEdition();

  // Cotacao envelhece rapido: recarrega a cada 3 minutos enquanto a aba estiver visivel.
  setInterval(() => {
    if (document.visibilityState === 'visible') loadMarketData();
  }, 180000);
};

boot();
