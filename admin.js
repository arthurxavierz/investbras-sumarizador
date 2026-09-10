/* Console interno da mesa Investbras.
   O token de sessão vive em sessionStorage: some ao fechar a aba e nunca e
   gravado em disco. Toda Function sensivel revalida no servidor. */

const $ = selector => document.querySelector(selector);

const API = {
  login: '/.netlify/functions/auth-login',
  me: '/.netlify/functions/auth-me',
  health: '/.netlify/functions/health',
  data: '/.netlify/functions/market-data',
  physical: '/.netlify/functions/market-physical',
  news: '/.netlify/functions/market-news',
  generate: '/.netlify/functions/generate-report',
  reportSave: '/.netlify/functions/report-save',
  report: '/.netlify/functions/report',
  subscribers: '/.netlify/functions/subscribers',
  preview: '/.netlify/functions/campaign-preview',
  collectNews: '/.netlify/functions/collect-news',
  campaign: '/.netlify/functions/send-campaign'
};

const STORAGE = {
  token: 'investbras-session',
  draft: 'investbras-draft',
  published: 'investbras-published-report'
};

const SECTIONS = ['coffee', 'weather', 'brazil', 'global', 'geopolitics', 'commodities', 'agenda', 'notes'];

const SECTION_LABELS = {
  coffee: 'Café',
  weather: 'Lavoura e clima',
  brazil: 'Brasil',
  global: 'Exterior',
  commodities: 'Commodities',
  geopolitics: 'Geopolítica e cadeia',
  agenda: 'Agenda',
  notes: 'Observações internas'
};

let session = null;

/* ----------------------------------------------------------------- básico */

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
    endSession('Sessão expirada. Entre novamente.');
    throw new Error('Sessão expirada');
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

/** Notificacao de canto. Some sozinha, mas aceita fechar antes. */
const toast = (tone, title, detail) => {
  const host = $('#toasts');
  if (!host) return;

  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.tone = tone;
  node.innerHTML = '<div><strong>' + escapeHtml(title) + '</strong>'
    + (detail ? '<small>' + escapeHtml(detail) + '</small>' : '') + '</div>';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Fechar notificacao');
  close.textContent = '×';
  node.appendChild(close);

  const remove = () => {
    if (!node.isConnected) return;
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 260);
  };

  close.addEventListener('click', remove);
  host.appendChild(node);
  setTimeout(remove, tone === 'error' ? 8000 : 5000);
};

/* ------------------------------------------------------------------ sessão */

const gateStatus = (tone, title, detail) => {
  const node = $('#gate-status');
  if (!node) return;
  node.hidden = false;
  node.dataset.tone = tone;
  node.innerHTML = '<strong>' + escapeHtml(title) + '</strong>' + detail;
};

/**
 * Sem isso, um ambiente mal configurado apenas recusa o login sem dizer por que.
 * O health check e público, então da para explicar o problema antes da tentativa.
 */
const diagnoseGate = async () => {
  try {
    const response = await fetch(API.health);
    const checks = (await response.json()).data?.checks || {};

    if (!checks.session?.ok) {
      gateStatus('down', 'Falta configurar o ambiente',
        'A variavel <code>SESSION_SECRET</code> não esta definida. '
        + 'Gere uma com <code>npm run secret</code> e cadastre no Netlify em '
        + 'Site configuration, Environment variables.');
      return;
    }

    if (!checks.auth?.ok) {
      gateStatus('down', 'Nenhum acesso cadastrado',
        'Defina <code>ADMIN_EMAIL</code> e <code>ADMIN_PASSWORD</code> (mínimo 10 caracteres) '
        + 'no ambiente, ou configure <code>SUPABASE_ANON_KEY</code> para usar o Supabase Auth.');
      return;
    }

    if (!checks.database?.ok) {
      gateStatus('warn', 'Painel liberado, banco pendente',
        'Você consegue entrar e montar a edição. Sem Supabase, a publicação fica apenas '
        + 'neste navegador em vez de ir para a área pública.');
    }
  } catch {
    gateStatus('down', 'Functions fora do ar',
      'A camada server-side não respondeu. Em desenvolvimento, rode <code>npm run dev</code> '
      + 'em vez de abrir o arquivo direto no navegador.');
  }
};

/**
 * Visibilidade em três camadas: atributo hidden, marcador no body e inert.
 * Uma falha de CSS não pode ser suficiente para expor a área interna.
 */
const setView = view => {
  const screens = { booting: $('#booting'), gate: $('#gate'), console: $('#console') };
  document.body.dataset.view = view;

  for (const key of Object.keys(screens)) {
    const node = screens[key];
    if (!node) continue;
    const active = key === view;
    node.hidden = !active;
    node.inert = !active;
  }

  // Trocar de tela sem voltar ao topo deixa o operador no meio do painel,
  // sem sinal de que algo mudou. Aqui a rolagem e sempre seca, nunca animada.
  window.scrollTo({ top: 0, behavior: 'instant' });
};

const showGate = message => {
  setView('gate');
  if (message) say('#login-feedback', message, 'error');
  $('#login-email')?.focus();
  diagnoseGate();
};

const showConsole = () => {
  setView('console');
  $('#workspace-title')?.focus();
};

const endSession = message => {
  const had = Boolean(sessionStorage.getItem(STORAGE.token));
  sessionStorage.removeItem(STORAGE.token);
  session = null;
  showGate(message);
  if (had && message) toast('info', 'Sessão encerrada', message);
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
      say('#login-feedback', payload.error || 'Não foi possível entrar.', 'error');
      return;
    }

    sessionStorage.setItem(STORAGE.token, payload.data.token);
    applySession(payload.data.user);
    $('#login-form').reset();
    showConsole();
    bootConsole();

    const user = payload.data.user;
    const until = payload.data.expiresAt
      ? ' Sessão ativa até ' + formatDateTime(payload.data.expiresAt) + '.'
      : '';
    toast('ok', 'Bem-vindo, ' + (user.name || user.email), 'Painel liberado.' + until);
  } catch {
    say('#login-feedback', 'Sem conexao com o servidor de autenticação.', 'error');
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
    preview.innerHTML = '<span class="label">Sem conteúdo</span><p>Preencha o editor ou atualize as informações para ver a prévia.</p>';
    return;
  }

  const filled = SECTIONS.filter(key => key !== 'notes' && String(data[key] || '').trim());
  preview.innerHTML = '<span class="label">Prévia</span>'
    + '<h3>' + escapeHtml(data.title || 'Sem título') + '</h3>'
    + '<p>' + escapeHtml(String(data.summary || 'Sem resumo definido.').slice(0, 240)) + '</p>'
    + '<p class="section-meta">' + filled.length + ' de 6 blocos preenchidos</p>';
};

const saveLocal = () => {
  const data = { ...formData(), updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE.draft, JSON.stringify(data));
  setText('#autosave-state', 'Salvo neste navegador ' + formatDateTime());
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
    say('#editor-feedback', 'Título e resumo são obrigatórios.', 'error');
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
      say('#editor-feedback', payload.message || 'Edição salva.', 'ok');
      const titles = { draft: 'Edição salva', publish: 'Edição publicada', unpublish: 'Edição despublicada' };
      toast('ok', titles[action], payload.message || '');
      saveLocal();
      if (action === 'publish') {
        localStorage.setItem(STORAGE.published, JSON.stringify({ ...data, publishedAt: new Date().toISOString(), author: session?.name }));
      }
      if (action === 'unpublish') localStorage.removeItem(STORAGE.published);
      refreshEditionState();
      return;
    }

    // Sem Supabase o painel ainda pública localmente para preview da página.
    if (payload.status === 'not-configured') {
      saveLocal();
      if (action === 'publish') {
        localStorage.setItem(STORAGE.published, JSON.stringify({ ...data, publishedAt: new Date().toISOString(), author: session?.name }));
        say('#editor-feedback', 'Supabase não configurado. Edição publicada apenas neste navegador, como preview.', 'error');
      } else if (action === 'unpublish') {
        localStorage.removeItem(STORAGE.published);
        say('#editor-feedback', 'Preview local removido.', 'ok');
      } else {
        say('#editor-feedback', 'Supabase não configurado. A edição ficou salva apenas neste navegador.', 'error');
      }
      refreshEditionState();
      return;
    }

    say('#editor-feedback', payload.error || 'Não foi possível salvar.', 'error');
    toast('error', 'Não foi possível salvar', payload.error || '');
  } catch (error) {
    if (error.message !== 'Sessão expirada') {
      say('#editor-feedback', 'Falha de conexao ao salvar.', 'error');
      toast('error', 'Falha de conexao', 'As Functions não responderam ao salvar.');
    }
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
    say('#editor-feedback', 'Texto copiado para a área de transferencia.', 'ok');
    toast('ok', 'Texto copiado', 'A edição inteira foi para a área de transferencia.');
  } catch {
    say('#editor-feedback', 'O navegador bloqueou o acesso a área de transferencia.', 'error');
  }
};

/* -------------------------------------------------------------- produção */

const generate = async () => {
  const button = $('#generate');
  const note = $('#generation-note');
  button.disabled = true;
  button.textContent = 'Consultando fontes';
  note.dataset.tone = '';
  note.textContent = 'Buscando cotações, notícias e agenda...';

  try {
    // Primeiro a coleta de notícias, que grava no banco e alimenta a área
    // pública. Ela pode falhar sem invalidar o resto do fluxo.
    let collected = null;
    try {
      const collectResponse = await authFetch(API.collectNews, { method: 'POST' });
      const collectPayload = await collectResponse.json();
      collected = collectPayload.data || null;
      if (collectPayload.data && collectPayload.data.storeError) {
        toast('info', 'Notícias coletadas', collectPayload.data.storeError);
      }
    } catch (error) {
      if (error.message === 'Sessão expirada') throw error;
    }

    note.textContent = 'Notícias atualizadas. Relendo cotações e agenda...';

    const response = await authFetch(API.generate, {
      method: 'POST',
      body: JSON.stringify({ refresh: true })
    });
    const payload = await response.json();

    if (!response.ok) {
      note.dataset.tone = 'error';
      note.textContent = payload.error || 'Não foi possível atualizar as informações.';
      toast('error', 'Geração interrompida', payload.error || '');
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
    note.textContent = 'Atualizado as ' + formatDateTime()
      + (collected ? ' | ' + collected.collected + ' materias coletadas, ' + collected.stored + ' gravadas' : '')
      + ' | '
      + (inputs.availableAssets || 0) + '/' + (inputs.totalAssets || 0) + ' cotações e '
      + (inputs.agendaItems || 0) + ' eventos. '
      + (payload.data?.mode === 'deterministico' ? 'Modo técnico.' : 'Interpretado por IA.')

    say('#editor-feedback', 'Texto carregado no editor. Revise antes de publicar.', 'ok');
    loadCounters();
    loadSubscribers();
    loadPhysical();
    toast('ok', 'Informações atualizadas',
      (inputs.availableAssets || 0) + ' cotações, ' + (inputs.newsItems || 0) + ' materias e '
      + (inputs.agendaItems || 0) + ' eventos. Revise antes de publicar.');
    $('#f-summary')?.focus();
  } catch (error) {
    if (error.message !== 'Sessão expirada') {
      note.dataset.tone = 'error';
      note.textContent = 'Falha de conexao com as Functions.';
      toast('error', 'Falha de conexao', 'As Functions não responderam.');
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Atualizar informações';
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

  pill.textContent = draft ? 'Não publicada' : 'Sem edição';
  pill.dataset.state = 'draft';
  setText('#metric-status', draft ? 'Não publicada' : 'Vazio');
  setText('#metric-status-detail', draft ? 'Salva neste navegador' : 'Nada montado ainda');
};

const loadCounters = () => {
  fetch(API.data)
    .then(response => response.json())
    .then(payload => {
      const data = payload.data || {};
      setText('#metric-assets', (data.activeSources || 0) + '/' + (data.totalSources || 0));
    })
    .catch(() => setText('#metric-assets', '0'));

  fetch(API.news)
    .then(response => response.json())
    .then(payload => {
      setText('#metric-news', String((payload.data || []).length));
    })
    .catch(() => setText('#metric-news', '0'));
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
      session: 'Sessão assinada',
      auth: 'Autenticação',
      database: 'Banco de dados',
      email: 'Disparo de e-mail',
      ai: 'Geração assistida',
      agenda: 'Agenda econômica',
      news: 'Feeds de notícias'
    };

    list.innerHTML = Object.keys(labels).map(key => {
      const check = checks[key] || { ok: false, detail: 'Sem informação.' };
      return '<div class="check" data-ok="' + Boolean(check.ok) + '">'
        + '<i aria-hidden="true"></i>'
        + '<div><strong>' + labels[key] + '</strong><small>' + escapeHtml(check.detail) + '</small></div>'
        + '</div>';
    }).join('');

    setText('#email-provider', checks.email?.ok ? 'Resend conectado' : 'Resend não configurado');
  } catch {
    list.innerHTML = '<div class="empty-state">Não foi possível ler o health check.</div>';
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Verificar'; }
  }
};

/* --------------------------------------------------------- mercado físico */

const PHYSICAL_LABEL = { arabica: 'Café arabica', robusta: 'Café robusta', sugar: 'Açúcar cristal SP', cattle: 'Boi gordo' };

const brl = value => (Number.isFinite(Number(value))
  ? Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  : 'Indisponível');

const renderPhysical = data => {
  const host = $('#physical-list');
  if (!host) return;

  const indicators = data.indicators || [];
  setText('#physical-origin', data.canCollectDirectly
    ? 'Coleta automática funcionando'
    : 'Coleta automática bloqueada, use o registro manual');

  if (!indicators.length) {
    host.innerHTML = '<div class="empty-state">Nenhum indicador conhecido ainda.</div>';
    return;
  }

  host.innerHTML = indicators.map(item => {
    const has = item.status === 'available';
    // Indicador do CEPEA envelhece rápido: acima de três dias vira alerta.
    const stale = has && Number(item.ageDays) > 3;
    const origin = item.origin || 'sem origem';

    return '<div class="physical-row">'
      + '<span>' + escapeHtml(PHYSICAL_LABEL[item.key] || item.name) + '</span>'
      + '<strong>' + escapeHtml(has ? brl(item.value) : 'Indisponível') + '</strong>'
      + '<span class="origin-tag" data-origin="' + escapeHtml(origin) + '"'
      + (stale ? ' data-age="velho"' : '') + '>'
      + escapeHtml(has
        ? origin + (item.referenceDate ? ' / ' + item.referenceDate.split('-').reverse().join('/') : '')
          + (stale ? ' / ' + item.ageDays + ' dias' : '')
        : 'sem valor')
      + '</span>'
      + '</div>';
  }).join('');
};

const loadPhysical = async () => {
  try {
    const response = await fetch(API.physical);
    const payload = await response.json();
    renderPhysical(payload.data || {});
  } catch {
    setText('#physical-origin', 'Não foi possível consultar');
  }
};

/* ------------------------------------------------------------ card do dia */

let cardBlobUrl = null;

/**
 * Monta o card com os dados do momento. Espera as fontes da marca carregarem:
 * sem isso o canvas desenha na fonte de sistema e o resultado sai errado.
 */
const renderCard = async () => {
  const button = $('#card-render');
  const canvas = $('#card-canvas');
  const download = $('#card-download');
  if (!window.InvestbrasCard || !canvas) return;

  button.disabled = true;
  button.textContent = 'Montando';
  say('#card-feedback', 'Buscando cotações, preco físico e clima...');

  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    const [dataResponse, physicalResponse] = await Promise.all([
      fetch(API.data),
      fetch(API.physical)
    ]);
    const market = (await dataResponse.json()).data || {};
    const physical = (await physicalResponse.json()).data || {};

    const form = formData();
    const editionDate = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo'
    }).format(new Date());

    window.InvestbrasCard.render(canvas, {
      editionDate,
      title: form.title || 'Giro do mercado Investbras',
      summary: form.summary || '',
      coffee: market.coffee,
      assets: market.assets || [],
      bagEquivalents: market.bagEquivalents || [],
      physicalArabica: physical.physicalArabica || null,
      indicators: physical.indicators || [],
      weather: physical.weather || []
    }, $('#card-format').value);

    canvas.classList.add('is-ready');
    $('#card-hint').hidden = true;

    const blob = await window.InvestbrasCard.toBlob(canvas);
    if (cardBlobUrl) URL.revokeObjectURL(cardBlobUrl);
    cardBlobUrl = URL.createObjectURL(blob);

    const format = window.InvestbrasCard.FORMATS[$('#card-format').value];
    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    download.href = cardBlobUrl;
    download.download = 'investbras-' + format.name + '-' + stamp + '.jpg';
    download.classList.add('is-ready');

    const size = Math.round(blob.size / 1024);
    say('#card-feedback', format.width + ' x ' + format.height + ', ' + size + ' kB. Pronto para baixar.', 'ok');
    toast('ok', 'Card gerado', format.width + ' x ' + format.height + ' com os dados do momento.');
  } catch (error) {
    say('#card-feedback', 'Não foi possível montar o card agora.', 'error');
    toast('error', 'Card não gerado', error.message || '');
  } finally {
    button.disabled = false;
    button.textContent = 'Gerar prévia';
  }
};

/* ------------------------------------------------------------- inscritos */

const STATUS_LABEL = { active: 'Ativo', unsubscribed: 'Saiu', bounced: 'Retorno' };

let subsQuery = { search: '', status: '' };

const renderSubscribers = data => {
  const host = $('#subs-list');
  if (!host) return;

  setText('#subs-summary', data.active + ' ativos / ' + data.unsubscribed
    + ' saídas / ' + data.bounced + ' retornos');

  const list = data.list || [];
  if (!list.length) {
    host.innerHTML = '<div class="empty-state">'
      + (subsQuery.search || subsQuery.status
        ? 'Nenhum inscrito corresponde ao filtro.'
        : 'Base vazia. Cadastre o primeiro endereço acima ou aguarde inscrições pela área pública.')
      + '</div>';
    return;
  }

  host.innerHTML = list.map(item => {
    const status = item.status || 'active';
    const toggle = status === 'active'
      ? '<button class="mini-button" data-act="unsubscribed" data-email="' + escapeHtml(item.email) + '">Desativar</button>'
      : '<button class="mini-button" data-act="active" data-email="' + escapeHtml(item.email) + '">Reativar</button>';

    return '<div class="subs-row">'
      + '<div><strong>' + escapeHtml(item.email) + '</strong>'
      + '<small>' + escapeHtml(item.name || 'Sem nome')
      + (item.phone ? ' / ' + escapeHtml(item.phone) : '')
      + ' / entrou em ' + escapeHtml(formatDateTime(item.created_at)) + '</small></div>'
      + '<span class="org">' + escapeHtml(item.organization || '') + '</span>'
      + '<span class="subs-state" data-state="' + escapeHtml(status) + '">'
      + escapeHtml(STATUS_LABEL[status] || status) + '</span>'
      + '<span class="subs-actions">' + toggle
      + '<button class="mini-button danger" data-act="remove" data-email="' + escapeHtml(item.email) + '">Remover</button>'
      + '</span></div>';
  }).join('');
};

const loadSubscribers = async () => {
  const params = new URLSearchParams();
  if (subsQuery.search) params.set('search', subsQuery.search);
  if (subsQuery.status) params.set('status', subsQuery.status);

  try {
    const response = await authFetch(API.subscribers + (params.toString() ? '?' + params : ''));
    const payload = await response.json();
    const data = payload.data || {};

    setText('#metric-subs', String(data.active || 0));
    setText('#metric-subs-detail', payload.success
      ? (data.unsubscribed || 0) + ' descadastrados'
      : 'Supabase não configurado');

    if (!payload.success) {
      $('#subs-list').innerHTML = '<div class="empty-state"><strong>Base indisponível</strong>'
        + escapeHtml(payload.error || 'Configure o Supabase para gerenciar inscritos.') + '</div>';
      setText('#subs-summary', 'Supabase não configurado');
      return;
    }

    renderSubscribers(data);
    renderCampaigns(data.campaigns);
  } catch (error) {
    if (error.message !== 'Sessão expirada') {
      setText('#subs-summary', 'Base indisponível');
      setText('#metric-subs', '--');
    }
  }
};

const subscriberAction = async (body, successTitle) => {
  try {
    const response = await authFetch(API.subscribers, { method: 'POST', body: JSON.stringify(body) });
    const payload = await response.json();

    if (!response.ok) {
      say('#subs-feedback', payload.error || 'Acao recusada.', 'error');
      toast('error', 'Acao recusada', payload.error || '');
      return false;
    }

    say('#subs-feedback', payload.message || 'Feito.', 'ok');
    toast('ok', successTitle, payload.message || '');
    loadSubscribers();
    return true;
  } catch (error) {
    if (error.message !== 'Sessão expirada') {
      say('#subs-feedback', 'Falha de conexao.', 'error');
      toast('error', 'Falha de conexao', 'A base não respondeu.');
    }
    return false;
  }
};

/* ------------------------------------------------------------ leitor CSV */

/**
 * Separador mais provável entre os candidatos, medido pela regularidade das
 * linhas. Base exportada do Excel brasileiro sai com ponto e vírgula; a de
 * sistema costuma sair com vírgula.
 */
const detectDelimiter = lines => {
  const candidates = [';', ',', '\t', '|'];
  let best = ',';
  let bestScore = -1;

  for (const candidate of candidates) {
    const counts = lines.slice(0, 12).map(line => line.split(candidate).length);
    const average = counts.reduce((total, value) => total + value, 0) / counts.length;
    if (average < 2) continue;
    const spread = Math.max.apply(null, counts) - Math.min.apply(null, counts);
    const score = average - spread * 2;
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return best;
};

/** Divide respeitando aspas, que é onde nome com vírgula costuma quebrar. */
const splitLine = (line, delimiter) => {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
      continue;
    }
    if (character === delimiter && !quoted) { values.push(current); current = ''; continue; }
    current += character;
  }
  values.push(current);
  return values.map(value => value.trim());
};

const HEADER_MAP = [
  ['email', /^(e[-\s]?mail|email|mail|endereco de e[-\s]?mail|endereço de e[-\s]?mail)$/i],
  ['name', /^(nome|name|nome completo|contato|responsavel|responsável|cliente)$/i],
  ['phone', /^(telefone|phone|celular|fone|whatsapp|tel|contato telefonico)$/i],
  ['organization', /^(empresa|organizacao|organização|organization|company|fazenda|cooperativa|razao social|razão social)$/i]
];

const mapHeader = header => {
  const mapping = {};
  header.forEach((cell, index) => {
    const clean = String(cell || '').replace(/^\uFEFF/, '').trim();
    for (const entry of HEADER_MAP) {
      if (entry[1].test(clean) && mapping[entry[0]] === undefined) mapping[entry[0]] = index;
    }
  });
  return mapping;
};

/** Sem cabeçalho reconhecível, deduz a coluna pelo conteúdo das células. */
const guessColumns = rows => {
  const mapping = {};
  const sample = rows.slice(0, 20);
  const columns = sample[0] ? sample[0].length : 0;

  for (let index = 0; index < columns; index += 1) {
    const hits = sample.filter(row => /@/.test(String(row[index] || ''))).length;
    if (hits > sample.length / 2) { mapping.email = index; break; }
  }

  for (let index = 0; index < columns; index += 1) {
    if (index === mapping.email) continue;
    const hits = sample.filter(row => {
      const digits = String(row[index] || '').replace(/\D/g, '');
      return digits.length >= 8 && digits.length <= 15;
    }).length;
    if (hits > sample.length / 2) { mapping.phone = index; break; }
  }

  for (let index = 0; index < columns; index += 1) {
    if (index === mapping.email || index === mapping.phone) continue;
    const hits = sample.filter(row => /[a-zà-ú]{3,}/i.test(String(row[index] || ''))).length;
    if (hits > sample.length / 2) { mapping.name = index; break; }
  }

  return mapping;
};

const parseCsv = text => {
  const clean = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n').filter(line => line.trim());
  if (!lines.length) return { rows: [], mapping: {}, delimiter: ',' };

  const delimiter = detectDelimiter(lines);
  const table = lines.map(line => splitLine(line, delimiter));

  let mapping = mapHeader(table[0]);
  let body = table;

  if (mapping.email !== undefined) body = table.slice(1);
  else mapping = guessColumns(table);

  const pick = (cells, field) => (mapping[field] === undefined ? '' : (cells[mapping[field]] || ''));

  const rows = body
    .map(cells => ({
      email: pick(cells, 'email'),
      name: pick(cells, 'name'),
      phone: pick(cells, 'phone'),
      organization: pick(cells, 'organization')
    }))
    .filter(row => row.email);

  return { rows, mapping, delimiter };
};

const renderImportReport = (title, detail, rejected) => {
  const host = $('#import-report');
  if (!host) return;
  host.hidden = false;
  host.innerHTML = '<strong>' + escapeHtml(title) + '</strong>' + escapeHtml(detail)
    + (rejected && rejected.length
      ? '<ul>' + rejected.map(item =>
        '<li>' + escapeHtml(item.email) + ': ' + escapeHtml(item.reason) + '</li>').join('') + '</ul>'
      : '');
};

const importCsv = async file => {
  const input = $('#subs-csv');
  const label = input ? input.closest('.file-button') : null;
  const original = label ? label.firstChild.nodeValue : '';
  if (label) label.firstChild.nodeValue = 'Lendo arquivo ';

  try {
    const text = await file.text();
    const parsed = parseCsv(text);

    if (!parsed.rows.length) {
      renderImportReport('Nada importado',
        'Não encontrei nenhuma coluna de e-mail no arquivo. Confira se ele tem cabeçalho '
        + 'ou se os endereços estão em uma coluna própria.', []);
      toast('error', 'Arquivo não reconhecido', 'Nenhuma coluna de e-mail encontrada.');
      return;
    }

    if (parsed.mapping.name === undefined) {
      renderImportReport('Nada importado',
        'Encontrei os e-mails, mas nenhuma coluna de nome. O nome é obrigatório: '
        + 'renomeie a coluna para "nome" e tente de novo.', []);
      toast('error', 'Falta a coluna de nome', 'O nome é obrigatório na importação.');
      return;
    }

    const response = await authFetch(API.subscribers, {
      method: 'POST',
      body: JSON.stringify({ action: 'import', rows: parsed.rows })
    });
    const payload = await response.json();

    if (!response.ok) {
      renderImportReport('Importação recusada', payload.error || 'Não foi possível importar.', []);
      toast('error', 'Importação recusada', payload.error || '');
      return;
    }

    const separator = parsed.delimiter === '\t' ? 'tabulação' : parsed.delimiter;
    renderImportReport('Importação concluída',
      payload.message + ' Arquivo lido com separador "' + separator + '" e '
      + parsed.rows.length + ' linha(s) com e-mail.',
      (payload.data && payload.data.rejected) || []);
    toast('ok', 'Base importada', payload.message || '');
    loadSubscribers();
  } catch (error) {
    if (error.message !== 'Sessão expirada') {
      renderImportReport('Falha na leitura',
        'Não consegui ler o arquivo. Salve como CSV e tente de novo.', []);
      toast('error', 'Falha na importação', error.message || '');
    }
  } finally {
    if (label) label.firstChild.nodeValue = original;
    if (input) input.value = '';
  }
};

const setupSubscribers = () => {
  $('#subs-add-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#subs-add');
    const email = $('#subs-email').value.trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      say('#subs-feedback', 'Informe um e-mail válido.', 'error');
      $('#subs-email').focus();
      return;
    }

    const name = $('#subs-name').value.trim();
    if (!name) {
      say('#subs-feedback', 'O nome é obrigatório.', 'error');
      $('#subs-name').focus();
      return;
    }

    button.disabled = true;
    const ok = await subscriberAction({
      action: 'add',
      email,
      name,
      phone: $('#subs-phone').value.trim(),
      organization: $('#subs-org').value.trim()
    }, 'Inscrito cadastrado');
    button.disabled = false;
    if (ok) $('#subs-add-form').reset();
  });

  // Delegacao: a lista e reconstruida a cada acao.
  $('#subs-list')?.addEventListener('click', event => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;

    const email = button.dataset.email;
    const act = button.dataset.act;

    if (act === 'remove') {
      const warning = 'Remover ' + email + ' da base?\n\nA acao não pode ser desfeita.';
      if (!window.confirm(warning)) return;
      subscriberAction({ action: 'remove', email }, 'Inscrito removido');
      return;
    }

    subscriberAction({ action: 'status', email, status: act },
      act === 'active' ? 'Inscrito reativado' : 'Inscrito desativado');
  });

  let searchTimer;
  $('#subs-search')?.addEventListener('input', event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      subsQuery.search = event.target.value.trim();
      loadSubscribers();
    }, 350);
  });

  $('#subs-csv')?.addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    if (file) importCsv(file);
  });

  $('#subs-status')?.addEventListener('change', event => {
    subsQuery.status = event.target.value;
    loadSubscribers();
  });
};

/* --------------------------------------------------------------- e-mail */

/**
 * Abre a prévia em aba nova por submit de formulario. Não da para usar fetch
 * aqui: o resultado precisa ser um documento de topo, com a própria CSP, para
 * que os estilos embutidos do e-mail rendereizem como no cliente de e-mail.
 */
const previewEmail = () => {
  const data = formData();
  if (!String(data.title || '').trim() || !String(data.summary || '').trim()) {
    say('#email-feedback', 'A edição precisa de título e resumo para a prévia.', 'error');
    toast('error', 'Prévia indisponível', 'Preencha título e resumo antes.');
    return;
  }

  const sections = {};
  for (const key of SECTIONS) sections[key] = data[key] || '';

  $('#preview-payload').value = JSON.stringify({
    token: token(),
    title: data.title,
    summary: data.summary,
    sections,
    email: session ? session.email : ''
  });

  $('#preview-form').submit();
  toast('info', 'Prévia aberta', 'O e-mail abriu em uma aba nova, exatamente como o inscrito recebe.');
};

const sendEmail = async isTest => {
  const data = formData();
  const subject = $('#email-subject').value.trim();

  if (!subject) {
    say('#email-feedback', 'Informe o assunto do e-mail.', 'error');
    return;
  }
  if (!String(data.title || '').trim() || !String(data.summary || '').trim()) {
    say('#email-feedback', 'A edição precisa de título e resumo antes do disparo.', 'error');
    return;
  }

  if (!isTest) {
    const confirmed = window.confirm(
      'Disparar esta edição para TODA a base de inscritos ativos?\n\nA acao não pode ser desfeita.'
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
    toast(response.ok ? 'ok' : 'error',
      response.ok ? (isTest ? 'Teste enviado' : 'Disparo concluido') : 'Disparo não concluido',
      payload.message || payload.error || '');
    if (response.ok) loadSubscribers();
  } catch (error) {
    if (error.message !== 'Sessão expirada') say('#email-feedback', 'Falha de conexao no disparo.', 'error');
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
    loadSubscribers();
    loadPhysical();
    refreshEditionState();
    return;
  }
  bootDone = true;

  setupSubscribers();

  $('#generate')?.addEventListener('click', generate);
  $('#save-draft')?.addEventListener('click', () => persist('draft'));
  $('#publish')?.addEventListener('click', () => persist('publish'));
  $('#unpublish')?.addEventListener('click', () => persist('unpublish'));
  $('#copy-report')?.addEventListener('click', copyReport);
  $('#health-refresh')?.addEventListener('click', loadHealth);
  $('#card-render')?.addEventListener('click', renderCard);
  $('#card-format')?.addEventListener('change', () => {
    $('#card-canvas').classList.remove('is-ready');
    $('#card-download').classList.remove('is-ready');
    $('#card-hint').hidden = false;
    say('#card-feedback', '');
  });
  $('#preview-email')?.addEventListener('click', previewEmail);
  $('#send-test')?.addEventListener('click', () => sendEmail(true));
  $('#send-campaign')?.addEventListener('click', () => sendEmail(false));
  $('#logout')?.addEventListener('click', () => endSession('Sessão encerrada.'));

  let typingTimer;
  $('#report-form')?.addEventListener('input', () => {
    renderPreview();
    setText('#autosave-state', 'Alteracoes não salvas');
    clearTimeout(typingTimer);
    typingTimer = setTimeout(saveLocal, 1500);
  });

  loadHealth();
  loadCounters();
  loadSubscribers();
  loadPhysical();
  refreshEditionState();
};

const boot = async () => {
  $('#login-form')?.addEventListener('submit', login);
  setView('loading');

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
    showGate('Não foi possível validar a sessão agora.');
  }
};

boot();
