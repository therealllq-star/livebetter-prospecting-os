set search_path = public;

alter table public.leads
  add column if not exists client_side text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leads_client_side_check'
  ) then
    alter table public.leads
      add constraint leads_client_side_check
      check (client_side is null or client_side in ('buyer', 'seller', 'buyer_seller'));
  end if;
end
$$;

create index if not exists leads_client_side_idx on public.leads (client_side);
