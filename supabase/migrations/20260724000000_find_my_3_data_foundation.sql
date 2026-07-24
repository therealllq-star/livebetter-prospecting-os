-- Find My 3: isolated property data foundation
-- This migration creates standalone tables for property/project data, normalized
-- transactions, derived metrics, and enrichment cache.

set search_path = public;

create or replace function public.fm3_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.fm3_projects (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null unique,
  project_name text not null,
  developer_name text,
  tenure text,
  property_type text,
  district text,
  market_segment text check (market_segment is null or market_segment in ('CCR', 'RCR', 'OCR')),
  zone text check (zone is null or zone in ('Central', 'East', 'West', 'North', 'North-East')),
  project_status text,
  launch_date date,
  expected_top_date date,
  completion_year integer check (completion_year is null or completion_year between 1900 and 2200),
  total_units integer check (total_units is null or total_units >= 0),
  address_line text,
  postal_code text,
  planning_area text,
  subzone text,
  region text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  nearest_mrt_name text,
  nearest_mrt_distance_m integer check (nearest_mrt_distance_m is null or nearest_mrt_distance_m >= 0),
  ura_project_code text unique,
  onemap_place_id text unique,
  source_last_synced_at timestamptz,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.fm3_unit_types (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.fm3_projects(id) on delete cascade,
  unit_type_code text not null,
  unit_type_name text,
  -- Bedroom cap guards obvious bad ingests while supporting common SG project unit mixes.
  bedroom_count smallint not null check (bedroom_count >= 0 and bedroom_count <= 10),
  bathroom_count smallint check (bathroom_count is null or bathroom_count >= 0),
  total_units integer check (total_units is null or total_units >= 0),
  size_sqft_min numeric(10, 2),
  size_sqft_max numeric(10, 2),
  size_sqm_min numeric(10, 2),
  size_sqm_max numeric(10, 2),
  price_from numeric(14, 2),
  price_to numeric(14, 2),
  indicative_psf_from numeric(12, 2),
  currency char(3) not null default 'SGD',
  availability_status text not null default 'unknown',
  available_units integer check (available_units is null or available_units >= 0),
  price_last_updated_at timestamptz,
  source_last_synced_at timestamptz,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (project_id, unit_type_code),
  check (size_sqft_min is null or size_sqft_max is null or size_sqft_min <= size_sqft_max),
  check (size_sqm_min is null or size_sqm_max is null or size_sqm_min <= size_sqm_max),
  check (price_from is null or price_to is null or price_from <= price_to),
  check (indicative_psf_from is null or indicative_psf_from >= 0)
);

create table if not exists public.fm3_transactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.fm3_projects(id) on delete cascade,
  external_transaction_id text,
  sale_date date not null,
  sale_type text not null check (sale_type in ('new_sale', 'resale', 'subsale')),
  property_type text,
  tenure text,
  floor_range text,
  area_sqm numeric(10, 2) check (area_sqm is null or area_sqm >= 0),
  area_sqft numeric(10, 2) check (area_sqft is null or area_sqft >= 0),
  transacted_price numeric(14, 2) not null check (transacted_price >= 0),
  price_psf numeric(12, 2) check (price_psf is null or price_psf >= 0),
  source_system text not null,
  source_reference text,
  retrieved_at timestamptz not null default timezone('utc', now()),
  source_metadata jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.fm3_project_metrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.fm3_projects(id) on delete cascade,
  metric_category text not null,
  metric_key text not null,
  metric_value_numeric numeric(14, 4),
  metric_value_text text,
  metric_value_boolean boolean,
  measurement_unit text,
  metric_period text,
  as_of_date date,
  source_system text not null,
  source_reference text,
  confidence_score numeric(5, 2) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 100)),
  retrieved_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (project_id, metric_category, metric_key, as_of_date, source_system),
  check (
    metric_value_numeric is not null
    or metric_value_text is not null
    or metric_value_boolean is not null
  )
);

create table if not exists public.fm3_external_cache (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.fm3_projects(id) on delete set null,
  source_system text not null,
  cache_key text not null,
  external_entity_type text not null,
  external_entity_id text,
  request_url text,
  request_params jsonb not null default '{}'::jsonb,
  response_status integer,
  response_payload jsonb not null default '{}'::jsonb,
  retrieved_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source_system, cache_key)
);

create index if not exists idx_fm3_projects_planning_area on public.fm3_projects(planning_area);
create index if not exists idx_fm3_projects_region on public.fm3_projects(region);
create index if not exists idx_fm3_projects_district on public.fm3_projects(district);
create index if not exists idx_fm3_projects_market_zone on public.fm3_projects(market_segment, zone);
create index if not exists idx_fm3_projects_status on public.fm3_projects(project_status);
create index if not exists idx_fm3_projects_mrt_distance on public.fm3_projects(nearest_mrt_distance_m);
create index if not exists idx_fm3_projects_source_sync on public.fm3_projects(source_last_synced_at desc);

create index if not exists idx_fm3_unit_types_project_id on public.fm3_unit_types(project_id);
create index if not exists idx_fm3_unit_types_project_bedroom on public.fm3_unit_types(project_id, bedroom_count);
create index if not exists idx_fm3_unit_types_bedroom_availability on public.fm3_unit_types(bedroom_count, availability_status);
create index if not exists idx_fm3_unit_types_price_updated on public.fm3_unit_types(price_last_updated_at desc);
create index if not exists idx_fm3_unit_types_source_sync on public.fm3_unit_types(source_last_synced_at desc);

create index if not exists idx_fm3_transactions_project_sale_date on public.fm3_transactions(project_id, sale_date desc);
create index if not exists idx_fm3_transactions_sale_type_date on public.fm3_transactions(sale_type, sale_date desc);
create index if not exists idx_fm3_transactions_source_external on public.fm3_transactions(source_system, external_transaction_id);
create index if not exists idx_fm3_transactions_retrieved on public.fm3_transactions(retrieved_at desc);

create index if not exists idx_fm3_project_metrics_project_id on public.fm3_project_metrics(project_id);
create index if not exists idx_fm3_project_metrics_metric_lookup on public.fm3_project_metrics(metric_category, metric_key, as_of_date);
create index if not exists idx_fm3_project_metrics_source on public.fm3_project_metrics(source_system, retrieved_at desc);

create index if not exists idx_fm3_external_cache_project_id on public.fm3_external_cache(project_id);
create index if not exists idx_fm3_external_cache_source_retrieved on public.fm3_external_cache(source_system, retrieved_at desc);
create index if not exists idx_fm3_external_cache_expiry on public.fm3_external_cache(expires_at);

drop trigger if exists set_fm3_projects_updated_at on public.fm3_projects;
create trigger set_fm3_projects_updated_at
before update on public.fm3_projects
for each row execute function public.fm3_set_updated_at();

drop trigger if exists set_fm3_unit_types_updated_at on public.fm3_unit_types;
create trigger set_fm3_unit_types_updated_at
before update on public.fm3_unit_types
for each row execute function public.fm3_set_updated_at();

drop trigger if exists set_fm3_transactions_updated_at on public.fm3_transactions;
create trigger set_fm3_transactions_updated_at
before update on public.fm3_transactions
for each row execute function public.fm3_set_updated_at();

drop trigger if exists set_fm3_project_metrics_updated_at on public.fm3_project_metrics;
create trigger set_fm3_project_metrics_updated_at
before update on public.fm3_project_metrics
for each row execute function public.fm3_set_updated_at();

drop trigger if exists set_fm3_external_cache_updated_at on public.fm3_external_cache;
create trigger set_fm3_external_cache_updated_at
before update on public.fm3_external_cache
for each row execute function public.fm3_set_updated_at();
