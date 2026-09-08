-- Investbras Intelligence - coleta de noticias e gestao de inscritos
-- Rode depois de 0001_investbras_market.sql.

-- A coleta agendada precisa guardar mais do que o schema inicial previa:
-- linha fina, dominio real do veiculo, origem da miniatura e relevancia.
alter table news_items add column if not exists dek text;
alter table news_items add column if not exists source_domain text;
alter table news_items add column if not exists image_kind text;
alter table news_items add column if not exists relevance numeric default 0;
alter table news_items add column if not exists fetched_at timestamptz not null default now();

create index if not exists idx_news_items_relevance on news_items(relevance desc);
create index if not exists idx_news_items_fetched_at on news_items(fetched_at desc);
create index if not exists idx_news_items_category on news_items(category);

-- Quem cadastrou o inscrito e por qual caminho. A mesa adiciona gente na mao.
alter table subscribers add column if not exists notes text;
alter table subscribers add column if not exists created_by text;

-- Sem isso a lista fica sem ordem estavel quando dois cadastros caem no mesmo segundo.
create index if not exists idx_subscribers_created_at on subscribers(created_at desc);

alter table news_items enable row level security;

-- A pagina publica le noticias pela service role dentro das Functions, entao
-- nao existe policy permissiva aqui de proposito.

/**
 * Limpeza: a coleta roda a cada 20 minutos e so as materias recentes
 * interessam. Sem isso a tabela cresce sem limite.
 */
create or replace function purge_old_news(days integer default 14)
returns integer
language plpgsql
as $$
declare
  removed integer;
begin
  delete from news_items
  where coalesce(published_at, created_at) < now() - (days || ' days')::interval;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
