/* Gerador do card de mercado.
   Desenha em canvas e exporta em JPG. Todo número vem das Functions: o card
   nunca inventa valor, e um dado ausente aparece como indisponível.

   A tipografia aqui é de propósito diferente da usada no site. A página é um
   terminal de leitura contínua; o card é peça de circulação, vista por poucos
   segundos no celular. Archivo Black dá peso de manchete impressa, e o IBM
   Plex carrega o número com cara de relatório técnico. */

(() => {
  const PALETTE = {
    bg: '#0C0B09',
    panel: '#131210',
    raised: '#1A1815',
    line: '#2A2620',
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

  const DISPLAY = '"Archivo Black", "Arial Black", sans-serif';
  const SANS = '"IBM Plex Sans Condensed", "IBM Plex Sans", sans-serif';
  const MONO = '"IBM Plex Mono", Consolas, monospace';

  const FROST_LABEL = {
    none: 'sem risco', watch: 'observar', alert: 'atenção',
    severe: 'risco severo', unknown: 'sem leitura'
  };

  // Story primeiro: é como a edição circula no celular.
  const FORMATS = {
    portrait: { width: 1080, height: 1920, name: 'story' },
    landscape: { width: 1920, height: 1080, name: 'post' }
  };

  const nf = (value, options) => new Intl.NumberFormat('pt-BR', options).format(value);
  const isNumber = value => value !== null && value !== undefined && Number.isFinite(Number(value));

  const money = value => (isNumber(value)
    ? nf(Number(value), { style: 'currency', currency: 'BRL' })
    : 'Indisponível');

  const decimal = (value, digits) => (isNumber(value)
    ? nf(Number(value), {
      minimumFractionDigits: digits === undefined ? 2 : digits,
      maximumFractionDigits: digits === undefined ? 2 : digits
    })
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

  /* ------------------------------------------------------------ primitivas */

  const font = (weight, size, family) => weight + ' ' + size + 'px ' + family;

  const rect = (ctx, x, y, width, height, fill) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, width, height);
  };

  const hairline = (ctx, x, y, width, color) => rect(ctx, x, y, width, 2, color);

  /** Rótulo em caixa alta com espaçamento entre letras. */
  const label = (ctx, text, x, y, size, color, spacing) => {
    ctx.fillStyle = color;
    ctx.font = font(600, size, SANS);
    let cursor = x;
    for (const character of String(text).toUpperCase()) {
      ctx.fillText(character, cursor, y);
      cursor += ctx.measureText(character).width + (spacing === undefined ? size * 0.14 : spacing);
    }
    return cursor;
  };

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

  /* --------------------------------------------------------------- blocos */

  const drawHeader = (ctx, x, y, width, editionDate, scale) => {
    const size = 58 * scale;
    rect(ctx, x, y, size, size, PALETTE.gold);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(400, 25 * scale, DISPLAY);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('IB', x + size / 2, y + size / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = PALETTE.text;
    ctx.font = font(400, 28 * scale, DISPLAY);
    ctx.fillText('INVESTBRAS', x + size + 20 * scale, y + 27 * scale);
    label(ctx, 'Intelligence', x + size + 21 * scale, y + 50 * scale, 13 * scale, PALETTE.gold, 4.5 * scale);

    ctx.textAlign = 'right';
    ctx.fillStyle = PALETTE.dim;
    ctx.font = font(500, 19 * scale, MONO);
    ctx.fillText(editionDate || '', x + width, y + 38 * scale);
    ctx.textAlign = 'left';

    return y + size + 26 * scale;
  };

  /** Bloco principal: preço da bolsa, variação e a série da janela ao fundo. */
  const drawHero = (ctx, coffee, x, y, width, scale) => {
    const height = 300 * scale;
    rect(ctx, x, y, width, height, PALETTE.panel);

    const series = (coffee && coffee.series) || [];
    if (series.length > 2) {
      const min = Math.min.apply(null, series);
      const max = Math.max.apply(null, series);
      const span = max - min || 1;
      const chartTop = y + height * 0.42;
      const chartHeight = height * 0.58;
      const pointAt = index => x + (index / (series.length - 1)) * width;
      const valueAt = value => chartTop + chartHeight - ((value - min) / span) * chartHeight * 0.82;

      ctx.beginPath();
      series.forEach((value, index) => {
        if (index === 0) ctx.moveTo(pointAt(index), valueAt(value));
        else ctx.lineTo(pointAt(index), valueAt(value));
      });
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      ctx.fillStyle = 'rgba(216, 175, 88, .13)';
      ctx.fill();

      ctx.beginPath();
      series.forEach((value, index) => {
        if (index === 0) ctx.moveTo(pointAt(index), valueAt(value));
        else ctx.lineTo(pointAt(index), valueAt(value));
      });
      ctx.strokeStyle = PALETTE.gold;
      ctx.lineWidth = 3.5 * scale;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    const padding = 34 * scale;
    label(ctx, 'Café arábica / bolsa de Nova York', x + padding, y + 46 * scale, 16 * scale, PALETTE.gold, 3 * scale);

    const available = coffee && coffee.status === 'available';
    ctx.fillStyle = PALETTE.text;
    ctx.font = font(600, 108 * scale, MONO);
    const price = available ? decimal(coffee.value) : 'Indisponível';
    ctx.fillText(price, x + padding, y + 162 * scale);

    if (available) {
      const priceWidth = ctx.measureText(price).width;
      ctx.fillStyle = PALETTE.dim;
      ctx.font = font(400, 26 * scale, MONO);
      ctx.fillText(coffee.unit || 'c/lb', x + padding + priceWidth + 16 * scale, y + 162 * scale);
    }

    ctx.fillStyle = deltaColor(coffee && coffee.changePercent);
    ctx.font = font(600, 38 * scale, MONO);
    ctx.fillText(percent(coffee && coffee.changePercent), x + padding, y + 216 * scale);

    return y + height;
  };

  /**
   * O bloco que a mesa usa: bolsa convertida, físico e a diferença entre as
   * duas leituras da mesma saca.
   */
  const drawSpread = (ctx, spread, x, y, width, scale) => {
    const height = 214 * scale;
    rect(ctx, x, y, width, height, PALETTE.raised);
    rect(ctx, x, y, 5 * scale, height, PALETTE.gold);

    const padding = 34 * scale;
    label(ctx, 'Saca de 60 kg', x + padding, y + 44 * scale, 16 * scale, PALETTE.gold, 3 * scale);

    const columns = [
      { title: 'Bolsa convertida', value: money(spread.converted), color: PALETTE.text },
      { title: 'Físico', value: money(spread.physical), color: PALETTE.text },
      {
        title: 'Diferença',
        value: isNumber(spread.difference)
          ? (spread.difference > 0 ? '+' : '-') + money(Math.abs(spread.difference))
          : 'Indisponível',
        color: deltaColor(spread.difference)
      }
    ];

    const columnWidth = (width - padding * 2) / 3;
    columns.forEach((column, index) => {
      const columnX = x + padding + columnWidth * index;
      label(ctx, column.title, columnX, y + 96 * scale, 14 * scale, PALETTE.muted, 2 * scale);
      ctx.fillStyle = column.color;
      ctx.font = font(600, 34 * scale, MONO);
      ctx.fillText(column.value, columnX, y + 146 * scale);
    });

    ctx.fillStyle = PALETTE.dim;
    ctx.font = font(400, 16 * scale, SANS);
    ctx.fillText('Conversão direta de bolsa. Não inclui diferencial, tipo, bebida, frete ou impostos.',
      x + padding, y + height - 28 * scale);

    return y + height;
  };

  /** Grade de cotações sem caixa: hairline e respiro. */
  const drawQuotes = (ctx, quotes, x, y, width, columns, scale) => {
    const rowHeight = 116 * scale;
    const columnWidth = width / columns;
    const rows = Math.ceil(quotes.length / columns);

    quotes.forEach((quote, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cellX = x + column * columnWidth;
      const cellY = y + row * rowHeight;

      hairline(ctx, cellX, cellY, columnWidth - 26 * scale, PALETTE.line);
      label(ctx, quote.name, cellX, cellY + 38 * scale, 15 * scale, PALETTE.muted, 2 * scale);

      ctx.fillStyle = quote.available ? PALETTE.text : PALETTE.dim;
      ctx.font = font(600, quote.available ? 34 * scale : 22 * scale, MONO);
      ctx.fillText(quote.value, cellX, cellY + 84 * scale);

      if (quote.available && quote.delta !== null) {
        const valueWidth = ctx.measureText(quote.value).width;
        ctx.fillStyle = deltaColor(quote.delta);
        ctx.font = font(600, 20 * scale, MONO);
        ctx.fillText(percent(quote.delta), cellX + valueWidth + 12 * scale, cellY + 84 * scale);
      }
    });

    return y + rows * rowHeight;
  };

  const drawWeather = (ctx, weather, x, y, width, scale) => {
    const usable = (weather || []).filter(region => region.status === 'available');
    if (!usable.length) return y;

    const height = 132 * scale;
    rect(ctx, x, y, width, height, PALETTE.panel);

    const padding = 30 * scale;
    label(ctx, 'Clima nas praças / 7 dias', x + padding, y + 40 * scale, 14 * scale, PALETTE.gold, 2 * scale);

    const columnWidth = (width - padding * 2) / usable.length;
    usable.forEach((region, index) => {
      const columnX = x + padding + columnWidth * index;
      ctx.fillStyle = PALETTE.text;
      ctx.font = font(600, 19 * scale, SANS);
      ctx.fillText(region.name, columnX, y + 78 * scale);

      const alert = region.frostRisk && region.frostRisk !== 'none' && region.frostRisk !== 'unknown';
      ctx.fillStyle = alert ? PALETTE.down : PALETTE.muted;
      ctx.font = font(400, 18 * scale, MONO);
      ctx.fillText(
        decimal(region.rainNext7, 0) + 'mm  min ' + decimal(region.minTempNext7, 0) + 'C'
        + (alert ? '  ' + (FROST_LABEL[region.frostRisk] || '') : ''),
        columnX, y + 108 * scale
      );
    });

    return y + height;
  };

  /* ------------------------------------------------------------ composição */

  /** Prioriza o físico brasileiro, que é o preço que a mesa negocia. */
  const buildQuotes = (assets, indicators, limit) => {
    const asset = id => (assets || []).find(item => item.id === id);
    const physical = key => (indicators || []).find(item => item.key === key && item.status === 'available');

    const entries = [];

    const robusta = physical('robusta');
    if (robusta) {
      entries.push({ name: 'Café robusta', available: true, value: money(robusta.value), delta: robusta.changePercent });
    }

    for (const [key, name] of [['soybean', 'Soja'], ['cattle', 'Boi gordo'], ['corn', 'Milho']]) {
      const item = physical(key);
      if (item) entries.push({ name, available: true, value: money(item.value), delta: item.changePercent });
    }

    for (const [id, name] of [['usd-ptax', 'Dólar PTAX'], ['ibovespa', 'Ibovespa'], ['oil-wti', 'Petróleo WTI']]) {
      const item = asset(id);
      const available = Boolean(item && item.status === 'available');
      const digits = item && Math.abs(Number(item.value)) >= 1000 ? 0 : 2;
      entries.push({
        name,
        available,
        value: available ? decimal(item.value, digits) + ' ' + (item.unit || '') : 'Indisponível',
        delta: available && isNumber(item.changePercent) ? item.changePercent : null
      });
    }

    return entries.slice(0, limit);
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

  const render = (canvas, payload, formatKey) => {
    const key = FORMATS[formatKey] ? formatKey : 'portrait';
    const format = FORMATS[key];
    const portrait = key === 'portrait';
    const scale = portrait ? 1 : 0.94;

    canvas.width = format.width;
    canvas.height = format.height;

    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    rect(ctx, 0, 0, format.width, format.height, PALETTE.bg);

    const glow = ctx.createRadialGradient(
      format.width * 0.2, 0, 0,
      format.width * 0.2, 0, format.width * 0.95
    );
    glow.addColorStop(0, 'rgba(216, 175, 88, .11)');
    glow.addColorStop(1, 'rgba(216, 175, 88, 0)');
    rect(ctx, 0, 0, format.width, format.height, glow);

    const margin = portrait ? 60 : 84;
    const contentWidth = format.width - margin * 2;

    // O rodapé é a linha que nenhum bloco pode cruzar.
    const footerY = format.height - margin;
    const floor = footerY - 62 * scale;

    let cursor = drawHeader(ctx, margin, margin, contentWidth, payload.editionDate, scale);

    hairline(ctx, margin, cursor, contentWidth, PALETTE.line);
    cursor += 34 * scale;

    ctx.fillStyle = PALETTE.text;
    ctx.font = font(400, (portrait ? 60 : 54) * scale, DISPLAY);
    cursor = drawWrapped(
      ctx,
      String(payload.title || 'Giro do mercado').toUpperCase(),
      margin, cursor, contentWidth, (portrait ? 68 : 62) * scale, portrait ? 3 : 2
    ) + 20 * scale;

    if (payload.summary) {
      ctx.fillStyle = PALETTE.muted;
      ctx.font = font(400, 25 * scale, SANS);
      cursor = drawWrapped(ctx, payload.summary, margin, cursor, contentWidth, 36 * scale, portrait ? 3 : 1) + 32 * scale;
    }

    const spread = computeSpread(payload.bagEquivalents, payload.physicalArabica);
    const quotes = buildQuotes(payload.assets, payload.indicators, 6);

    if (portrait) {
      cursor = drawHero(ctx, payload.coffee, margin, cursor, contentWidth, scale) + 20;
      cursor = drawSpread(ctx, spread, margin, cursor, contentWidth, scale) + 32;
      cursor = drawQuotes(ctx, quotes, margin, cursor, contentWidth, 2, scale) + 18;
      if (cursor + 132 * scale <= floor) {
        drawWeather(ctx, payload.weather, margin, cursor, contentWidth, scale);
      }
    } else {
      const columnGap = 44;
      const leftWidth = contentWidth * 0.56;
      const rightX = margin + leftWidth + columnGap;
      const rightWidth = contentWidth - leftWidth - columnGap;

      const afterHero = drawHero(ctx, payload.coffee, margin, cursor, leftWidth, scale) + 20;
      drawSpread(ctx, spread, margin, afterHero, leftWidth, scale);

      const afterQuotes = drawQuotes(ctx, quotes, rightX, cursor, rightWidth, 2, scale) + 18;
      if (afterQuotes + 132 * scale <= floor) {
        drawWeather(ctx, payload.weather, rightX, afterQuotes, rightWidth, scale);
      }
    }

    ctx.fillStyle = PALETTE.dim;
    ctx.font = font(400, 17 * scale, SANS);
    ctx.fillText('Fontes: ICE via Yahoo Finance, indicadores do mercado físico, Banco Central e Open-Meteo.',
      margin, footerY - 24 * scale);
    ctx.fillText('Conteúdo informativo. Não é recomendação de investimento.', margin, footerY);

    rect(ctx, 0, format.height - 10, format.width, 10, PALETTE.gold);

    return canvas;
  };

  const toBlob = (canvas, quality) => new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality === undefined ? 0.92 : quality);
  });

  window.InvestbrasCard = { render, toBlob, FORMATS, PALETTE };
})();
