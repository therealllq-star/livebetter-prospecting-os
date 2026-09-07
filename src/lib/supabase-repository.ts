import { createClient } from "@/utils/supabase/client";
import { type Lead, type LeadGrade, type LeadStage, type ActivityEntry } from "@/lib/crm";

type SupabaseClient = ReturnType<typeof createClient>;

type SupabaseLeadRecord = {
  id?: string;
  created_at?: string;
  updated_at?: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  temperature?: string | null;
  lead_score?: number | null;
  action_priority?: string | null;
  source?: string | null;
  campaign?: string | null;
  ad_name?: string | null;
  landing_page?: string | null;
  current_property_type?: string | null;
  current_property_name?: string | null;
  estimated_property_value?: number | null;
  outstanding_loan?: number | null;
  ownership_structure?: string | null;
  mop_ssd_status?: string | null;
  buying_objective?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  bedrooms?: number | null;
  preferred_locations?: string | null;
  preferred_property_type?: string | null;
  market_preference?: string | null;
  motivation?: string | null;
  main_concern?: string | null;
  timeline?: string | null;
  decision_makers?: string | null;
  financing_status?: string | null;
  selling_existing_property?: boolean | null;
  last_contact_at?: string | null;
  next_action_type?: string | null;
  next_action_at?: string | null;
  ai_summary?: string | null;
  suggested_angle?: string | null;
  automation_status?: string | null;
  human_handoff_required?: boolean | null;
  notes?: string | null;
};

type SupabaseActivityRecord = {
  id?: string;
  lead_id?: string;
  activity_type?: string;
  description?: string;
  created_at?: string;
  created_by?: string | null;
};

type SupabaseAppointmentRecord = {
  id?: string;
  lead_id?: string;
  appointment_time?: string | null;
  status?: string | null;
  notes?: string | null;
  created_at?: string;
};

type SupabaseTaskRecord = {
  id?: string;
  lead_id?: string;
  title?: string;
  description?: string;
  status?: string;
  due_at?: string | null;
  created_at?: string;
};

const stageStatusMap: Record<LeadStage, string> = {
  "New Lead": "new",
  "Attempting Contact": "contacting",
  Connected: "contacted",
  Conversation: "conversation",
  "Follow-Up": "follow_up",
  "Appointment Set": "appointment_set",
  Showflat: "showflat",
  Negotiation: "negotiation",
  Closed: "closed",
  "Lost / KIV": "kiv",
};

const statusStageMap: Record<string, LeadStage> = {
  new: "New Lead",
  contacting: "Attempting Contact",
  contacted: "Connected",
  conversation: "Conversation",
  follow_up: "Follow-Up",
  appointment_set: "Appointment Set",
  showflat: "Showflat",
  negotiation: "Negotiation",
  closed: "Closed",
  kiv: "Lost / KIV",
};

const gradeTemperatureMap: Record<LeadGrade, string> = {
  A: "HOT",
  B: "WARM",
  C: "NURTURE",
  D: "LOW",
};

const temperatureGradeMap: Record<string, LeadGrade> = {
  HOT: "A",
  WARM: "B",
  NURTURE: "C",
  LOW: "D",
};

let lastKnownLeadIds = new Set<string>();
let syncWatcherStarted = false;
let pollTimer: number | null = null;
let syncingDeletedIds = new Set<string>();

export function mapLeadToSupabaseLead(lead: Lead): SupabaseLeadRecord {
  const [firstName, ...lastNameParts] = lead.name.trim().split(/\s+/);
  return {
    id: lead.id,
    first_name: firstName ?? lead.name,
    last_name: lastNameParts.join(" ") || null,
    phone: lead.phone || null,
    email: null,
    status: stageStatusMap[lead.stage] ?? "new",
    temperature: gradeTemperatureMap[lead.grade] ?? "WARM",
    lead_score: lead.grade === "A" ? 90 : lead.grade === "B" ? 70 : lead.grade === "C" ? 45 : 20,
    action_priority: lead.nextAction || null,
    source: lead.source || null,
    campaign: lead.campaign || null,
    last_contact_at: lead.lastContact || null,
    next_action_type: lead.nextAction || null,
    next_action_at: lead.nextFollowUp || null,
    ai_summary: lead.focusSummary || lead.remarks || null,
    suggested_angle: lead.queueReason || null,
    automation_status: lead.isDemo ? "demo" : "manual",
    human_handoff_required: false,
    notes: lead.remarks || null,
    motivation: lead.remarks || null,
    timeline: lead.nextFollowUp || null,
    created_at: lead.createdDate || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function mapSupabaseLeadToLead(record: SupabaseLeadRecord, activities: ActivityEntry[]): Lead {
  const grade = temperatureGradeMap[String(record.temperature ?? "WARM").toUpperCase()] ?? "B";
  const stage = statusStageMap[String(record.status ?? "new").toLowerCase()] ?? "New Lead";
  const fullName = [record.first_name, record.last_name].filter(Boolean).join(" ").trim();

  return {
    id: record.id ?? `lead-${Date.now()}`,
    name: fullName || "Unnamed lead",
    phone: record.phone ?? "",
    grade,
    source: (record.source as Lead["source"]) ?? "Other",
    campaign: record.campaign ?? "",
    leadType: "Unknown",
    stage,
    lastContact: record.last_contact_at ?? "",
    nextFollowUp: record.next_action_at ?? "",
    nextAction: record.next_action_type ?? "",
    remarks: record.notes ?? record.motivation ?? "",
    appointmentDate: "",
    createdDate: record.created_at ?? new Date().toISOString(),
    isDemo: (record.automation_status ?? "") === "demo",
    lastOutcome: undefined,
    lastOutcomeNotes: undefined,
    queueReason: record.suggested_angle ?? undefined,
    focusSummary: record.ai_summary ?? undefined,
    activity: activities,
  };
}

export async function getSupabaseLeadCount(client: SupabaseClient) {
  const { count, error } = await client.from("leads").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function inspectSupabaseLeadRead(client: SupabaseClient) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const { data: userData, error: userError } = await client.auth.getUser();
  const { data: leadRows, error: leadError } = await client.from("leads").select("*").order("created_at", { ascending: false }).limit(10);

  return {
    sessionExists: Boolean(sessionData.session),
    userExists: Boolean(userData.user),
    sessionErrorMessage: sessionError?.message ?? null,
    userErrorMessage: userError?.message ?? null,
    rawLeadCount: Array.isArray(leadRows) ? leadRows.length : 0,
    rawLeadRows: Array.isArray(leadRows) ? leadRows : [],
    queryErrorCode: leadError?.code ?? null,
    queryErrorMessage: leadError?.message ?? null,
  };
}

async function deleteSupabaseLead(client: SupabaseClient, leadId: string) {
  if (!leadId || leadId.startsWith("lead-") || leadId.startsWith("demo-")) return;
  if (syncingDeletedIds.has(leadId)) return;
  syncingDeletedIds.add(leadId);
  try {
    const { error } = await client.from("leads").delete().eq("id", leadId);
    if (error) console.error("Failed to delete Supabase lead:", error);
  } finally {
    syncingDeletedIds.delete(leadId);
  }
}

function notifyNewLead(name: string) {
  if (typeof window === "undefined") return;
  document.title = `🔔 New Lead · ${name} · Live Better SG`;
  window.setTimeout(() => {
    if (document.visibilityState === "visible") document.title = "Live Better SG · Prospecting OS";
  }, 8000);

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("New lead received", {
      body: `${name} just submitted a property enquiry.`,
    });
  }
}

function startSyncWatcher(client: SupabaseClient) {
  if (typeof window === "undefined" || syncWatcherStarted) return;
  syncWatcherStarted = true;

  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  window.localStorage.setItem = (key: string, value: string) => {
    originalSetItem(key, value);
    if (key !== "livebetter-prospecting-os") return;

    try {
      const parsed = JSON.parse(value) as { leads?: Lead[] };
      const currentIds = new Set((parsed.leads ?? []).map((lead) => lead.id));
      const deletedIds = [...lastKnownLeadIds].filter((id) => !currentIds.has(id));
      void Promise.all(deletedIds.map((id) => deleteSupabaseLead(client, id)));
      for (const id of currentIds) lastKnownLeadIds.add(id);
      for (const id of [...lastKnownLeadIds]) {
        if (!currentIds.has(id)) lastKnownLeadIds.delete(id);
      }
    } catch {
      // Ignore malformed local storage writes.
    }
  };

  pollTimer = window.setInterval(async () => {
    try {
      const { data, error } = await client
        .from("leads")
        .select("id, first_name, last_name, created_at")
        .order("created_at", { ascending: false });
      if (error || !data) return;

      const rows = data as Array<{ id: string; first_name?: string | null; last_name?: string | null; created_at?: string | null }>;
      const currentIds = new Set(rows.map((row) => row.id));
      const newRows = rows.filter((row) => !lastKnownLeadIds.has(row.id));

      if (lastKnownLeadIds.size && newRows.length) {
        const newest = newRows[0];
        const name = [newest.first_name, newest.last_name].filter(Boolean).join(" ") || "New lead";
        notifyNewLead(name);
        await fetchSupabaseLeads(client);
        window.location.reload();
        return;
      }

      lastKnownLeadIds = currentIds;
    } catch {
      // Keep the CRM usable if polling is temporarily unavailable.
    }
  }, 15000);
}

export async function fetchSupabaseLeads(client: SupabaseClient): Promise<Lead[]> {
  const { data: leadRows, error: leadError } = await client.from("leads").select("*").order("created_at", { ascending: false });
  if (leadError) throw leadError;

  const leadIds = (leadRows ?? []).map((row) => row.id).filter(Boolean);
  let activityRows: SupabaseActivityRecord[] = [];
  if (leadIds.length) {
    const { data, error: activityError } = await client.from("activities").select("*").in("lead_id", leadIds).order("created_at", { ascending: false });
    if (activityError) throw activityError;
    activityRows = (data ?? []) as SupabaseActivityRecord[];
  }

  const leadsById = new Map<string, Lead>();
  (leadRows ?? []).forEach((row) => {
    const leadActivities = activityRows
      .filter((item) => item.lead_id === row.id)
      .map((item) => ({
        id: item.id ?? `${row.id}-${Math.random()}`,
        type: mapActivityTypeFromSupabase(item.activity_type),
        title: item.activity_type ?? "Activity",
        details: item.description ?? "",
        createdAt: item.created_at ?? new Date().toISOString(),
        outcome: undefined,
      }));
    leadsById.set(row.id, mapSupabaseLeadToLead(row as SupabaseLeadRecord, leadActivities));
  });

  const mappedLeads = Array.from(leadsById.values());
  lastKnownLeadIds = new Set(mappedLeads.map((lead) => lead.id));
  startSyncWatcher(client);

  if (typeof window !== "undefined") {
    try {
      const storageKey = "livebetter-prospecting-os";
      const stored = window.localStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) as { scripts?: unknown } : null;
      window.localStorage.setItem(storageKey, JSON.stringify({ leads: mappedLeads, scripts: parsed?.scripts }));
    } catch {
      // Keep the Supabase result usable even if localStorage is unavailable.
    }
  }

  return mappedLeads;
}

function mapActivityTypeFromSupabase(value?: string | null): ActivityEntry["type"] {
  switch (value) {
    case "call":
      return "call";
    case "whatsapp":
      return "whatsapp";
    case "appointment":
      return "appointment";
    case "note":
      return "note";
    case "follow_up":
      return "follow-up";
    case "status":
      return "status";
    default:
      return "status";
  }
}

export async function createSupabaseLead(client: SupabaseClient, lead: Lead, userId?: string | null) {
  const payload = mapLeadToSupabaseLead(lead);
  const { data, error } = await client.from("leads").insert(payload).select("*").single();
  if (error) throw error;
  if (lead.activity?.length) {
    await createSupabaseActivity(client, data.id, lead.activity[0], userId);
  }
  return mapSupabaseLeadToLead(data as SupabaseLeadRecord, []);
}

export async function updateSupabaseLead(client: SupabaseClient, lead: Lead, userId?: string | null) {
  const payload = mapLeadToSupabaseLead(lead);
  const { data, error } = await client.from("leads").update(payload).eq("id", lead.id).select("*").single();
  if (error) throw error;
  return mapSupabaseLeadToLead(data as SupabaseLeadRecord, []);
}

export async function createSupabaseActivity(client: SupabaseClient, leadId: string, activity: ActivityEntry, userId?: string | null) {
  const payload: SupabaseActivityRecord = {
    lead_id: leadId,
    activity_type: normalizeActivityType(activity.type),
    description: activity.details || activity.title,
    created_at: activity.createdAt || new Date().toISOString(),
    created_by: userId ?? null,
  };

  const { error } = await client.from("activities").insert(payload);
  if (error) throw error;
}

function normalizeActivityType(type: ActivityEntry["type"]) {
  switch (type) {
    case "call":
      return "call";
    case "whatsapp":
      return "whatsapp";
    case "appointment":
      return "appointment";
    case "follow-up":
      return "follow_up";
    case "note":
      return "note";
    case "status":
      return "status";
    default:
      return "status";
  }
}

export async function createSupabaseAppointment(client: SupabaseClient, leadId: string, appointmentDate: string, notes: string) {
  const payload: SupabaseAppointmentRecord = {
    lead_id: leadId,
    appointment_time: appointmentDate || null,
    status: "scheduled",
    notes: notes || null,
    created_at: new Date().toISOString(),
  };

  const { error } = await client.from("appointments").insert(payload);
  if (error) throw error;
}

export async function createSupabaseTask(client: SupabaseClient, leadId: string, title: string, dueAt: string, description: string) {
  const payload: SupabaseTaskRecord = {
    lead_id: leadId,
    title,
    description,
    status: "pending",
    due_at: dueAt || null,
    created_at: new Date().toISOString(),
  };

  const { error } = await client.from("tasks").insert(payload);
  if (error) throw error;
}

export async function createSupabaseConversation(client: SupabaseClient, leadId: string, note: string, userId?: string | null) {
  const payload = {
    lead_id: leadId,
    content: note,
    created_at: new Date().toISOString(),
    created_by: userId ?? null,
  };

  const { error } = await client.from("conversations").insert(payload);
  if (error) throw error;
}

export function getLocalLeadCount() {
  if (typeof window === "undefined") return 0;
  try {
    const stored = window.localStorage.getItem("livebetter-prospecting-os");
    const parsed = stored ? JSON.parse(stored) : null;
    return Array.isArray(parsed?.leads) ? parsed.leads.length : 0;
  } catch {
    return 0;
  }
}
