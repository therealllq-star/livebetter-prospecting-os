set search_path = public;

create table if not exists public.lead_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  color text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_groups_slug_key unique (slug)
);

create index if not exists lead_groups_name_idx on public.lead_groups (name);
create index if not exists lead_groups_active_idx on public.lead_groups (is_active);

create table if not exists public.lead_group_assignments (
  lead_id uuid not null references public.leads (id) on delete cascade,
  group_id uuid not null references public.lead_groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint lead_group_assignments_pkey primary key (lead_id, group_id)
);

create index if not exists lead_group_assignments_group_id_idx on public.lead_group_assignments (group_id);
create index if not exists lead_group_assignments_lead_id_idx on public.lead_group_assignments (lead_id);

alter table public.lead_groups enable row level security;
alter table public.lead_group_assignments enable row level security;

drop policy if exists "authenticated_select_all_lead_groups" on public.lead_groups;
drop policy if exists "authenticated_insert_all_lead_groups" on public.lead_groups;
drop policy if exists "authenticated_update_all_lead_groups" on public.lead_groups;
drop policy if exists "authenticated_delete_all_lead_groups" on public.lead_groups;

create policy "authenticated_select_all_lead_groups"
  on public.lead_groups
  for select
  to authenticated
  using (auth.uid() is not null);

create policy "authenticated_insert_all_lead_groups"
  on public.lead_groups
  for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "authenticated_update_all_lead_groups"
  on public.lead_groups
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated_delete_all_lead_groups"
  on public.lead_groups
  for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "authenticated_select_all_lead_group_assignments" on public.lead_group_assignments;
drop policy if exists "authenticated_insert_all_lead_group_assignments" on public.lead_group_assignments;
drop policy if exists "authenticated_update_all_lead_group_assignments" on public.lead_group_assignments;
drop policy if exists "authenticated_delete_all_lead_group_assignments" on public.lead_group_assignments;

create policy "authenticated_select_all_lead_group_assignments"
  on public.lead_group_assignments
  for select
  to authenticated
  using (auth.uid() is not null);

create policy "authenticated_insert_all_lead_group_assignments"
  on public.lead_group_assignments
  for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "authenticated_update_all_lead_group_assignments"
  on public.lead_group_assignments
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated_delete_all_lead_group_assignments"
  on public.lead_group_assignments
  for delete
  to authenticated
  using (auth.uid() is not null);