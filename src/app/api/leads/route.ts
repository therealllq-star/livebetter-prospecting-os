import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

// These are read from environment variables. Service-role credentials must stay server-side.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Required intake secret for inbound submissions.
const INTAKE_SECRET = process.env.LEAD_INTAKE_SECRET;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const META_API_VERSION = process.env.META_API_VERSION || "v23.0";
const META_ALLOWED_PAGE_IDS = process.env.META_ALLOWED_PAGE_IDS;

// Only the landing-page origin may call this endpoint from a browser.
const ALLOWED_ORIGIN = "https://exit-risk-analysis-livebettersg.netlify.app";

type LeadSubmissionBody = {
  name?: string;
  phone?: string;
  email?: string;
  campaign?: string;
  source?: string;
  funnelStage?: string;
  address?: string;
  town?: string;
  currentFlatType?: string;
  indicativeResaleValue?: string | number;
  upgradingTo?: string;
  targetAddress?: string;
  mopStatus?: string;
  resaleValue?: string | number;
  leaseStartYear?: string | number;
  outstandingLoan?: string | number;
  cpfRefund?: string | number;
  netCashProceeds?: string | number;
  targetPrice?: string | number;
  targetPropType?: string;
  targetFlatType?: string;
  loanSource?: string;
  citizenship?: string;
  timing?: string;
  loanRequired?: string | number;
  monthlyInstalment?: string | number;
  tdsrPass?: string;
  msrPass?: string;
  cashflowDelta?: string | number;
  income1?: string | number;
  income2?: string | number;
  cashSavings?: string | number;
  cpfAvailable?: string | number;
  shortfall?: string | number;
  adName?: string;
  landingPage?: string;
  project?: string;
  bedType?: string;
  sizeSqft?: string | number;
  currentPsf?: string | number;
  entryPrice?: string | number;
  exitScore?: string | number;
  submittedAt?: string;
};

type MetaWebhookEventValue = {
  leadgen_id?: string;
  page_id?: string;
  form_id?: string;
  created_time?: number | string;
  ad_id?: string;
  adgroup_id?: string;
  campaign_id?: string;
};

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: MetaWebhookEventValue;
    }>;
  }>;
};

type MetaLeadField = {
  name?: string;
  values?: Array<string>;
};

type MetaLeadDetails = {
  id?: string;
  created_time?: string;
  ad_id?: string;
  adgroup_id?: string;
  campaign_id?: string;
  form_id?: string;
  page_id?: string;
  field_data?: MetaLeadField[];
};

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-intake-secret",
  };
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function splitName(fullName: string | undefined): { first: string; last: string | null } {
  const trimmed = (fullName ?? "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts.shift();
  return { first: first ?? "Unknown", last: parts.join(" ") || null };
}

function temperatureFromScore(score: number | null): "HOT" | "WARM" | "NURTURE" {
  if (score == null || Number.isNaN(score)) return "WARM";
  if (score >= 70) return "HOT";
  if (score >= 45) return "WARM";
  return "NURTURE";
}

function parseBedrooms(bedType: string | undefined): number | null {
  if (!bedType) return null;
  const match = String(bedType).match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function normalizeMetaVersion(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "v23.0";
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function verifyMetaSignature(rawBody: string, signatureHeader: string, appSecret: string) {
  if (!signatureHeader.startsWith("sha256=")) return false;

  const providedSignature = signatureHeader.slice("sha256=".length).trim();
  if (!providedSignature) return false;

  const expectedSignature = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const providedBuffer = Buffer.from(providedSignature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function parseMetaWebhookPayload(rawBody: string): MetaWebhookPayload | null {
  try {
    const parsed = JSON.parse(rawBody) as MetaWebhookPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractMetaLeadgenEvents(payload: MetaWebhookPayload) {
  if (payload.object !== "page") return [];

  const events: MetaWebhookEventValue[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen" || !change.value?.leadgen_id) continue;
      events.push(change.value);
    }
  }

  return events;
}

function getMetaFieldValue(fieldData: MetaLeadField[] | undefined, candidateNames: string[]) {
  const lookup = new Set(candidateNames.map((name) => name.toLowerCase()));

  for (const field of fieldData ?? []) {
    const normalizedName = field.name?.trim().toLowerCase();
    if (!normalizedName || !lookup.has(normalizedName)) continue;

    const firstValue = field.values?.[0];
    if (typeof firstValue === "string" && firstValue.trim()) return firstValue.trim();
  }

  return "";
}

function parseCreatedAt(value: string | number | undefined) {
  if (typeof value === "number") {
    return new Date(value * 1000).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return new Date(asNumber * 1000).toISOString();
    }

    const timestamp = new Date(value);
    if (!Number.isNaN(timestamp.getTime())) return timestamp.toISOString();
  }

  return new Date().toISOString();
}

async function fetchMetaLeadDetails(leadgenId: string) {
  if (!META_PAGE_ACCESS_TOKEN) {
    throw new Error("META_PAGE_ACCESS_TOKEN is missing");
  }

  const version = normalizeMetaVersion(META_API_VERSION);
  const fields = ["created_time", "field_data", "ad_id", "adgroup_id", "campaign_id", "form_id", "page_id"];
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(leadgenId)}`);
  url.searchParams.set("fields", fields.join(","));
  url.searchParams.set("access_token", META_PAGE_ACCESS_TOKEN);

  const response = await fetch(url, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Meta lead fetch failed with status ${response.status}`);
  }

  return (await response.json()) as MetaLeadDetails;
}

function parseAllowedPageIds() {
  if (!META_ALLOWED_PAGE_IDS?.trim()) return null;
  return new Set(
    META_ALLOWED_PAGE_IDS.split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function buildMetaLeadPayload(eventValue: MetaWebhookEventValue, leadDetails: MetaLeadDetails) {
  const fullName = getMetaFieldValue(leadDetails.field_data, ["full_name", "name"]);
  const firstNameFromField = getMetaFieldValue(leadDetails.field_data, ["first_name"]);
  const lastNameFromField = getMetaFieldValue(leadDetails.field_data, ["last_name"]);
  const email = getMetaFieldValue(leadDetails.field_data, ["email"]);
  const phone = getMetaFieldValue(leadDetails.field_data, ["phone_number", "phone"]);

  let firstName = "Unknown";
  let lastName: string | null = null;

  if (fullName) {
    const split = splitName(fullName);
    firstName = split.first;
    lastName = split.last;
  } else if (firstNameFromField) {
    firstName = firstNameFromField;
    lastName = lastNameFromField || null;
  }

  const campaignId = eventValue.campaign_id || leadDetails.campaign_id || null;
  const adId = eventValue.ad_id || leadDetails.ad_id || null;
  const adSetId = eventValue.adgroup_id || leadDetails.adgroup_id || null;
  const formId = eventValue.form_id || leadDetails.form_id || null;
  const pageId = eventValue.page_id || leadDetails.page_id || null;
  const createdAt = parseCreatedAt(eventValue.created_time || leadDetails.created_time);

  return {
    meta_lead_id: eventValue.leadgen_id || leadDetails.id || null,
    first_name: firstName,
    last_name: lastName,
    phone: phone || null,
    email: email || null,
    status: "new",
    temperature: "WARM",
    lead_score: null,
    source: "Facebook Ads",
    campaign: campaignId,
    ad_name: adId,
    landing_page: pageId && formId ? `meta://page/${pageId}/form/${formId}` : pageId ? `meta://page/${pageId}` : null,
    ai_summary: null,
    notes: [
      "Meta Lead Ad submission.",
      campaignId ? `campaign_id=${campaignId}` : null,
      adSetId ? `adgroup_id=${adSetId}` : null,
      adId ? `ad_id=${adId}` : null,
      formId ? `form_id=${formId}` : null,
      pageId ? `page_id=${pageId}` : null,
    ].filter(Boolean).join(" "),
    automation_status: "manual",
    human_handoff_required: true,
    created_at: createdAt,
    updated_at: new Date().toISOString(),
  };
}

async function handleMetaWebhookPost(rawBody: string, signatureHeader: string) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !META_APP_SECRET || !META_PAGE_ACCESS_TOKEN) {
    console.error("Missing Meta webhook server configuration");
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  if (!verifyMetaSignature(rawBody, signatureHeader, META_APP_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const payload = parseMetaWebhookPayload(rawBody);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const events = extractMetaLeadgenEvents(payload);
  if (!events.length) {
    return NextResponse.json({ ok: true, processed: 0, skipped: true }, { status: 200 });
  }

  const allowedPageIds = parseAllowedPageIds();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let inserted = 0;
  let duplicates = 0;

  for (const eventValue of events) {
    const leadgenId = eventValue.leadgen_id?.trim();
    if (!leadgenId) continue;

    const pageId = (eventValue.page_id || "").trim();
    if (allowedPageIds && (!pageId || !allowedPageIds.has(pageId))) {
      console.warn("Rejected Meta lead event from non-allowlisted page");
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { data: existingLead, error: existingLeadError } = await supabase
      .from("leads")
      .select("id")
      .eq("meta_lead_id", leadgenId)
      .maybeSingle();

    if (existingLeadError) {
      console.error("Failed checking existing Meta lead id");
      return NextResponse.json({ error: "Failed to process lead" }, { status: 500 });
    }

    if (existingLead?.id) {
      duplicates += 1;
      continue;
    }

    let leadDetails: MetaLeadDetails;
    try {
      leadDetails = await fetchMetaLeadDetails(leadgenId);
    } catch (error) {
      console.error("Failed to fetch Meta lead details", error instanceof Error ? error.message : "Unknown error");
      return NextResponse.json({ error: "Failed to process lead" }, { status: 502 });
    }

    const leadPayload = buildMetaLeadPayload(eventValue, leadDetails);

    const { error: insertError } = await supabase.from("leads").insert(leadPayload);
    if (insertError) {
      // Handle race-condition duplicate from concurrent retries.
      if (insertError.code === "23505") {
        duplicates += 1;
        continue;
      }

      console.error("Failed to insert Meta lead", insertError.message);
      return NextResponse.json({ error: "Failed to process lead" }, { status: 500 });
    }

    inserted += 1;
  }

  return NextResponse.json({ ok: true, processed: events.length, inserted, duplicates }, { status: 200 });
}

function parseSubmissionBody(rawBody: string): LeadSubmissionBody | null {
  try {
    const parsed = JSON.parse(rawBody) as LeadSubmissionBody;
    return parsed ?? null;
  } catch {
    return null;
  }
}

function formatCalculatorRemarks(body: LeadSubmissionBody) {
  const fields: Array<[string, string | number | undefined]> = [
    ["Address", body.address],
    ["Town", body.town],
    ["Current flat type", body.currentFlatType],
    ["Indicative resale value", body.indicativeResaleValue],
    ["Upgrading to", body.upgradingTo],
    ["Target address", body.targetAddress],
    ["MOP status", body.mopStatus],
    ["Resale value", body.resaleValue],
    ["Lease start year", body.leaseStartYear],
    ["Outstanding loan", body.outstandingLoan],
    ["CPF refund", body.cpfRefund],
    ["Net cash proceeds", body.netCashProceeds],
    ["Target price", body.targetPrice],
    ["Target property type", body.targetPropType],
    ["Target flat type", body.targetFlatType],
    ["Loan source", body.loanSource],
    ["Citizenship", body.citizenship],
    ["Timing", body.timing],
    ["Loan required", body.loanRequired],
    ["Monthly instalment", body.monthlyInstalment],
    ["TDSR result", body.tdsrPass],
    ["MSR result", body.msrPass],
    ["Monthly cashflow change", body.cashflowDelta],
    ["Main applicant income", body.income1],
    ["Co-applicant income", body.income2],
    ["Cash savings", body.cashSavings],
    ["CPF available", body.cpfAvailable],
    ["Shortfall", body.shortfall],
  ];

  return fields
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

async function handleExistingLeadIntakePost(request: Request, rawBody: string) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json({ error: "Server not configured" }, { status: 500, headers: corsHeaders() });
  }

  if (!INTAKE_SECRET) {
    console.error("Missing LEAD_INTAKE_SECRET");
    return NextResponse.json({ error: "Server not configured" }, { status: 500, headers: corsHeaders() });
  }

  const provided = request.headers.get("x-intake-secret");
  if (provided !== INTAKE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders() });
  }

  const body = parseSubmissionBody(rawBody);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders() });
  }

  if (!body.name || !body.phone) {
    return NextResponse.json({ error: "name and phone are required" }, { status: 400, headers: corsHeaders() });
  }

  const { first, last } = splitName(body.name);
  const exitScore = body.exitScore != null && body.exitScore !== "" ? parseInt(String(body.exitScore), 10) : null;
  const sizeSqft = body.sizeSqft ? parseFloat(String(body.sizeSqft)) : null;
  const currentPsf = body.currentPsf ? parseFloat(String(body.currentPsf)) : null;
  const estimatedValue = sizeSqft && currentPsf ? Math.round(sizeSqft * currentPsf) : null;
  const isHdbUpgraderCalculator = body.source?.trim().toLowerCase() === "hdb-upgrader-calculator";
  const calculatorRemarks = isHdbUpgraderCalculator ? formatCalculatorRemarks(body) : "";

  const summaryParts = [
    exitScore != null ? `Exit Readiness Score: ${exitScore}/100.` : null,
    body.project ? `Project: ${body.project}.` : null,
    body.bedType ? `${body.bedType}${sizeSqft ? `, ${sizeSqft} sqft` : ""}.` : null,
    body.entryPrice ? `Entry price: $${body.entryPrice}.` : null,
    currentPsf ? `Current PSF: $${currentPsf}.` : null,
  ].filter(Boolean);
  const summary = summaryParts.join(" ") || null;

  const payload = {
    first_name: first,
    last_name: last,
    phone: body.phone,
    email: body.email || null,
    status: "new",
    temperature: temperatureFromScore(exitScore),
    lead_score: exitScore,
    source: isHdbUpgraderCalculator ? "HDB Upgrader Calculator" : "Facebook Ads",
    campaign: body.campaign || null,
    ad_name: body.adName || null,
    landing_page: body.landingPage || (isHdbUpgraderCalculator ? "hdb-upgrader-calculator.netlify.app" : "exit-risk-analysis-livebettersg.netlify.app"),
    current_property_name: body.project || body.currentFlatType || null,
    estimated_property_value: estimatedValue ?? body.resaleValue ?? body.indicativeResaleValue ?? null,
    bedrooms: parseBedrooms(body.bedType || body.currentFlatType),
    ai_summary: isHdbUpgraderCalculator ? null : summary,
    notes: calculatorRemarks || summary,
    automation_status: "manual",
    human_handoff_required: true,
    created_at: body.submittedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.from("leads").insert(payload).select("id").single();

  if (error) {
    console.error("Failed to insert lead:", error);
    return NextResponse.json({ error: "Failed to save lead" }, { status: 500, headers: corsHeaders() });
  }

  return NextResponse.json({ ok: true, id: data.id }, { headers: corsHeaders() });
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const hubMode = searchParams.get("hub.mode");
  const hubVerifyToken = searchParams.get("hub.verify_token");
  const hubChallenge = searchParams.get("hub.challenge");

  if (hubMode !== "subscribe" || !hubVerifyToken || !hubChallenge) {
    return NextResponse.json({ error: "Invalid verification request" }, { status: 400 });
  }

  if (!META_WEBHOOK_VERIFY_TOKEN || hubVerifyToken !== META_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return new NextResponse(hubChallenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const metaSignatureHeader = request.headers.get("x-hub-signature-256");

  if (metaSignatureHeader) {
    return handleMetaWebhookPost(rawBody, metaSignatureHeader);
  }

  return handleExistingLeadIntakePost(request, rawBody);
}
