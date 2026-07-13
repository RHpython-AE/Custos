-- =========================================================
-- Minha Sobra — schema do banco (rode no Supabase > SQL Editor)
-- =========================================================

create table if not exists public.budgets (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  ym         text        not null,              -- "2026-6" (ano-mês, mês 0..11)
  data       jsonb       not null default '{}', -- o mês inteiro (líquido, cartões, avulsos, vr, meta)
  updated_at timestamptz not null default now(),
  primary key (user_id, ym)
);

-- Ativa Row Level Security: sem política liberando, ninguém lê/escreve.
alter table public.budgets enable row level security;

-- Cada usuário só enxerga e mexe nas próprias linhas.
create policy "own rows - select" on public.budgets
  for select using (auth.uid() = user_id);

create policy "own rows - insert" on public.budgets
  for insert with check (auth.uid() = user_id);

create policy "own rows - update" on public.budgets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows - delete" on public.budgets
  for delete using (auth.uid() = user_id);

-- =========================================================
-- Notificações push (opcional): assinaturas dos dispositivos
-- =========================================================
create table if not exists public.push_subscriptions (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  subscription jsonb       not null,          -- objeto PushSubscription do navegador
  updated_at   timestamptz not null default now(),
  primary key (user_id)
);
alter table public.push_subscriptions enable row level security;
create policy "own push - all" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
