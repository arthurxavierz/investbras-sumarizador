-- Investbras Intelligence - indicadores de mercado fisico
-- Rode depois de 0002_news_and_subscribers.sql.

/**
 * O CEPEA responde 403 a requisicoes vindas do datacenter onde as Functions
 * rodam. Do Brasil o widget abre normalmente, entao a coleta automatica
 * continua tentando, mas o valor precisa ter onde ficar quando a mesa
 * informar na mao. Esta tabela guarda o ultimo valor conhecido de cada
 * indicador, com a data de referencia e a origem declarada.
 */
create table if not exists physical_indicators (
  key text primary key,
  name text not null,
  value numeric not null,
  unit text not null,
  reference_date date not null,
  source text not null default 'CEPEA/ESALQ',
  origin text not null default 'manual' check (origin in ('manual', 'automatica')),
  entered_by text,
  updated_at timestamptz not null default now()
);

alter table physical_indicators enable row level security;

-- Leitura e escrita apenas pela service role, dentro das Functions.

drop trigger if exists trg_physical_indicators_updated_at on physical_indicators;
create trigger trg_physical_indicators_updated_at
  before update on physical_indicators
  for each row execute function set_updated_at();
