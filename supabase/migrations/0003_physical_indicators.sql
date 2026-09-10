-- Investbras Intelligence - indicadores de mercado físico
-- Rode depois de 0002_news_and_subscribers.sql.

/**
 * Último valor conhecido de cada indicador de preço físico.
 *
 * A coleta é automática e roda a cada leitura. Esta tabela existe como rede:
 * quando a fonte não responde, a leitura anterior entra no lugar, sempre
 * rotulada com a data de referência e a idade em dias, para ninguém confundir
 * cotação de ontem com cotação de hoje.
 */
create table if not exists physical_indicators (
  key text primary key,
  name text not null,
  value numeric not null,
  unit text not null,
  change_percent numeric,
  reference_date date not null,
  source text not null default 'Notícias Agrícolas',
  origin text not null default 'auto' check (origin in ('manual', 'auto')),
  entered_by text,
  updated_at timestamptz not null default now()
);

-- Instalações que já rodaram uma versão anterior desta migração.
alter table physical_indicators add column if not exists change_percent numeric;

alter table physical_indicators enable row level security;

-- Leitura e escrita apenas pela service role, dentro das Functions.

drop trigger if exists trg_physical_indicators_updated_at on physical_indicators;
create trigger trg_physical_indicators_updated_at
  before update on physical_indicators
  for each row execute function set_updated_at();
