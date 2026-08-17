set search_path = public;

alter table public.leads
  add column if not exists meta_lead_id text;

create unique index if not exists leads_meta_lead_id_unique_idx
  on public.leads (meta_lead_id)
  where meta_lead_id is not null;
