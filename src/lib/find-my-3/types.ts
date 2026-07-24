export type Fm3SourceSystem = "ura" | "onemap" | "manual" | "other";

export interface Fm3Project {
  id: string;
  project_slug: string;
  project_name: string;
  developer_name: string | null;
  tenure: string | null;
  property_type: string | null;
  launch_date: string | null;
  completion_year: number | null;
  total_units: number | null;
  address_line: string | null;
  postal_code: string | null;
  planning_area: string | null;
  subzone: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  ura_project_code: string | null;
  onemap_place_id: string | null;
  source_last_synced_at: string | null;
  source_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type Fm3ProjectInsert = Omit<Fm3Project, "id" | "created_at" | "updated_at">;
export type Fm3ProjectUpdate = Partial<Fm3ProjectInsert>;

export interface Fm3UnitType {
  id: string;
  project_id: string;
  unit_type_code: string;
  bedroom_count: number;
  bathroom_count: number | null;
  size_sqft_min: number | null;
  size_sqft_max: number | null;
  size_sqm_min: number | null;
  size_sqm_max: number | null;
  price_from: number | null;
  price_to: number | null;
  currency: string;
  availability_status: string;
  available_units: number | null;
  source_last_synced_at: string | null;
  source_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type Fm3UnitTypeInsert = Omit<Fm3UnitType, "id" | "created_at" | "updated_at">;
export type Fm3UnitTypeUpdate = Partial<Omit<Fm3UnitTypeInsert, "project_id">>;

export interface Fm3ProjectMetric {
  id: string;
  project_id: string;
  metric_category: string;
  metric_key: string;
  metric_value_numeric: number | null;
  metric_value_text: string | null;
  metric_value_boolean: boolean | null;
  measurement_unit: string | null;
  metric_period: string | null;
  as_of_date: string | null;
  source_system: Fm3SourceSystem | string;
  source_reference: string | null;
  confidence_score: number | null;
  retrieved_at: string;
  created_at: string;
  updated_at: string;
}

export type Fm3ProjectMetricInsert = Omit<Fm3ProjectMetric, "id" | "retrieved_at" | "created_at" | "updated_at">;

export interface Fm3ExternalCache {
  id: string;
  project_id: string | null;
  source_system: Fm3SourceSystem | string;
  cache_key: string;
  external_entity_type: string;
  external_entity_id: string | null;
  request_url: string | null;
  request_params: Record<string, unknown>;
  response_status: number | null;
  response_payload: Record<string, unknown>;
  retrieved_at: string;
  expires_at: string | null;
  source_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type Fm3ExternalCacheInsert = Omit<Fm3ExternalCache, "id" | "retrieved_at" | "created_at" | "updated_at">;

export interface Fm3ProjectFoundation {
  project: Fm3Project;
  unitTypes: Fm3UnitType[];
  metrics: Fm3ProjectMetric[];
}
