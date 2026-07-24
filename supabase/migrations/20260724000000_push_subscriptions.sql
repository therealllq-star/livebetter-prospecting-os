set search_path = public;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "authenticated_select_own_push_subscriptions" on public.push_subscriptions;
drop policy if exists "authenticated_insert_own_push_subscriptions" on public.push_subscriptions;
drop policy if exists "authenticated_update_own_push_subscriptions" on public.push_subscriptions;
drop policy if exists "authenticated_delete_own_push_subscriptions" on public.push_subscriptions;

create policy "authenticated_select_own_push_subscriptions"
  on public.push_subscriptions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "authenticated_insert_own_push_subscriptions"
  on public.push_subscriptions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "authenticated_update_own_push_subscriptions"
  on public.push_subscriptions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "authenticated_delete_own_push_subscriptions"
  on public.push_subscriptions
  for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
