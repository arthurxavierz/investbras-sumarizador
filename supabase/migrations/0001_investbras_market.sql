-- Investbras Intelligence - schema inicial
-- Todo acesso do site passa pela service role dentro das Netlify Functions.
-- As policies abaixo mantem as tabelas fechadas para as chaves publicas.

create extension if not exists pgcrypto;

-- Operadores da mesa. O login usa Supabase Auth; esta tabela guarda o papel.
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  organization text,
  status text not null default 'active' check (status in ('active', 'unsubscribed', 'bounced')),
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma edicao por dia. Publicar sobrescreve a linha da mesma data.
create table if not exists market_reports (
  id uuid primary key default gen_random_uuid(),
  edition_date date not null default (now() at time zone 'America/Sao_Paulo')::date,
  title text not null,
  summary text,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  author_name text,
  author_email text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists market_snapshots (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  name text not null,
  value numeric,
  change numeric,
  change_percent numeric,
  currency text,
  unit text,
  source text,
  status text not null default 'unavailable',
  fetched_at timestamptz not null default now()
);

create table if not exists news_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  category text,
  source text,
  url text unique,
  image_url text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references market_reports(id) on delete set null,
  subject text not null,
  preview text,
  provider text,
  status text not null default 'draft' check (status in ('draft', 'queued', 'sent', 'partial', 'failed')),
  recipient_count integer not null default 0,
  is_test boolean not null default false,
  created_by text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists system_logs (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('debug', 'info', 'warning', 'error')),
  scope text not null default 'system',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_market_reports_edition_date on market_reports(edition_date);
create index if not exists idx_market_reports_status_published_at on market_reports(status, published_at desc);
create index if not exists idx_market_snapshots_symbol_fetched_at on market_snapshots(symbol, fetched_at desc);
create index if not exists idx_news_items_published_at on news_items(published_at desc);
create index if not exists idx_email_campaigns_status_created_at on email_campaigns(status, created_at desc);
create index if not exists idx_subscribers_status on subscribers(status);
create index if not exists idx_system_logs_scope_created_at on system_logs(scope, created_at desc);

-- RLS ligado em tudo. Sem policy permissiva, apenas a service role enxerga os dados.
alter table admin_users enable row level security;
alter table subscribers enable row level security;
alter table market_reports enable row level security;
alter table market_snapshots enable row level security;
alter table news_items enable row level security;
alter table email_campaigns enable row level security;
alter table system_logs enable row level security;

-- Unica excecao publica: leitura das edicoes ja publicadas.
drop policy if exists "edicoes publicadas sao publicas" on market_reports;
create policy "edicoes publicadas sao publicas"
  on market_reports for select
  using (status = 'published');

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_subscribers_updated_at on subscribers;
create trigger trg_subscribers_updated_at
  before update on subscribers
  for each row execute function set_updated_at();

drop trigger if exists trg_market_reports_updated_at on market_reports;
create trigger trg_market_reports_updated_at
  before update on market_reports
  for each row execute function set_updated_at();
