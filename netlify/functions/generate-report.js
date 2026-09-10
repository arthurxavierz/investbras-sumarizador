'use strict';

const { json, preflight, fail, requireMethod, readBody, timeoutFetch, log } = require('./_utils');
const { requireSession } = require('./_auth');
const marketData = require('./market-data');
const marketNews = require('./market-news');
const marketAgenda = require('./market-agenda');
const marketPhysical = require('./market-physical');
const { FROST_LABEL } = marketPhysical;

const SECTIONS = ['coffee', 'weather', 'brazil', 'global', 'geopolitics', 'commodities', 'agenda', 'notes'];

const call = async (handler, forceRefresh) => {
  const response = await handler.handler({ httpMethod: 'GET', headers: {}, forceRefresh });
  try {
    return JSON.parse(response.body || '{}');
  } catch {
    return null;
  }
};

// Number(null) e 0, então o teste precisa descartar nulo antes de converter.
const number = value => (value === null || value === undefined || value === ''
  ? null
  : (Number.isFinite(Number(value)) ? Number(value) : null));

const assetLine = asset => {
  if (!asset || asset.status !== 'available') return null;
  const change = number(asset.changePercent);
  const variation = change === null
    ? 'variação não informada pela fonte'
    : (change > 0 ? '+' : '') + change.toFixed(2) + '%';
  return asset.name + ': ' + asset.value + ' ' + (asset.unit || '') + ' (' + variation + ')';
};

const lines = (assets, ids) => ids
  .map(id => assetLine(assets.find(asset => asset.id === id)))
  .filter(Boolean)
  .join('\n');

/** Montagem determinística: só reorganiza os números que chegaram das fontes. */
const deterministicDraft = ({ assets, news, agenda, bagEquivalents, macro, indicators, weather }) => {
  const available = assets.filter(asset => asset.status === 'available');
  const coffee = assets.find(asset => asset.id === 'coffee-c');
  const robusta = assets.find(asset => asset.id === 'coffee-robusta');

  const coffeeLines = [assetLine(coffee), assetLine(robusta)].filter(Boolean);
  for (const equivalent of bagEquivalents) {
    coffeeLines.push(equivalent.name + ': R$ ' + equivalent.value.toFixed(2) + ' por saca de 60 kg. Calculo: ' + equivalent.formula + '.');
  }

  // Físico e clima entram como blocos próprios: são a leitura que a bolsa
  // sozinha não da.
  const available_ = (indicators || []).filter(item => item.status === 'available');
  const physicalLines = available_.map(item =>
    item.name + ' (CEPEA): R$ ' + item.value.toFixed(2) + ' por ' + item.unit.replace('BRL/', '')
    + (item.referenceDate ? ', referência de ' + item.referenceDate.split('-').reverse().join('/') : ''));

  const arabicaPhysical = available_.find(item => item.key === 'arabica');
  const converted = bagEquivalents[0];
  if (arabicaPhysical && converted) {
    const difference = arabicaPhysical.value - converted.value;
    physicalLines.push('Diferenca entre físico e bolsa convertida: R$ ' + difference.toFixed(2)
      + ' por saca (' + ((difference / converted.value) * 100).toFixed(1) + '%).');
  }

  const weatherLines = (weather || [])
    .filter(region => region.status === 'available')
    .map(region => region.name + ' (' + region.crop + '): ' + region.rainNext7
      + ' mm previstos em 7 dias, mínima de ' + region.minTempNext7 + ' C, geada ' + (FROST_LABEL[region.frostRisk] || region.frostRisk) + '.');

  return {
    title: 'Giro do mercado Investbras',
    summary: available.length
      ? 'Edição montada com ' + available.length + ' referências de mercado disponíveis. Revise contexto, causalidade e risco antes de publicar.'
      : 'Edição montada sem cotações disponíveis. Conecte as fontes ou escreva manualmente antes de publicar.',
    coffee: coffeeLines.length
      ? coffeeLines.join('\n')
        + (physicalLines.length ? '\n\n' + physicalLines.join('\n') : '')
        + '\n\nEquivalencias são conversão direta de bolsa. Diferencial, tipo, bebida e frete entram na leitura da mesa.'
      : 'Café indisponível nesta consulta. Não publicar valor sem fonte confirmada.',
    weather: weatherLines.length
      ? weatherLines.join('\n')
      : 'Leitura climatica das praças produtoras indisponível nesta consulta.',
    brazil: [lines(assets, ['usd-ptax', 'usd-brl', 'ibovespa']), macro.map(item => item.label + ': ' + item.value + ' ' + item.unit + ' (ref. ' + item.reference + ')').join('\n')]
      .filter(Boolean).join('\n') || 'Brasil sem dados suficientes nesta consulta.',
    global: lines(assets, ['sp500', 'nasdaq', 'hang-seng']) || 'Exterior sem dados suficientes nesta consulta.',
    geopolitics: 'Registrar apenas eventos verificados com impacto em café, insumos, energia, frete, câmbio ou política monetária.',
    commodities: lines(assets, ['sugar', 'oil-wti', 'gold', 'soybean', 'corn']) || 'Commodities indisponíveis nesta consulta.',
    agenda: agenda.length
      ? agenda.slice(0, 6).map(item => item.day + ' ' + item.time + ' - ' + item.title + ' (' + item.source + ')').join('\n')
      : 'Agenda sem eventos na janela consultada.',
    notes: news.length
      ? 'Manchetes captadas:\n' + news.slice(0, 6).map(item => '- ' + item.title + ' (' + item.source + ')').join('\n')
      : 'Nenhum feed de notícias respondeu nesta consulta.'
  };
};

const providerConfig = () => {
  const preferred = String(process.env.AI_PROVIDER || '').toLowerCase();
  if (preferred === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (preferred === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
};

const SYSTEM_PROMPT = [
  'Você e o analista da mesa de mercado da Investbras, corretora de café.',
  'Escreva em português do Brasil, tom profissional e direto, sem jargao de marketing.',
  'REGRA ABSOLUTA: use somente os números do JSON fornecido. Nunca invente cotação, percentual, data ou evento.',
  'Se um dado estiver ausente, escreva explicitamente que a fonte não respondeu.',
  'Não faca recomendacao de compra ou venda. Descreva o que os dados mostram e quais riscos observar.',
  'Cada seção tem no máximo 3 paragrafos curtos. Sem títulos internos, sem listas com marcador, sem emoji.',
  'Responda apenas com um objeto JSON válido com as chaves: title, summary, coffee, weather, brazil, global, geopolitics, commodities, agenda, notes.'
].join(' ');

const buildUserPrompt = input => [
  'Data da edição: ' + new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '.',
  'Dados verificados disponíveis:',
  JSON.stringify(input, null, 2),
  'Monte o giro do dia com foco em café arabica e robusta, incluindo a diferenca entre bolsa e físico CEPEA, depois clima nas praças produtoras, câmbio, bolsas, commodities correlatas, risco geopolítico e agenda.'
].join('\n\n');

const parseAiJson = raw => {
  const clean = String(raw || '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Resposta da IA sem JSON identificavel');
  return JSON.parse(clean.slice(start, end + 1));
};

const callOpenAi = async input => {
  const response = await timeoutFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) }
      ]
    })
  }, 25000);

  if (!response.ok) throw new Error('OpenAI respondeu ' + response.status);
  const payload = await response.json();
  return parseAiJson(payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content);
};

const callGemini = async input => {
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + process.env.GEMINI_API_KEY;

  const response = await timeoutFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input) }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
    })
  }, 25000);

  if (!response.ok) throw new Error('Gemini respondeu ' + response.status);
  const payload = await response.json();
  const candidate = payload.candidates && payload.candidates[0];
  const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
  return parseAiJson(text);
};

/** Só aceita a resposta da IA se ela preencher o essencial. */
const mergeDraft = (base, ai) => {
  if (!ai || typeof ai !== 'object') return null;
  const merged = Object.assign({}, base);
  if (typeof ai.title === 'string' && ai.title.trim()) merged.title = ai.title.trim().slice(0, 180);
  if (typeof ai.summary === 'string' && ai.summary.trim()) merged.summary = ai.summary.trim().slice(0, 1200);
  let filled = 0;
  for (const field of SECTIONS) {
    if (typeof ai[field] === 'string' && ai[field].trim().length > 30) {
      merged[field] = ai[field].trim().slice(0, 8000);
      filled += 1;
    }
  }
  return filled >= 3 ? merged : null;
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  try {
    requireMethod(event, ['POST']);
    const session = requireSession(event);

    // O painel pode pedir releitura: ignora o cache quente das três fontes.
    const forceRefresh = readBody(event).refresh === true;
    const payloads = await Promise.all([
      call(marketData, forceRefresh),
      call(marketNews, forceRefresh),
      call(marketAgenda, forceRefresh),
      call(marketPhysical, forceRefresh)
    ]);
    const dataPayload = payloads[0];
    const newsPayload = payloads[1];
    const agendaPayload = payloads[2];
    const physicalPayload = payloads[3];

    const assets = (dataPayload && dataPayload.data && dataPayload.data.assets) || [];
    const news = (newsPayload && newsPayload.data) || [];
    const agenda = (agendaPayload && agendaPayload.data) || [];
    const bagEquivalents = (dataPayload && dataPayload.data && dataPayload.data.bagEquivalents) || [];
    const macro = (dataPayload && dataPayload.data && dataPayload.data.macro) || [];
    const indicators = (physicalPayload && physicalPayload.data && physicalPayload.data.indicators) || [];
    const weather = (physicalPayload && physicalPayload.data && physicalPayload.data.weather) || [];

    const context = { assets, news, agenda, bagEquivalents, macro, indicators, weather };
    let draft = deterministicDraft(context);
    let mode = 'deterministico';
    let aiError = null;

    const provider = providerConfig();
    const hasInput = assets.some(asset => asset.status === 'available') || news.length || agenda.length;

    if (provider && hasInput) {
      try {
        const aiInput = {
          cotações: assets.filter(asset => asset.status === 'available').map(asset => ({
            ativo: asset.name,
            valor: asset.value,
            unidade: asset.unit,
            variacaoPercentual: number(asset.changePercent),
            máxima: asset.high,
            mínima: asset.low,
            fonte: asset.source
          })),
          indisponíveis: assets.filter(asset => asset.status !== 'available').map(asset => asset.name),
          equivalenciasSaca: bagEquivalents,
          precoFisicoCepea: indicators.filter(item => item.status === 'available').map(item => ({
            produto: item.name, valor: item.value, unidade: item.unit, referência: item.referenceDate
          })),
          climaPracasProdutoras: weather.filter(region => region.status === 'available').map(region => ({
            praça: region.name, cultivo: region.crop, chuvaProximos7Dias: region.rainNext7,
            minimaPrevista: region.minTempNext7, riscoGeada: FROST_LABEL[region.frostRisk] || region.frostRisk
          })),
          macroBrasil: macro,
          manchetes: news.slice(0, 12).map(item => ({ título: item.title, fonte: item.source, tema: item.category })),
          agenda: agenda.slice(0, 10).map(item => ({ dia: item.day, hora: item.time, evento: item.title, fonte: item.source }))
        };

        const ai = provider === 'openai' ? await callOpenAi(aiInput) : await callGemini(aiInput);
        const merged = mergeDraft(draft, ai);
        if (merged) {
          draft = merged;
          mode = provider;
        } else {
          aiError = 'A resposta da IA veio incompleta. Mantido o texto técnico.';
        }
      } catch (error) {
        aiError = 'IA indisponível nesta execucao: ' + error.message;
        await log('warning', 'ai', 'Falha na geração assistida', { provider, message: error.message });
      }
    }

    const message = mode === 'deterministico'
      ? (provider
        ? (aiError || 'Texto técnico montado sem interpretação da IA.')
        : 'Texto técnico montado. Configure OPENAI_API_KEY ou GEMINI_API_KEY para a leitura assistida.')
      : 'Texto interpretado por IA sobre dados verificados. Revisão humana obrigatória antes de publicar.';

    await log('info', 'report', 'Edição montada', { mode, by: session.sub });

    return json(200, {
      success: Boolean(hasInput),
      source: 'investbras-intelligence',
      status: hasInput ? 'draft-ready' : 'needs-sources',
      message,
      data: {
        draft,
        mode,
        aiError,
        refreshed: forceRefresh,
        inputs: {
          marketData: (dataPayload && dataPayload.status) || 'unavailable',
          news: (newsPayload && newsPayload.status) || 'unavailable',
          agenda: (agendaPayload && agendaPayload.status) || 'unavailable',
          availableAssets: assets.filter(asset => asset.status === 'available').length,
          totalAssets: assets.length,
          newsItems: news.length,
          agendaItems: agenda.length
        }
      }
    }, 0);
  } catch (error) {
    return fail(error, 'Não foi possível atualizar as informações agora.');
  }
};
