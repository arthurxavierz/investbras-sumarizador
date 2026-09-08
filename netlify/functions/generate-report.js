'use strict';

const { json, preflight, fail, requireMethod, readBody, timeoutFetch, log } = require('./_utils');
const { requireSession } = require('./_auth');
const marketData = require('./market-data');
const marketNews = require('./market-news');
const marketAgenda = require('./market-agenda');
const marketPhysical = require('./market-physical');

const SECTIONS = ['coffee', 'weather', 'brazil', 'global', 'geopolitics', 'commodities', 'agenda', 'notes'];

const call = async (handler, forceRefresh) => {
  const response = await handler.handler({ httpMethod: 'GET', headers: {}, forceRefresh });
  try {
    return JSON.parse(response.body || '{}');
  } catch {
    return null;
  }
};

// Number(null) e 0, entao o teste precisa descartar nulo antes de converter.
const number = value => (value === null || value === undefined || value === ''
  ? null
  : (Number.isFinite(Number(value)) ? Number(value) : null));

const assetLine = asset => {
  if (!asset || asset.status !== 'available') return null;
  const change = number(asset.changePercent);
  const variation = change === null
    ? 'variacao nao informada pela fonte'
    : (change > 0 ? '+' : '') + change.toFixed(2) + '%';
  return asset.name + ': ' + asset.value + ' ' + (asset.unit || '') + ' (' + variation + ')';
};

const lines = (assets, ids) => ids
  .map(id => assetLine(assets.find(asset => asset.id === id)))
  .filter(Boolean)
  .join('\n');

/** Rascunho deterministico: so reorganiza os numeros que chegaram das fontes. */
const deterministicDraft = ({ assets, news, agenda, bagEquivalents, macro, indicators, weather }) => {
  const available = assets.filter(asset => asset.status === 'available');
  const coffee = assets.find(asset => asset.id === 'coffee-c');
  const robusta = assets.find(asset => asset.id === 'coffee-robusta');

  const coffeeLines = [assetLine(coffee), assetLine(robusta)].filter(Boolean);
  for (const equivalent of bagEquivalents) {
    coffeeLines.push(equivalent.name + ': R$ ' + equivalent.value.toFixed(2) + ' por saca de 60 kg. Calculo: ' + equivalent.formula + '.');
  }

  // Fisico e clima entram como blocos proprios: sao a leitura que a bolsa
  // sozinha nao da.
  const available_ = (indicators || []).filter(item => item.status === 'available');
  const physicalLines = available_.map(item =>
    item.name + ' (CEPEA): R$ ' + item.value.toFixed(2) + ' por ' + item.unit.replace('BRL/', '')
    + (item.referenceDate ? ', referencia de ' + item.referenceDate.split('-').reverse().join('/') : ''));

  const arabicaPhysical = available_.find(item => item.key === 'arabica');
  const converted = bagEquivalents[0];
  if (arabicaPhysical && converted) {
    const difference = arabicaPhysical.value - converted.value;
    physicalLines.push('Diferenca entre fisico e bolsa convertida: R$ ' + difference.toFixed(2)
      + ' por saca (' + ((difference / converted.value) * 100).toFixed(1) + '%).');
  }

  const weatherLines = (weather || [])
    .filter(region => region.status === 'available')
    .map(region => region.name + ' (' + region.crop + '): ' + region.rainNext7
      + ' mm previstos em 7 dias, minima de ' + region.minTempNext7 + ' C, geada ' + region.frostRisk + '.');

  return {
    title: 'Giro do mercado Investbras',
    summary: available.length
      ? 'Rascunho montado com ' + available.length + ' referencias de mercado disponiveis. Revise contexto, causalidade e risco antes de publicar.'
      : 'Rascunho criado sem cotacoes disponiveis. Conecte as fontes ou escreva manualmente antes de publicar.',
    coffee: coffeeLines.length
      ? coffeeLines.join('\n')
        + (physicalLines.length ? '\n\n' + physicalLines.join('\n') : '')
        + '\n\nEquivalencias sao conversao direta de bolsa. Diferencial, tipo, bebida e frete entram na leitura da mesa.'
      : 'Cafe indisponivel nesta consulta. Nao publicar valor sem fonte confirmada.',
    weather: weatherLines.length
      ? weatherLines.join('\n')
      : 'Leitura climatica das pracas produtoras indisponivel nesta consulta.',
    brazil: [lines(assets, ['usd-ptax', 'usd-brl', 'ibovespa']), macro.map(item => item.label + ': ' + item.value + ' ' + item.unit + ' (ref. ' + item.reference + ')').join('\n')]
      .filter(Boolean).join('\n') || 'Brasil sem dados suficientes nesta consulta.',
    global: lines(assets, ['sp500', 'nasdaq', 'hang-seng']) || 'Exterior sem dados suficientes nesta consulta.',
    geopolitics: 'Registrar apenas eventos verificados com impacto em cafe, insumos, energia, frete, cambio ou politica monetaria.',
    commodities: lines(assets, ['sugar', 'oil-wti', 'gold', 'soybean', 'corn']) || 'Commodities indisponiveis nesta consulta.',
    agenda: agenda.length
      ? agenda.slice(0, 6).map(item => item.day + ' ' + item.time + ' - ' + item.title + ' (' + item.source + ')').join('\n')
      : 'Agenda sem eventos na janela consultada.',
    notes: news.length
      ? 'Manchetes captadas:\n' + news.slice(0, 6).map(item => '- ' + item.title + ' (' + item.source + ')').join('\n')
      : 'Nenhum feed de noticias respondeu nesta consulta.'
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
  'Voce e o analista da mesa de mercado da Investbras, corretora de cafe.',
  'Escreva em portugues do Brasil, tom profissional e direto, sem jargao de marketing.',
  'REGRA ABSOLUTA: use somente os numeros do JSON fornecido. Nunca invente cotacao, percentual, data ou evento.',
  'Se um dado estiver ausente, escreva explicitamente que a fonte nao respondeu.',
  'Nao faca recomendacao de compra ou venda. Descreva o que os dados mostram e quais riscos observar.',
  'Cada secao tem no maximo 3 paragrafos curtos. Sem titulos internos, sem listas com marcador, sem emoji.',
  'Responda apenas com um objeto JSON valido com as chaves: title, summary, coffee, weather, brazil, global, geopolitics, commodities, agenda, notes.'
].join(' ');

const buildUserPrompt = input => [
  'Data da edicao: ' + new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '.',
  'Dados verificados disponiveis:',
  JSON.stringify(input, null, 2),
  'Monte o giro do dia com foco em cafe arabica e robusta, incluindo a diferenca entre bolsa e fisico CEPEA, depois clima nas pracas produtoras, cambio, bolsas, commodities correlatas, risco geopolitico e agenda.'
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

/** So aceita a resposta da IA se ela preencher o essencial. */
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

    // O painel pode pedir releitura: ignora o cache quente das tres fontes.
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
          cotacoes: assets.filter(asset => asset.status === 'available').map(asset => ({
            ativo: asset.name,
            valor: asset.value,
            unidade: asset.unit,
            variacaoPercentual: number(asset.changePercent),
            maxima: asset.high,
            minima: asset.low,
            fonte: asset.source
          })),
          indisponiveis: assets.filter(asset => asset.status !== 'available').map(asset => asset.name),
          equivalenciasSaca: bagEquivalents,
          precoFisicoCepea: indicators.filter(item => item.status === 'available').map(item => ({
            produto: item.name, valor: item.value, unidade: item.unit, referencia: item.referenceDate
          })),
          climaPracasProdutoras: weather.filter(region => region.status === 'available').map(region => ({
            praca: region.name, cultivo: region.crop, chuvaProximos7Dias: region.rainNext7,
            minimaPrevista: region.minTempNext7, riscoGeada: region.frostRisk
          })),
          macroBrasil: macro,
          manchetes: news.slice(0, 12).map(item => ({ titulo: item.title, fonte: item.source, tema: item.category })),
          agenda: agenda.slice(0, 10).map(item => ({ dia: item.day, hora: item.time, evento: item.title, fonte: item.source }))
        };

        const ai = provider === 'openai' ? await callOpenAi(aiInput) : await callGemini(aiInput);
        const merged = mergeDraft(draft, ai);
        if (merged) {
          draft = merged;
          mode = provider;
        } else {
          aiError = 'A resposta da IA veio incompleta. Mantido o rascunho tecnico.';
        }
      } catch (error) {
        aiError = 'IA indisponivel nesta execucao: ' + error.message;
        await log('warning', 'ai', 'Falha na geracao assistida', { provider, message: error.message });
      }
    }

    const message = mode === 'deterministico'
      ? (provider
        ? (aiError || 'Rascunho tecnico gerado sem interpretacao da IA.')
        : 'Rascunho tecnico gerado. Configure OPENAI_API_KEY ou GEMINI_API_KEY para a leitura assistida.')
      : 'Rascunho interpretado por IA sobre dados verificados. Revisao humana obrigatoria antes de publicar.';

    await log('info', 'report', 'Rascunho gerado', { mode, by: session.sub });

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
    return fail(error, 'Nao foi possivel gerar o rascunho agora.');
  }
};
