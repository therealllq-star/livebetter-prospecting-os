import { createClient } from "@/utils/supabase/client";
import { type Lead, type LeadClientSide, type LeadGrade, type LeadStage, type ActivityEntry } from "@/lib/crm";

type SupabaseClient = ReturnType<typeof createClient>;

const LEAD_ID_BATCH_SIZE = 100;
const PAGE_SIZE = 1000;
const APPOINTMENT_REQUEST_TIMEOUT_MS = 5000;

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
  client_side?: string | null;
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
  appointment_at?: string | null;
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidSupabaseUuid(value?: string | null) {
  if (!value) return false;
  return UUID_REGEX.test(value.trim());
}

function formatSupabaseError(error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined, action: string) {
  if (!error) return `${action} failed without a Supabase error payload.`;

  const parts = [`${action} failed.`];
  if (error.code) parts.push(`Code: ${error.code}`);
  if (error.message) parts.push(error.message);
  if (error.details) parts.push(`Details: ${error.details}`);
  if (error.hint) parts.push(`Hint: ${error.hint}`);
  return parts.join(" ");
}

const stageStatusMap: Record<LeadStage, string> = {
  "New Lead": "new",
  "Attempting Contact": "contacting",
  Connected: "contacted",
  Conversation: "conversation",
  "Follow-Up": "follow_up",
  "Appointment Set": "appointment_set",
  "Active Client": "active_client",
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
  active_client: "Active Client",
  showflat: "Showflat",
  negotiation: "Negotiation",
  closed: "Closed",
  kiv: "Lost / KIV",
};

function mapOwnershipStructureToClientSide(value?: string | null): LeadClientSide | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "buyer") return "Buyer";
  if (normalized === "seller") return "Seller";
  if (normalized === "buyer + seller" || normalized === "buyer+seller") return "Buyer + Seller";
  return null;
}

function mapSupabaseClientSideToLead(value?: string | null): LeadClientSide | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "buyer") return "Buyer";
  if (normalized === "seller") return "Seller";
  if (normalized === "buyer_seller" || normalized === "buyer+seller" || normalized === "buyer + seller") return "Buyer + Seller";
  return null;
}

function mapLeadClientSideToSupabase(value?: LeadClientSide | null): "buyer" | "seller" | "buyer_seller" | null {
  if (!value) return null;
  if (value === "Buyer") return "buyer";
  if (value === "Seller") return "seller";
  return "buyer_seller";
}

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
    client_side: mapLeadClientSideToSupabase(lead.clientSide),
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

export function mapSupabaseLeadToLead(record: SupabaseLeadRecord, activities: ActivityEntry[], appointmentDate?: string): Lead {
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
    clientSide: mapSupabaseClientSideToLead(record.client_side) ?? mapOwnershipStructureToClientSide(record.ownership_structure),
    stage,
    lastContact: record.last_contact_at ?? "",
    nextFollowUp: record.next_action_at ?? "",
    nextAction: record.next_action_type ?? "",
    remarks: record.notes ?? record.motivation ?? "",
    appointmentDate: appointmentDate ?? "",
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

export async function fetchSupabaseLeads(client: SupabaseClient): Promise<Lead[]> {
  const { data: leadRows, error: leadError } = await client.from("leads").select("*").order("created_at", { ascending: false });
  if (leadError) throw new Error(formatSupabaseError(leadError, "Reading leads"));

  const leadIds = (leadRows ?? []).map((row) => row.id).filter(Boolean);
  let activityRows: SupabaseActivityRecord[] = [];
  let appointmentRows: SupabaseAppointmentRecord[] = [];

  if (leadIds.length) {
    for (let index = 0; index < leadIds.length; index += LEAD_ID_BATCH_SIZE) {
      const leadIdBatch = leadIds.slice(index, index + LEAD_ID_BATCH_SIZE);

      for (let page = 0; ; page += 1) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error: activityError } = await client
          .from("activities")
          .select("*")
          .in("lead_id", leadIdBatch)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (activityError) throw new Error(formatSupabaseError(activityError, "Reading lead activities"));

        const batchRows = (data ?? []) as SupabaseActivityRecord[];
        activityRows.push(...batchRows);

        if (batchRows.length < PAGE_SIZE) break;
      }

      for (let page = 0; ; page += 1) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const appointmentAbortController = new AbortController();
        const timeoutId = setTimeout(() => {
          appointmentAbortController.abort();
        }, APPOINTMENT_REQUEST_TIMEOUT_MS);

        let appointmentData: SupabaseAppointmentRecord[] | null = null;
        let appointmentError: { code?: string; message?: string; details?: string; hint?: string } | null = null;

        try {
          const result = await client
            .from("appointments")
            .select("*")
            .in("lead_id", leadIdBatch)
            .range(from, to)
            .abortSignal(appointmentAbortController.signal);

          appointmentData = (result.data ?? []) as SupabaseAppointmentRecord[];
          appointmentError = result.error;
        } catch {
          appointmentError = { message: "Appointments request timed out or was aborted." };
        } finally {
          clearTimeout(timeoutId);
        }

        if (appointmentError) break;

        const batchRows = appointmentData ?? [];
        appointmentRows.push(...batchRows);
        if (batchRows.length < PAGE_SIZE) break;
      }
    }
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

    const latestAppointment = appointmentRows.find((item) => item.lead_id === row.id && item.appointment_at)?.appointment_at ?? undefined;
    const mappedLead = mapSupabaseLeadToLead(row as SupabaseLeadRecord, leadActivities, latestAppointment);
    leadsById.set(row.id, mappedLead);
  });

  return Array.from(leadsById.values());
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
  // New local leads use temporary IDs like "lead-...".
  // Let Supabase generate the real UUID instead.
  const { id: _temporaryId, ...insertPayload } = payload;
  const { data, error } = await client.from("leads").insert(insertPayload).select("*").single();

  if (error) {
    throw new Error(formatSupabaseError(error, "Creating the lead"));
  }

  if (!data) {
    throw new Error("Creating the lead succeeded without returning a row from Supabase.");
  }

  return mapSupabaseLeadToLead(data as SupabaseLeadRecord, []);
}

export async function updateSupabaseLead(client: SupabaseClient, lead: Lead, userId?: string | null) {
  if (!isValidSupabaseUuid(lead.id)) {
    throw new Error("Lead cannot be updated in Supabase because the id is not a valid UUID.");
  }

  const payload = mapLeadToSupabaseLead(lead);
  const { data, error } = await client.from("leads").update(payload).eq("id", lead.id).select("*").single();
  if (error) {
    throw new Error(formatSupabaseError(error, "Updating the lead"));
  }

  if (!data) {
    throw new Error("Updating the lead succeeded without returning a row from Supabase.");
  }

  return mapSupabaseLeadToLead(data as SupabaseLeadRecord, []);
}

export async function deleteSupabaseLead(client: SupabaseClient, leadId: string) {
  const { error } = await client.from("leads").delete().eq("id", leadId);
  if (error) throw new Error(formatSupabaseError(error, "Deleting the lead"));
}

export async function deleteSupabaseActivity(client: SupabaseClient, activityId: string) {
  if (!isValidSupabaseUuid(activityId)) {
    throw new Error("This activity is not yet persisted to Supabase.");
  }

  const { error } = await client.from("activities").delete().eq("id", activityId);
  if (error) throw new Error(formatSupabaseError(error, "Deleting the activity"));
}

export async function createSupabaseActivity(client: SupabaseClient, leadId: string, activity: ActivityEntry, userId?: string | null) {
  const payload: SupabaseActivityRecord = {
    lead_id: leadId,
    activity_type: normalizeActivityType(activity.type),
    description: activity.details || activity.title,
    created_at: activity.createdAt || new Date().toISOString(),
    created_by: userId ?? null,
  };

  const { data, error } = await client.from("activities").insert(payload).select("*").single();
  if (error) throw new Error(formatSupabaseError(error, "Creating the activity"));

  if (!data) {
    throw new Error("Creating the activity succeeded without returning a row from Supabase.");
  }

  const persisted = data as SupabaseActivityRecord;
  return {
    id: persisted.id ?? activity.id,
    type: mapActivityTypeFromSupabase(persisted.activity_type),
    title: activity.title,
    details: persisted.description ?? activity.details,
    createdAt: persisted.created_at ?? activity.createdAt,
    outcome: activity.outcome,
  } as ActivityEntry;
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
  const payload: Pick<SupabaseAppointmentRecord, "lead_id" | "appointment_at"> = {
    lead_id: leadId,
    appointment_at: appointmentDate || null,
  };

  const { error } = await client.from("appointments").insert(payload);
  if (error) throw new Error(formatSupabaseError(error, "Creating the appointment"));
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
