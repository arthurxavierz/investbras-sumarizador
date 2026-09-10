-- Investbras Intelligence - telefone do inscrito
-- Rode depois de 0003_physical_indicators.sql.

/**
 * Telefone entra como campo opcional. Obrigatórios continuam sendo apenas
 * e-mail e nome: é o mínimo para o disparo funcionar e para a mesa saber com
 * quem está falando.
 */
alter table subscribers add column if not exists phone text;

create index if not exists idx_subscribers_phone on subscribers(phone) where phone is not null;
