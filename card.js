/* Gerador do card de mercado.
   Desenha em canvas com as fontes da marca ja carregadas pela pagina e
   exporta em JPG. Todo numero vem das Functions: o card nunca inventa valor,
   e um dado ausente vira "indisponivel" em vez de sumir. */

(() => {
  const PALETTE = {
    bg: '#0C0B09',
    panel: '#131210',
    raised: '#191714',
    line: '#262320',
    lineSoft: '#1D1B18',
    gold: '#D8AF58',
    goldBright: '#EFCE86',
    goldDim: '#7A6533',
    text: '#F4F0E6',
    muted: '#9A9389',
    dim: '#6E6961',
    up: '#6FBF8A',
    down: '#E0736B',
    ink: '#151310'
  };

  const FORMATS = {
    landscape: { width: 1920, height: 1080, name: 'post' },
    portrait: { width: 1080, height: 1920, name: 'story' }
  };

  const nf = (value, options) => new Intl.NumberFormat('pt-BR', options).format(value);
  const isNumber = value => value !== null && value !== undefined && Number.isFinite(Number(value));

  const money = value => (isNumber(value)
    ? nf(Number(value), { style: 'currency', currency: 'BRL' })
    : 'Indisponivel');

  const decimal = (value, digits) => (isNumber(value)
    ? nf(Number(value), { minimumFractionDigits: digits === undefined ? 2 : digits, maximumFractionDigits: digits === undefined ? 2 : digits })
    : '--');

  const percent = value => {
    if (!isNumber(value)) return '--';
    const number = Number(value);
    return (number > 0 ? '+' : '') + nf(number, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  };

  const deltaColor = value => {
    if (!isNumber(value)) return PALETTE.dim;
    if (Number(value) > 0) return PALETTE.up;
    if (Number(value) < 0) return PALETTE.down;
    return PALETTE.dim;
  };

  /* ------------------------------------------------------------ desenho */

  const font = (weight, size, family) => weight + ' ' + size + 'px ' + family;
  const DISPLAY = '"Anton", Impact, sans-serif';
  const SANS = '"Geist", "Segoe UI", sans-serif';
  const MONO = '"Geist Mono", Consolas, monospace';

  const rect = (ctx, x, y, width, height, fill) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, width, height);
  };

  const strokeRect = (ctx, x, y, width, height, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
  };

  const label = (ctx, text, x, y, size, color, spacing) => {
    ctx.fillStyle = color;
    ctx.font = font(500, size, SANS);
    ctx.textBaseline = 'alphabetic';
    let cursor = x;
    for (const character of String(text).toUpperCase()) {
      ctx.fillText(character, cursor, y);
      cursor += ctx.measureText(character).width + (spacing === undefined ? size * 0.16 : spacing);
    }
    return cursor;
  };

  /** Quebra o texto respeitando a largura, devolvendo as linhas usadas. */
  const wrap = (ctx, text, maxWidth, maxLines) => {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }

    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length === maxLines && words.length) {
      const last = lines[maxLines - 1];
      if (ctx.measureText(last + '...').width > maxWidth) {
        lines[maxLines - 1] = last.replace(/\s+\S*$/, '') + '...';
      }
    }
    return lines;
  };

  const drawWrapped = (ctx, text, x, y, maxWidth, lineHeight, maxLines) => {
    const lines = wrap(ctx, text, maxWidth, maxLines);
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
    return y + lines.length * lineHeight;
  };

  /* ------------------------------------------------------------- blocos */

  const drawBrand = (ctx, x, y, scale) => {
    const size = 56 * scale;
    rect(ctx, x, y, size, size, PALETTE.gold);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(400, 26 * scale, DISPLAY);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('IB', x + size / 2, y + size / 2 + 2 * scale);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = PALETTE.text;
    ctx.font = font(400, 34 * scale, DISPLAY);
    ctx.fillText('INVESTBRAS', x + size + 20 * scale, y + 26 * scale);
    label(ctx, 'INTELLIGENCE', x + size + 20 * scale, y + 48 * scale, 13 * scale, PALETTE.gold, 4 * scale);
  };

  /** Bloco principal: preco da bolsa, variacao e sparkline da janela. */
  const drawHero = (ctx, coffee, x, y, width, scale) => {
    const height = 240 * scale;
    rect(ctx, x, y, width, height, PALETTE.panel);
    strokeRect(ctx, x, y, width, height, PALETTE.line);

    const padding = 32 * scale;
    label(ctx, 'Cafe arabica / ICE Nova York', x + padding, y + 44 * scale, 15 * scale, PALETTE.gold, 3 * scale);

    const available = coffee && coffee.status === 'available';
    ctx.fillStyle = PALETTE.text;
    ctx.font = font(500, 92 * scale, MONO);
    const price = available ? decimal(coffee.value) : 'Indisponivel';
    ctx.fillText(price, x + padding, y + 148 * scale);

    const priceWidth = ctx.measureText(price).width;
    ctx.fillStyle = PALETTE.dim;
    ctx.font = font(400, 24 * scale, MONO);
    ctx.fillText(available ? (coffee.unit || 'c/lb') : '', x + padding + priceWidth + 16 * scale, y + 148 * scale);

    ctx.fillStyle = deltaColor(coffee && coffee.changePercent);
    ctx.font = font(500, 34 * scale, MONO);
    ctx.fillText(percent(coffee && coffee.changePercent), x + padding, y + 200 * scale);

    // Serie da janela, desenhada a direita do numero.
    const series = (coffee && coffee.series) || [];
    if (series.length > 2) {
      const chartX = x + width * 0.5;
      const chartWidth = width * 0.5 - padding;
      const chartY = y + 70 * scale;
      const chartHeight = height - 140 * scale;
      const min = Math.min.apply(null, series);
      const max = Math.max.apply(null, series);
      const span = max - min || 1;

      ctx.beginPath();
      series.forEach((value, index) => {
        const pointX = chartX + (index / (series.length - 1)) * chartWidth;
        const pointY = chartY + chartHeight - ((value - min) / span) * chartHeight;
        if (index === 0) ctx.moveTo(pointX, pointY);
        else ctx.lineTo(pointX, pointY);
      });
      ctx.strokeStyle = PALETTE.gold;
      ctx.lineWidth = 4 * scale;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.lineTo(chartX + chartWidth, chartY + chartHeight);
      ctx.lineTo(chartX, chartY + chartHeight);
      ctx.closePath();
      ctx.fillStyle = 'rgba(216, 175, 88, .14)';
      ctx.fill();

      label(ctx, 'Ultimos 5 pregoes', chartX, y + height - 24 * scale, 13 * scale, PALETTE.dim, 3 * scale);
    }

    return y + height;
  };

  /**
   * O bloco que a mesa realmente usa: quanto vale a saca convertida da bolsa,
   * quanto vale no fisico, e a diferenca entre as duas leituras.
   */
  const drawSpread = (ctx, spread, x, y, width, scale) => {
    const height = 190 * scale;
    rect(ctx, x, y, width, height, PALETTE.raised);
    strokeRect(ctx, x, y, width, height, PALETTE.goldDim);

    const padding = 32 * scale;
    label(ctx, 'Saca de 60 kg', x + padding, y + 42 * scale, 15 * scale, PALETTE.gold, 3 * scale);

    const columnWidth = (width - padding * 2) / 3;
    const columns = [
      { title: 'Bolsa convertida', value: money(spread.converted), color: PALETTE.text },
      { title: 'Fisico CEPEA', value: money(spread.physical), color: PALETTE.text },
      {
        title: 'Diferenca',
        value: isNumber(spread.difference)
          ? (spread.difference > 0 ? '+' : '') + money(spread.difference)
          : 'Indisponivel',
        color: deltaColor(spread.difference)
      }
    ];

    columns.forEach((column, index) => {
      const columnX = x + padding + columnWidth * index;
      label(ctx, column.title, columnX, y + 92 * scale, 13 * scale, PALETTE.muted, 2 * scale);
      ctx.fillStyle = column.color;
      ctx.font = font(500, 38 * scale, MONO);
      ctx.fillText(column.value, columnX, y + 142 * scale);
    });

    ctx.fillStyle = PALETTE.dim;
    ctx.font = font(400, 15 * scale, SANS);
    ctx.fillText('Conversao direta de bolsa, sem diferencial, tipo, bebida, frete ou impostos.',
      x + padding, y + height - 26 * scale);

    return y + height;
  };

  /** Grade de cotacoes de apoio, sem caixas: apenas linha e respiro. */
  const drawQuotes = (ctx, quotes, x, y, width, columns, scale) => {
    const rowHeight = 108 * scale;
    const columnWidth = width / columns;
    const rows = Math.ceil(quotes.length / columns);

    quotes.forEach((quote, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cellX = x + column * columnWidth;
      const cellY = y + row * rowHeight;

      ctx.fillStyle = PALETTE.line;
      ctx.fillRect(cellX, cellY, columnWidth - 24 * scale, 2);

      label(ctx, quote.name, cellX, cellY + 36 * scale, 14 * scale, PALETTE.muted, 2 * scale);

      ctx.fillStyle = quote.available ? PALETTE.text : PALETTE.dim;
      ctx.font = font(500, quote.available ? 34 * scale : 22 * scale, MONO);
      ctx.fillText(quote.value, cellX, cellY + 78 * scale);

      if (quote.available && quote.delta !== null) {
        const valueWidth = ctx.measureText(quote.value).width;
        ctx.fillStyle = deltaColor(quote.delta);
        ctx.font = font(500, 20 * scale, MONO);
        ctx.fillText(percent(quote.delta), cellX + valueWidth + 14 * scale, cellY + 78 * scale);
      }
    });

    return y + rows * rowHeight;
  };

  /** Faixa de clima. So entra quando ha leitura das pracas produtoras. */
  const drawWeather = (ctx, weather, x, y, width, scale) => {
    const usable = (weather || []).filter(region => region.status === 'available');
    if (!usable.length) return y;

    const height = 128 * scale;
    rect(ctx, x, y, width, height, PALETTE.panel);
    strokeRect(ctx, x, y, width, height, PALETTE.line);

    const padding = 28 * scale;
    label(ctx, 'Clima nas pracas produtoras / proximos 7 dias', x + padding, y + 38 * scale, 13 * scale, PALETTE.gold, 2 * scale);

    const columnWidth = (width - padding * 2) / usable.length;
    usable.forEach((region, index) => {
      const columnX = x + padding + columnWidth * index;
      ctx.fillStyle = PALETTE.text;
      ctx.font = font(600, 19 * scale, SANS);
      ctx.fillText(region.name, columnX, y + 74 * scale);

      const alert = region.frostRisk && region.frostRisk !== 'sem risco';
      ctx.fillStyle = alert ? PALETTE.down : PALETTE.muted;
      ctx.font = font(400, 17 * scale, MONO);
      ctx.fillText(
        decimal(region.rainNext7, 0) + ' mm  min ' + decimal(region.minTempNext7, 0) + 'C'
        + (alert ? '  geada: ' + region.frostRisk : ''),
        columnX, y + 102 * scale
      );
    });

    return y + height;
  };

  /* ---------------------------------------------------------- composicao */

  const buildQuotes = assets => {
    const pick = id => assets.find(asset => asset.id === id);
    const entries = [
      ['usd-ptax', 'Dolar PTAX'],
      ['ibovespa', 'Ibovespa'],
      ['sugar', 'Acucar NY'],
      ['oil-wti', 'Petroleo WTI'],
      ['soybean', 'Soja CBOT'],
      ['corn', 'Milho CBOT']
    ];

    return entries.map(([id, name]) => {
      const asset = pick(id);
      const available = Boolean(asset && asset.status === 'available');
      const digits = asset && Math.abs(Number(asset.value)) >= 1000 ? 0 : 2;
      return {
        name,
        available,
        value: available ? decimal(asset.value, digits) + ' ' + (asset.unit || '') : 'Indisponivel',
        delta: available && isNumber(asset.changePercent) ? asset.changePercent : null
      };
    });
  };

  const computeSpread = (bagEquivalents, physicalArabica) => {
    const converted = bagEquivalents && bagEquivalents[0] ? bagEquivalents[0].value : null;
    const physical = physicalArabica ? physicalArabica.value : null;
    return {
      converted,
      physical,
      difference: isNumber(converted) && isNumber(physical) ? physical - converted : null
    };
  };

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} payload  { coffee, assets, bagEquivalents, physicalArabica, weather, title, summary, editionDate }
   * @param {string} formatKey  'landscape' ou 'portrait'
   */
  const render = (canvas, payload, formatKey) => {
    const format = FORMATS[formatKey] || FORMATS.landscape;
    const portrait = formatKey === 'portrait';
    const scale = portrait ? 1.05 : 1;

    canvas.width = format.width;
    canvas.height = format.height;

    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    rect(ctx, 0, 0, format.width, format.height, PALETTE.bg);

    // Brilho discreto no topo, o mesmo da area publica.
    const glow = ctx.createRadialGradient(
      format.width * 0.15, 0, 0,
      format.width * 0.15, 0, format.width * 0.7
    );
    glow.addColorStop(0, 'rgba(216, 175, 88, .10)');
    glow.addColorStop(1, 'rgba(216, 175, 88, 0)');
    rect(ctx, 0, 0, format.width, format.height, glow);

    const margin = portrait ? 64 : 88;
    const contentWidth = format.width - margin * 2;

    drawBrand(ctx, margin, margin, scale);

    ctx.fillStyle = PALETTE.dim;
    ctx.font = font(400, 20 * scale, MONO);
    ctx.textAlign = 'right';
    ctx.fillText(payload.editionDate || '', format.width - margin, margin + 36 * scale);
    ctx.textAlign = 'left';

    let cursor = margin + 130 * scale;

    // Manchete da edicao.
    ctx.fillStyle = PALETTE.text;
    ctx.font = font(400, (portrait ? 62 : 68) * scale, DISPLAY);
    cursor = drawWrapped(
      ctx,
      String(payload.title || 'Giro do mercado').toUpperCase(),
      margin, cursor, contentWidth, (portrait ? 66 : 72) * scale, 2
    ) + 24 * scale;

    if (payload.summary) {
      ctx.fillStyle = PALETTE.muted;
      ctx.font = font(400, 24 * scale, SANS);
      // Em paisagem a altura e o recurso escasso: uma linha de resumo apenas.
      cursor = drawWrapped(ctx, payload.summary, margin, cursor, contentWidth, 36 * scale, portrait ? 3 : 1) + 40 * scale;
    }

    const spread = computeSpread(payload.bagEquivalents, payload.physicalArabica);
    const quotes = buildQuotes(payload.assets || []);

    // O rodape e a linha que nenhum bloco pode cruzar.
    const footerY = format.height - margin;
    const floor = footerY - 48 * scale;

    if (portrait) {
      cursor = drawHero(ctx, payload.coffee, margin, cursor, contentWidth, scale) + 24;
      cursor = drawSpread(ctx, spread, margin, cursor, contentWidth, scale) + 40;
      cursor = drawQuotes(ctx, quotes, margin, cursor, contentWidth, 2, scale) + 24;
      if (cursor + 128 * scale <= floor) {
        drawWeather(ctx, payload.weather, margin, cursor, contentWidth, scale);
      }
    } else {
      // Duas colunas: numero do cafe a esquerda, mercado de apoio a direita.
      // O clima fecha a coluna da direita, e nao a largura toda, senao ele
      // desce abaixo da base do cartao.
      const columnGap = 48;
      const leftWidth = contentWidth * 0.58;
      const rightX = margin + leftWidth + columnGap;
      const rightWidth = contentWidth - leftWidth - columnGap;

      const afterHero = drawHero(ctx, payload.coffee, margin, cursor, leftWidth, scale) + 24;
      drawSpread(ctx, spread, margin, afterHero, leftWidth, scale);

      const afterQuotes = drawQuotes(ctx, quotes, rightX, cursor, rightWidth, 2, scale) + 24;
      if (afterQuotes + 128 * scale <= floor) {
        drawWeather(ctx, payload.weather, rightX, afterQuotes, rightWidth, scale);
      }
    }

    ctx.fillStyle = PALETTE.dim;
    ctx.font = font(400, 17 * scale, SANS);
    ctx.fillText('Fontes: ICE via Yahoo Finance, CEPEA/ESALQ, Banco Central e Open-Meteo. '
      + 'Conteudo informativo, nao e recomendacao de investimento.', margin, footerY);

    rect(ctx, 0, format.height - 10, format.width, 10, PALETTE.gold);

    return canvas;
  };

  const toBlob = (canvas, quality) => new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality === undefined ? 0.92 : quality);
  });

  window.InvestbrasCard = { render, toBlob, FORMATS, PALETTE };
})();
