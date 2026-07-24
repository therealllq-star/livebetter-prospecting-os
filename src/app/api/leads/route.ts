import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// These are read from environment variables. Service-role credentials must stay server-side.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Required intake secret for inbound submissions.
const INTAKE_SECRET = process.env.LEAD_INTAKE_SECRET;

// Only the landing-page origin may call this endpoint from a browser.
const ALLOWED_ORIGIN = "https://exit-risk-analysis-livebettersg.netlify.app";

type LeadSubmissionBody = {
  name?: string;
  phone?: string;
  email?: string;
  campaign?: string;
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

export async function POST(request: Request): Promise<NextResponse> {
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

  let body: LeadSubmissionBody;
  try {
    const parsed: unknown = await request.json();
    body = (parsed as LeadSubmissionBody) ?? {};
  } catch {
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
    source: "Exit Risk Tool",
    campaign: body.campaign || null,
    ad_name: body.adName || null,
    landing_page: body.landingPage || "exit-risk-analysis-livebettersg.netlify.app",
    current_property_name: body.project || null,
    estimated_property_value: estimatedValue,
    bedrooms: parseBedrooms(body.bedType),
    ai_summary: summary,
    notes: summary,
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