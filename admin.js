/* Console interno da mesa Investbras.
   O token de sessao vive em sessionStorage: some ao fechar a aba e nunca e
   gravado em disco. Toda Function sensivel revalida no servidor. */

const $ = selector => document.querySelector(selector);

const API = {
  login: '/.netlify/functions/auth-login',
  me: '/.netlify/functions/auth-me',
  health: '/.netlify/functions/health',
  data: '/.netlify/functions/market-data',
  news: '/.netlify/functions/market-news',
  generate: '/.netlify/functions/generate-report',
  reportSave: '/.netlify/functions/report-save',
  report: '/.netlify/functions/report',
  subscribers: '/.netlify/functions/subscribers',
  campaign: '/.netlify/functions/send-campaign'
};

const STORAGE = {
  token: 'investbras-session',
  draft: 'investbras-draft',
  published: 'investbras-published-report'
};

const SECTIONS = ['coffee', 'brazil', 'global', 'geopolitics', 'commodities', 'agenda', 'notes'];

const SECTION_LABELS = {
  coffee: 'Cafe',
  brazil: 'Brasil',
  global: 'Exterior',
  commodities: 'Commodities',
  geopolitics: 'Geopolitica e cadeia',
  agenda: 'Agenda',
  notes: 'Observacoes internas'
};

let session = null;

/* ----------------------------------------------------------------- basico */

const setText = (selector, value) => {
  const node = $(selector);
  if (node) node.textContent = value;
};

const escapeHtml = value => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const formatDateTime = value => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo'
  }).format(date);
};

const say = (selector, message, state) => {
  const node = $(selector);
  if (!node) return;
  node.textContent = message || '';
  node.dataset.state = state || '';
};

const token = () => sessionStorage.getItem(STORAGE.token) || '';

const authFetch = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token(),
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    endSession('Sessao expirada. Entre novamente.');
    throw new Error('Sessao expirada');
  }
  return response;
};

const readJson = key => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    localStorage.removeItem(key);
    return null;
  }
};

/* ------------------------------------------------------------------ sessao */

const gateStatus = (tone, title, detail) => {
  const node = $('#gate-status');
  if (!node) return;
  node.hidden = false;
  node.dataset.tone = tone;
  node.innerHTML = '<strong>' + escapeHtml(title) + '</strong>' + detail;
};

/**
 * Sem isso, um ambiente mal configurado apenas recusa o login sem dizer por que.
 * O health check e publico, entao da para explicar o problema antes da tentativa.
 */
const diagnoseGate = async () => {
  try {
    const response = await fetch(API.health);
    const checks = (await response.json()).data?.checks || {};

    if (!checks.session?.ok) {
      gateStatus('down', 'Falta configurar o ambiente',
        'A variavel <code>SESSION_SECRET</code> nao esta definida. '
        + 'Gere uma com <code>npm run secret</code> e cadastre no Netlify em '
        + 'Site configuration, Environment variables.');
      return;
    }

    if (!checks.auth?.ok) {
      gateStatus('down', 'Nenhum acesso cadastrado',
        'Defina <code>ADMIN_EMAIL</code> e <code>ADMIN_PASSWORD</code> (minimo 10 caracteres) '
        + 'no ambiente, ou configure <code>SUPABASE_ANON_KEY</code> para usar o Supabase Auth.');
      return;
    }

    if (!checks.database?.ok) {
      gateStatus('warn', 'Painel liberado, banco pendente',
        'Voce consegue entrar e gerar rascunho. Sem Supabase, a publicacao fica apenas '
        + 'neste navegador em vez de ir para a area publica.');
    }
  } catch {
    gateStatus('down', 'Functions fora do ar',
      'A camada server-side nao respondeu. Em desenvolvimento, rode <code>npm run dev</code> '
      + 'em vez de abrir o arquivo direto no navegador.');
  }
};

const showGate = message => {
  $('#gate').hidden = false;
  $('#console').hidden = true;
  if (message) say('#login-feedback', message, 'error');
  diagnoseGate();
};

const showConsole = () => {
  $('#gate').hidden = true;
  $('#console').hidden = false;
};

const endSession = message => {
  sessionStorage.removeItem(STORAGE.token);
  session = null;
  showGate(message);
};

const applySession = user => {
  session = user;
  const name = user.name || user.email;
  setText('#operator-name', name);
  setText('#operator-email', user.email);
  setText('#operator-initial', String(name).trim().slice(0, 2).toUpperCase());
};

const login = async event => {
  event.preventDefault();
  const button = $('#login-submit');
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;

  if (!email || !password) {
    say('#login-feedback', 'Informe e-mail e senha.', 'error');
    return;
  }

  button.disabled = true;
  button.textContent = 'Entrando';
  say('#login-feedback', '');

  try {
    const response = await fetch(API.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const payload = await response.json();

    if (!response.ok || !payload.data?.token) {
      say('#login-feedback', payload.error || 'Nao foi possivel entrar.', 'error');
      return;
    }

    sessionStorage.setItem(STORAGE.token, payload.data.token);
    applySession(payload.data.user);
    $('#login-form').reset();
    showConsole();
    bootConsole();
  } catch {
    say('#login-feedback', 'Sem conexao com o servidor de autenticacao.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar';
  }
};

/* ----------------------------------------------------------------- editor */

const formData = () => {
  const form = $('#report-form');
  const values = Object.fromEntries(new FormData(form));
  return values;
};

const fillForm = data => {
  const form = $('#report-form');
  if (!form || !data) return;
  for (const key of ['title', 'summary'].concat(SECTIONS)) {
    if (form.elements[key] && typeof data[key] === 'string') form.elements[key].value = data[key];
  }
};

const renderPreview = () => {
  const data = formData();
  const preview = $('#preview');
  if (!preview) return;

  if (!data.title && !data.summary) {
    preview.innerHTML = '<span class="label">Sem conteudo</span><p>Preencha o editor ou gere um rascunho para ver a previa.</p>';
    return;
  }

  const filled = SECTIONS.filter(key => key !== 'notes' && String(data[key] || '').trim());
  preview.innerHTML = '<span class="label">Previa</span>'
    + '<h3>' + escapeHtml(data.title || 'Sem titulo') + '</h3>'
    + '<p>' + escapeHtml(String(data.summary || 'Sem resumo definido.').slice(0, 240)) + '</p>'
    + '<p class="section-meta">' + filled.length + ' de 6 blocos preenchidos</p>';
};

const saveLocal = () => {
  const data = { ...formData(), updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE.draft, JSON.stringify(data));
  setText('#autosave-state', 'Rascunho local salvo ' + formatDateTime());
};

const reportPayload = action => {
  const data = formData();
  const payload = { action, title: data.title, summary: data.summary };
  for (const key of SECTIONS) payload[key] = data[key] || '';
  return payload;
};

const persist = async action => {
  const data = formData();
  if (!String(data.title || '').trim() || !String(data.summary || '').trim()) {
    say('#editor-feedback', 'Titulo e resumo sao obrigatorios.', 'error');
    return;
  }

  const buttons = ['#save-draft', '#publish', '#unpublish'].map(selector => $(selector));
  buttons.forEach(button => { if (button) button.disabled = true; });
  say('#editor-feedback', 'Enviando...');

  try {
    const response = await authFetch(API.reportSave, {
      method: 'POST',
      body: JSON.stringify(reportPayload(action))
    });
    const payload = await response.json();

    if (response.ok) {
      say('#editor-feedback', payload.message || 'Edicao salva.', 'ok');
      saveLocal();
      if (action === 'publish') {
        localStorage.setItem(STORAGE.published, JSON.stringify({ ...data, publishedAt: new Date().toISOString(), author: session?.name }));
      }
      if (action === 'unpublish') localStorage.removeItem(STORAGE.published);
      refreshEditionState();
      return;
    }

    // Sem Supabase o painel ainda publica localmente para preview da pagina.
    if (payload.status === 'not-configured') {
      saveLocal();
      if (action === 'publish') {
        localStorage.setItem(STORAGE.published, JSON.stringify({ ...data, publishedAt: new Date().toISOString(), author: session?.name }));
        say('#editor-feedback', 'Supabase nao configurado. Edicao publicada apenas neste navegador, como preview.', 'error');
      } else if (action === 'unpublish') {
        localStorage.removeItem(STORAGE.published);
        say('#editor-feedback', 'Preview local removido.', 'ok');
      } else {
        say('#editor-feedback', 'Supabase nao configurado. Rascunho salvo apenas neste navegador.', 'error');
      }
      refreshEditionState();
      return;
    }

    say('#editor-feedback', payload.error || 'Nao foi possivel salvar.', 'error');
  } catch (error) {
    if (error.message !== 'Sessao expirada') say('#editor-feedback', 'Falha de conexao ao salvar.', 'error');
  } finally {
    buttons.forEach(button => { if (button) button.disabled = false; });
  }
};

const reportText = () => {
  const data = formData();
  const blocks = [data.title, '', data.summary, ''];
  for (const key of SECTIONS) {
    const value = String(data[key] || '').trim();
    if (value) blocks.push(SECTION_LABELS[key].toUpperCase(), value, '');
  }
  return blocks.join('\n').trim();
};

const copyReport = async () => {
  try {
    await navigator.clipboard.writeText(reportText());
    say('#editor-feedback', 'Texto copiado para a area de transferencia.', 'ok');
  } catch {
    say('#editor-feedback', 'O navegador bloqueou o acesso a area de transferencia.', 'error');
  }
};

/* -------------------------------------------------------------- producao */

const generate = async () => {
  const button = $('#generate');
  const note = $('#generation-note');
  button.disabled = true;
  button.textContent = 'Consultando fontes';
  note.dataset.tone = '';
  note.textContent = 'Buscando cotacoes, noticias e agenda...';

  try {
    const response = await authFetch(API.generate, { method: 'POST' });
    const payload = await response.json();

    if (!response.ok) {
      note.dataset.tone = 'error';
      note.textContent = payload.error || 'Nao foi possivel gerar o rascunho.';
      return;
    }

    const draft = payload.data?.draft;
    if (draft) {
      fillForm(draft);
      renderPreview();
      saveLocal();
    }

    const inputs = payload.data?.inputs || {};
    note.dataset.tone = 'ok';
    note.textContent = 'Gerado as ' + formatDateTime() + ' com '
      + (inputs.availableAssets || 0) + '/' + (inputs.totalAssets || 0) + ' cotacoes, '
      + (inputs.newsItems || 0) + ' materias e ' + (inputs.agendaItems || 0) + ' eventos. '
      + (payload.data?.mode === 'deterministico' ? 'Modo tecnico.' : 'Interpretado por IA.')

    say('#editor-feedback', 'Rascunho carregado no editor. Revise antes de publicar.', 'ok');
  } catch (error) {
    if (error.message !== 'Sessao expirada') {
      note.dataset.tone = 'error';
      note.textContent = 'Falha de conexao com as Functions.';
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Gerar rascunho do dia';
  }
};

/* ------------------------------------------------------------- metricas */

const refreshEditionState = async () => {
  const pill = $('#edition-state');

  try {
    const response = await fetch(API.report);
    const payload = await response.json();
    if (payload.success && payload.data) {
      pill.textContent = 'Publicado';
      pill.dataset.state = 'published';
      setText('#metric-status', 'Publicado');
      setText('#metric-status-detail', formatDateTime(payload.data.publishedAt));
      return;
    }
  } catch {
    /* segue para o estado local */
  }

  const published = readJson(STORAGE.published);
  const draft = readJson(STORAGE.draft);

  if (published) {
    pill.textContent = 'Preview local';
    pill.dataset.state = 'draft';
    setText('#metric-status', 'Preview local');
    setText('#metric-status-detail', formatDateTime(published.publishedAt));
    return;
  }

  pill.textContent = draft ? 'Rascunho local' : 'Sem edicao';
  pill.dataset.state = 'draft';
  setText('#metric-status', draft ? 'Rascunho' : 'Vazio');
  setText('#metric-status-detail', draft ? 'Salvo neste navegador' : 'Nada gerado ainda');
};

const loadCounters = async () => {
  fetch(API.data)
    .then(response => response.json())
    .then(payload => {
      const data = payload.data || {};
      setText('#metric-assets', (data.activeSources || 0) + '/' + (data.totalSources || 0));
    })
    .catch(() => setText('#metric-assets', '0'));

  fetch(API.news)
    .then(response => response.json())
    .then(payload => setText('#metric-news', String((payload.data || []).length)))
    .catch(() => setText('#metric-news', '0'));

  try {
    const response = await authFetch(API.subscribers);
    const payload = await response.json();
    const data = payload.data || {};
    setText('#metric-subs', String(data.active || 0));
    setText('#metric-subs-detail', payload.success
      ? data.unsubscribed + ' descadastrados'
      : 'Supabase nao configurado');
    renderCampaigns(data.campaigns);
  } catch {
    setText('#metric-subs', '--');
    setText('#metric-subs-detail', 'Base indisponivel');
  }
};

const renderCampaigns = campaigns => {
  const history = $('#campaign-history');
  if (!history) return;

  if (!campaigns || !campaigns.length) {
    history.innerHTML = '<div class="empty-state">Nenhum disparo registrado.</div>';
    return;
  }

  history.innerHTML = campaigns.map(item => '<div class="history-row">'
    + '<time>' + escapeHtml(formatDateTime(item.sent_at)) + '</time>'
    + '<strong>' + escapeHtml(item.subject) + (item.is_test ? ' (teste)' : '') + '</strong>'
    + '<span>' + escapeHtml(item.status + ' / ' + item.recipient_count) + '</span>'
    + '</div>').join('');
};

const loadHealth = async () => {
  const list = $('#check-list');
  const button = $('#health-refresh');
  if (button) { button.disabled = true; button.textContent = 'Verificando'; }

  try {
    const response = await fetch(API.health);
    const payload = await response.json();
    const checks = payload.data?.checks || {};

    const labels = {
      session: 'Sessao assinada',
      auth: 'Autenticacao',
      database: 'Banco de dados',
      email: 'Disparo de e-mail',
      ai: 'Geracao assistida',
      agenda: 'Agenda economica',
      news: 'Feeds de noticias'
    };

    list.innerHTML = Object.keys(labels).map(key => {
      const check = checks[key] || { ok: false, detail: 'Sem informacao.' };
      return '<div class="check" data-ok="' + Boolean(check.ok) + '">'
        + '<i aria-hidden="true"></i>'
        + '<div><strong>' + labels[key] + '</strong><small>' + escapeHtml(check.detail) + '</small></div>'
        + '</div>';
    }).join('');

    setText('#email-provider', checks.email?.ok ? 'Resend conectado' : 'Resend nao configurado');
  } catch {
    list.innerHTML = '<div class="empty-state">Nao foi possivel ler o health check.</div>';
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Verificar'; }
  }
};

/* --------------------------------------------------------------- e-mail */

const sendEmail = async isTest => {
  const data = formData();
  const subject = $('#email-subject').value.trim();

  if (!subject) {
    say('#email-feedback', 'Informe o assunto do e-mail.', 'error');
    return;
  }
  if (!String(data.title || '').trim() || !String(data.summary || '').trim()) {
    say('#email-feedback', 'A edicao precisa de titulo e resumo antes do disparo.', 'error');
    return;
  }

  if (!isTest) {
    const confirmed = window.confirm(
      'Disparar esta edicao para TODA a base de inscritos ativos?\n\nA acao nao pode ser desfeita.'
    );
    if (!confirmed) return;
  }

  const button = isTest ? $('#send-test') : $('#send-campaign');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Enviando';
  say('#email-feedback', '');

  const sections = {};
  for (const key of SECTIONS) sections[key] = data[key] || '';

  try {
    const response = await authFetch(API.campaign, {
      method: 'POST',
      body: JSON.stringify({
        subject,
        title: data.title,
        summary: data.summary,
        sections,
        test: isTest,
        confirm: !isTest
      })
    });
    const payload = await response.json();
    say('#email-feedback', payload.message || payload.error || 'Disparo processado.', response.ok ? 'ok' : 'error');
    if (response.ok) loadCounters();
  } catch (error) {
    if (error.message !== 'Sessao expirada') say('#email-feedback', 'Falha de conexao no disparo.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
};

/* ------------------------------------------------------------------ boot */

let bootDone = false;

const bootConsole = () => {
  setText('#admin-date', '/ ' + new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo'
  }).format(new Date()));

  const draft = readJson(STORAGE.draft);
  if (draft) fillForm(draft);
  renderPreview();

  if (bootDone) {
    loadHealth();
    loadCounters();
    refreshEditionState();
    return;
  }
  bootDone = true;

  $('#generate')?.addEventListener('click', generate);
  $('#save-draft')?.addEventListener('click', () => persist('draft'));
  $('#publish')?.addEventListener('click', () => persist('publish'));
  $('#unpublish')?.addEventListener('click', () => persist('unpublish'));
  $('#copy-report')?.addEventListener('click', copyReport);
  $('#health-refresh')?.addEventListener('click', loadHealth);
  $('#send-test')?.addEventListener('click', () => sendEmail(true));
  $('#send-campaign')?.addEventListener('click', () => sendEmail(false));
  $('#logout')?.addEventListener('click', () => endSession('Sessao encerrada.'));

  let typingTimer;
  $('#report-form')?.addEventListener('input', () => {
    renderPreview();
    setText('#autosave-state', 'Alteracoes nao salvas');
    clearTimeout(typingTimer);
    typingTimer = setTimeout(saveLocal, 1500);
  });

  loadHealth();
  loadCounters();
  refreshEditionState();
};

const boot = async () => {
  $('#login-form')?.addEventListener('submit', login);

  if (!token()) {
    showGate();
    return;
  }

  try {
    const response = await fetch(API.me, { headers: { Authorization: 'Bearer ' + token() } });
    const payload = await response.json();
    if (!response.ok || !payload.data?.user) {
      endSession();
      return;
    }
    applySession(payload.data.user);
    showConsole();
    bootConsole();
  } catch {
    showGate('Nao foi possivel validar a sessao agora.');
  }
};

boot();
