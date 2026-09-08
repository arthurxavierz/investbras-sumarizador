'use strict';

/**
 * Entrada manual dos indicadores de mercado fisico.
 *
 * O CEPEA bloqueia requisicao vinda do datacenter das Functions, entao a
 * coleta automatica falha em producao mesmo funcionando de um navegador no
 * Brasil. Como a mesa consulta o indicador diariamente de qualquer forma,
 * este endpoint deixa ela registrar o numero uma vez e todo o resto do
 * sistema passa a usar: pagina publica, rascunho, card e e-mail.
 *
 * O valor fica sempre rotulado com a data de referencia e a origem, para
 * ninguem confundir leitura informada com leitura coletada.
 */

const { json, preflight, fail, httpError, requireMethod, readBody, text, hasSupabase, supabase, log } = require('./_utils');
const { requireSession } = require('./_auth');

const ALLOWED = {
  arabica: { name: 'Cafe arabica', unit: 'BRL/saca 60kg', max: 10000 },
  robusta: { name: 'Cafe robusta', unit: 'BRL/saca 60kg', max: 10000 },
  sugar: { name: 'Acucar cristal SP', unit: 'BRL/saca 50kg', max: 1000 },
  cattle: { name: 'Boi gordo', unit: 'BRL/arroba', max: 2000 }
};

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Aceita "1659,93" e "1659.93", que e como o numero aparece no site. */
const parseValue = (raw, max) => {
  const clean = String(raw === null || raw === undefined ? '' : raw)
    .trim()
    .replace(/\s/g, '')
    .replace(/^R\$/i, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');

  const value = Number(clean);
  if (!Number.isFinite(value) || value <= 0) throw httpError(400, 'Valor invalido.');
  if (value > max) throw httpError(400, 'Valor acima do limite razoavel para este indicador.');
  return Math.round(value * 100) / 100;
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  try {
    requireMethod(event, ['POST']);
    const session = requireSession(event);

    if (!hasSupabase()) {
      return json(503, {
        success: false,
        status: 'not-configured',
        error: 'Configure o Supabase para guardar o indicador informado.'
      }, 0);
    }

    const body = readBody(event);
    const key = String(body.key || '');
    const definition = ALLOWED[key];
    if (!definition) throw httpError(400, 'Indicador desconhecido.');

    const value = parseValue(body.value, definition.max);

    const referenceDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.referenceDate || ''))
      ? body.referenceDate
      : today();

    if (referenceDate > today()) throw httpError(400, 'A data de referencia nao pode ser no futuro.');

    await supabase('physical_indicators', {
      method: 'POST',
      body: {
        key,
        name: definition.name,
        value,
        unit: definition.unit,
        reference_date: referenceDate,
        source: text(body.source, { max: 80, field: 'fonte' }) || 'CEPEA/ESALQ',
        origin: 'manual',
        entered_by: session.sub,
        updated_at: new Date().toISOString()
      },
      prefer: 'resolution=merge-duplicates,return=minimal'
    });

    await log('info', 'physical', 'Indicador informado pela mesa', {
      key, value, referenceDate, by: session.sub
    });

    return json(200, {
      success: true,
      status: 'saved',
      message: definition.name + ' registrado em '
        + referenceDate.split('-').reverse().join('/') + '.',
      data: { key, value, unit: definition.unit, referenceDate }
    }, 0);
  } catch (error) {
    return fail(error, 'Nao foi possivel registrar o indicador.');
  }
};

exports.ALLOWED = ALLOWED;
