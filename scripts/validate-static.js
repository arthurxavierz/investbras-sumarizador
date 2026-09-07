'use strict';

/**
 * Validacao de build. O site e estatico, entao nao existe bundler para
 * quebrar em erro: esta checagem faz esse papel antes do deploy.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const problems = [];
const fail = message => problems.push(message);

/* 1. Arquivos obrigatorios --------------------------------------------- */

const REQUIRED = [
  'index.html', 'admin.html', '404.html',
  'styles.css', 'admin.css', 'app.js', 'admin.js',
  'favicon.svg', 'og-investbras.png', 'robots.txt', 'sitemap.xml', 'site.webmanifest',
  'netlify.toml', '.env.example',
  'supabase/migrations/0001_investbras_market.sql',
  'netlify/functions/_utils.js',
  'netlify/functions/_auth.js',
  'netlify/functions/auth-login.js',
  'netlify/functions/auth-me.js',
  'netlify/functions/health.js',
  'netlify/functions/market-data.js',
  'netlify/functions/market-news.js',
  'netlify/functions/market-agenda.js',
  'netlify/functions/news-image.js',
  'netlify/functions/generate-report.js',
  'netlify/functions/report.js',
  'netlify/functions/report-save.js',
  'netlify/functions/subscribe.js',
  'netlify/functions/unsubscribe.js',
  'netlify/functions/subscribers.js',
  'netlify/functions/send-campaign.js'
];

for (const file of REQUIRED) {
  if (!fs.existsSync(path.join(root, file))) fail('Arquivo obrigatorio ausente: ' + file);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

/* 2. Sintaxe de todo JavaScript ---------------------------------------- */

const jsFiles = ['app.js', 'admin.js', 'scripts/make-og.js'].concat(
  fs.readdirSync(path.join(root, 'netlify/functions'))
    .filter(file => file.endsWith('.js'))
    .map(file => 'netlify/functions/' + file)
);

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) fail('Erro de sintaxe em ' + file + ':\n' + (result.stderr || result.stdout));
}

/* 3. Requisitos de cada pagina ------------------------------------------ */

const pages = { 'index.html': read('index.html'), 'admin.html': read('admin.html'), '404.html': read('404.html') };

for (const [file, html] of Object.entries(pages)) {
  if (!html.includes('<meta name="viewport"')) fail(file + ': sem meta viewport.');
  if (!html.includes('lang="pt-BR"')) fail(file + ': sem lang pt-BR.');
  if (!html.includes('favicon.svg')) fail(file + ': sem favicon.');
  if (!/<title>[^<]+<\/title>/.test(html)) fail(file + ': sem title.');

  // A CSP nao permite atributo style. Um inline aqui vira layout quebrado
  // apenas em producao, entao a checagem precisa ser no build.
  if (/\sstyle="/.test(html)) fail(file + ': possui atributo style inline, bloqueado pela CSP.');
  if (/<style[\s>]/.test(html)) fail(file + ': possui bloco <style> inline, bloqueado pela CSP.');
}

if (!pages['index.html'].includes('og:image')) fail('index.html: sem og:image.');
if (!pages['admin.html'].includes('noindex')) fail('admin.html: precisa de robots noindex.');

/* 4. Referencias de id entre HTML e JS ---------------------------------- */

const idsIn = html => new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), match => match[1]));

const referencedIds = source => {
  const found = new Set();
  const patterns = [/\$\('#([A-Za-z0-9_-]+)'\)/g, /setText\('#([A-Za-z0-9_-]+)'/g, /say\('#([A-Za-z0-9_-]+)'/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return found;
};

const checkIds = (script, page) => {
  const available = idsIn(pages[page]);
  for (const id of referencedIds(read(script))) {
    if (!available.has(id)) fail(script + ' referencia #' + id + ', que nao existe em ' + page + '.');
  }
};

checkIds('app.js', 'index.html');
checkIds('admin.js', 'admin.html');

/* 5. Higiene de segredos ------------------------------------------------ */

const envExample = read('.env.example');
for (const key of ['SESSION_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY']) {
  if (!envExample.includes(key)) fail('.env.example: falta documentar ' + key + '.');
}

for (const file of ['app.js', 'admin.js', 'index.html', 'admin.html']) {
  const source = read(file);
  if (/(service_role|sk-[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{20,})/.test(source)) {
    fail(file + ': parece conter uma chave secreta. Chaves so no ambiente server-side.');
  }
}

if (fs.existsSync(path.join(root, '.env'))) {
  const gitignore = fs.existsSync(path.join(root, '.gitignore')) ? read('.gitignore') : '';
  if (!gitignore.includes('.env')) fail('.env existe mas nao esta no .gitignore.');
}

/* 6. Consistencia da CSP ------------------------------------------------ */

const toml = read('netlify.toml');
if (!toml.includes('Content-Security-Policy')) fail('netlify.toml: sem Content-Security-Policy.');
if (!toml.includes('fonts.googleapis.com')) fail('netlify.toml: a CSP precisa liberar as fontes usadas nas paginas.');

/* Resultado -------------------------------------------------------------- */

if (problems.length) {
  console.error('\nValidacao falhou:\n');
  console.error(problems.map(item => ' - ' + item).join('\n'));
  console.error('');
  process.exit(1);
}

console.log('Investbras static build validado: ' + REQUIRED.length + ' arquivos, ' + jsFiles.length + ' scripts, 3 paginas.');
