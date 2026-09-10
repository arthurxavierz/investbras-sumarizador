'use strict';

/**
 * Indicadores de preço do mercado físico brasileiro.
 *
 * Histórico da decisão: a primeira versão lia o widget do CEPEA direto. Ele
 * funciona de um IP brasileiro e responde 403 do datacenter onde as Functions
 * rodam, o que derrubava a coleta em produção sem aviso. Trocar cabeçalho não
 * resolve, porque o bloqueio é por faixa de IP.
 *
 * A leitura passou a vir das páginas de cotação do Notícias Agrícolas, que
 * respondem normalmente do datacenter e publicam o mesmo indicador com data e
 * variação do dia. A origem real de cada número continua declarada: o rótulo
 * capturado da página nomeia quem apura o indicador.
 *
 * A âncora do parser é o título imediatamente antes da tabela, não a posição
 * dela na página. Assim, se o portal inserir um bloco novo no meio, a leitura
 * continua encontrando o indicador certo em vez de trocar de tabela em
 * silêncio.
 */

const { retryFetch } = require('./_utils');

const BASE = 'https://www.noticiasagricolas.com.br/cotacoes/';

/**
 * Cada indicador declara onde procurar, como reconhecer o título e em que
 * faixa o valor precisa cair. A faixa é a defesa contra o portal mudar de
 * layout e o parser capturar um número de outra tabela.
 */
const INDICATORS = [
  {
    key: 'arabica',
    page: 'cafe',
    name: 'Café arábica',
    heading: /indicador[^<]*(arábica|arabica)/i,
    unit: 'BRL/saca 60kg',
    range: [200, 6000],
    highlight: true
  },
  {
    key: 'robusta',
    page: 'cafe',
    name: 'Café robusta',
    heading: /indicador[^<]*robusta/i,
    unit: 'BRL/saca 60kg',
    range: [150, 5000],
    highlight: true
  },
  {
    key: 'soybean',
    page: 'soja',
    name: 'Soja',
    heading: /indicador\s+da\s+soja/i,
    unit: 'BRL/saca 60kg',
    range: [40, 500],
    highlight: false
  },
  {
    key: 'cattle',
    page: 'boi-gordo',
    name: 'Boi gordo',
    heading: /indicador\s+do\s+boi\s+gordo/i,
    unit: 'BRL/arroba',
    range: [80, 900],
    highlight: false
  },
  {
    key: 'corn',
    page: 'milho',
    name: 'Milho',
    heading: /indicador\s+do\s+milho/i,
    unit: 'BRL/saca 60kg',
    range: [20, 300],
    highlight: false
  }
];

const strip = html => String(html || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&aacute;/gi, 'á')
  .replace(/\s+/g, ' ')
  .trim();

/** "1.647,29" vira 1647.29. */
const parseBrNumber = value => {
  const clean = String(value || '').replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
};

const parseIsoDate = value => {
  const match = String(value || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? match[3] + '-' + match[2] + '-' + match[1] : null;
};

const cells = row => Array.from(
  row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi),
  match => strip(match[1])
);

/** Título mais próximo acima da tabela, que é o que nomeia o indicador. */
const headingBefore = (html, tableIndex) => {
  const before = html.slice(Math.max(0, tableIndex - 800), tableIndex);
  const headings = Array.from(before.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi));
  return headings.length ? strip(headings[headings.length - 1][1]) : '';
};

const readPage = html => {
  const tables = [];
  for (const match of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    tables.push({ html: match[0], heading: headingBefore(html, match.index) });
  }
  return tables;
};

/** Primeira linha da tabela que comece com uma data. */
const firstDatedRow = table => {
  const rows = Array.from(table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).slice(1);
  for (const row of rows) {
    const values = cells(row[1]);
    if (values.length >= 3 && /^\d{2}\/\d{2}\/\d{4}$/.test(values[0])) return values;
  }
  return null;
};

const fetchPage = async page => {
  const response = await retryFetch(BASE + page, {
    headers: { Accept: 'text/html,application/xhtml+xml' }
  }, 9000, 2);
  return response.text();
};

const unavailable = (indicator, message) => ({
  key: indicator.key,
  name: indicator.name,
  value: null,
  unit: indicator.unit,
  highlight: indicator.highlight,
  changePercent: null,
  referenceDate: null,
  label: null,
  source: 'Notícias Agrícolas',
  status: 'unavailable',
  error: message
});

const collect = async () => {
  const pages = Array.from(new Set(INDICATORS.map(indicator => indicator.page)));

  const loaded = new Map();
  await Promise.all(pages.map(async page => {
    try {
      loaded.set(page, readPage(await fetchPage(page)));
    } catch (error) {
      loaded.set(page, { error: error.message });
    }
  }));

  return INDICATORS.map(indicator => {
    const tables = loaded.get(indicator.page);

    if (!tables || tables.error) {
      return unavailable(indicator, 'Página de cotação indisponível.');
    }

    const table = tables.find(entry => indicator.heading.test(entry.heading));
    if (!table) return unavailable(indicator, 'Indicador não encontrado na página.');

    const row = firstDatedRow(table.html);
    if (!row) return unavailable(indicator, 'Tabela sem linha com data.');

    const value = parseBrNumber(row[1]);
    if (value === null) return unavailable(indicator, 'Valor não numérico.');

    // Fora da faixa significa que o parser pegou a tabela errada. Melhor
    // declarar indisponível do que publicar um número de outro produto.
    if (value < indicator.range[0] || value > indicator.range[1]) {
      return unavailable(indicator, 'Valor fora da faixa esperada para o indicador.');
    }

    const changePercent = parseBrNumber(row[2]);

    return {
      key: indicator.key,
      name: indicator.name,
      value,
      unit: indicator.unit,
      highlight: indicator.highlight,
      changePercent: Number.isFinite(changePercent) ? changePercent : null,
      referenceDate: parseIsoDate(row[0]),
      label: table.heading.slice(0, 90),
      source: 'Notícias Agrícolas',
      status: 'available'
    };
  });
};

module.exports = { collect, INDICATORS };
