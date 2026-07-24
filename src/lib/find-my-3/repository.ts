import { createClient } from "@/utils/supabase/client";
import {
  type Fm3ExternalCache,
  type Fm3ExternalCacheInsert,
  type Fm3Project,
  type Fm3ProjectFoundation,
  type Fm3ProjectInsert,
  type Fm3ProjectMetric,
  type Fm3ProjectMetricInsert,
  type Fm3ProjectUpdate,
  type Fm3Transaction,
  type Fm3TransactionInsert,
  type Fm3UnitType,
  type Fm3UnitTypeInsert,
} from "@/lib/find-my-3/types";

type SupabaseClient = ReturnType<typeof createClient>;

export async function listFm3Projects(client: SupabaseClient): Promise<Fm3Project[]> {
  const { data, error } = await client.from("fm3_projects").select("*").order("project_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Fm3Project[];
}

export async function getFm3ProjectById(client: SupabaseClient, projectId: string): Promise<Fm3Project | null> {
  const { data, error } = await client.from("fm3_projects").select("*").eq("id", projectId).maybeSingle();
  if (error) throw error;
  return data as Fm3Project | null;
}

export async function createFm3Project(client: SupabaseClient, payload: Fm3ProjectInsert): Promise<Fm3Project> {
  const { data, error } = await client.from("fm3_projects").insert(payload).select("*").single();
  if (error) throw error;
  return data as Fm3Project;
}

export async function updateFm3Project(client: SupabaseClient, projectId: string, payload: Fm3ProjectUpdate): Promise<Fm3Project> {
  const { data, error } = await client.from("fm3_projects").update(payload).eq("id", projectId).select("*").single();
  if (error) throw error;
  return data as Fm3Project;
}

export async function upsertFm3UnitTypes(client: SupabaseClient, unitTypes: Fm3UnitTypeInsert[]): Promise<Fm3UnitType[]> {
  if (!unitTypes.length) return [];

  const { data, error } = await client
    .from("fm3_unit_types")
    .upsert(unitTypes, { onConflict: "project_id,unit_type_code" })
    .select("*");

  if (error) throw error;
  return (data ?? []) as Fm3UnitType[];
}

export async function listFm3UnitTypesByProject(client: SupabaseClient, projectId: string): Promise<Fm3UnitType[]> {
  const { data, error } = await client
    .from("fm3_unit_types")
    .select("*")
    .eq("project_id", projectId)
    .order("bedroom_count", { ascending: true })
    .order("price_from", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Fm3UnitType[];
}

export async function insertFm3Transactions(client: SupabaseClient, transactions: Fm3TransactionInsert[]): Promise<Fm3Transaction[]> {
  if (!transactions.length) return [];

  const { data, error } = await client.from("fm3_transactions").insert(transactions).select("*");
  if (error) throw error;
  return (data ?? []) as Fm3Transaction[];
}

export async function listFm3TransactionsByProject(client: SupabaseClient, projectId: string): Promise<Fm3Transaction[]> {
  const { data, error } = await client
    .from("fm3_transactions")
    .select("*")
    .eq("project_id", projectId)
    .order("sale_date", { ascending: false })
    .order("transacted_price", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Fm3Transaction[];
}

export async function upsertFm3ProjectMetrics(client: SupabaseClient, metrics: Fm3ProjectMetricInsert[]): Promise<Fm3ProjectMetric[]> {
  if (!metrics.length) return [];

  const { data, error } = await client
    .from("fm3_project_metrics")
    .upsert(metrics, { onConflict: "project_id,metric_category,metric_key,as_of_date,source_system" })
    .select("*");

  if (error) throw error;
  return (data ?? []) as Fm3ProjectMetric[];
}

export async function listFm3ProjectMetricsByProject(client: SupabaseClient, projectId: string): Promise<Fm3ProjectMetric[]> {
  const { data, error } = await client
    .from("fm3_project_metrics")
    .select("*")
    .eq("project_id", projectId)
    .order("metric_category", { ascending: true })
    .order("metric_key", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Fm3ProjectMetric[];
}

export async function upsertFm3ExternalCache(client: SupabaseClient, payload: Fm3ExternalCacheInsert): Promise<Fm3ExternalCache> {
  const { data, error } = await client.from("fm3_external_cache").upsert(payload, { onConflict: "source_system,cache_key" }).select("*").single();
  if (error) throw error;
  return data as Fm3ExternalCache;
}

export async function getFm3ExternalCache(client: SupabaseClient, sourceSystem: string, cacheKey: string): Promise<Fm3ExternalCache | null> {
  const { data, error } = await client
    .from("fm3_external_cache")
    .select("*")
    .eq("source_system", sourceSystem)
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error) throw error;
  return data as Fm3ExternalCache | null;
}

export async function getFm3ProjectFoundation(client: SupabaseClient, projectId: string): Promise<Fm3ProjectFoundation | null> {
  const project = await getFm3ProjectById(client, projectId);
  if (!project) return null;

  const [unitTypes, transactions, metrics] = await Promise.all([
    listFm3UnitTypesByProject(client, projectId),
    listFm3TransactionsByProject(client, projectId),
    listFm3ProjectMetricsByProject(client, projectId),
  ]);

  return {
    project,
    unitTypes,
    transactions,
    metrics,
  };
}
