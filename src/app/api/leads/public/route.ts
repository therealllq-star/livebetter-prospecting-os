import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  "https://livebettersg.com",
  "https://www.livebettersg.com",
]);

type LeadSubmissionBody = {
  name?: string;
  phone?: string;
  email?: string;
  campaign?: string;
  source?: string;
  landingPage?: string;
  project?: string;
  bedType?: string;
  sizeSqft?: string | number;
  currentPsf?: string | number;
  entryPrice?: string | number;
  exitScore?: string | number;
  submittedAt?: string;
};

function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://livebettersg.com";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function splitName(fullName: string | undefined): { first: string; last: string | null } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const first = parts.shift();
  return { first: first ?? "Unknown", last: parts.join(" ") || null };
}

function temperatureFromScore(score: number | null): "HOT" | "WARM" | "NURTURE" {
  if (score == null || Number.isNaN(score)) return "WARM";
  if (score >= 70) return "HOT";
  if (score >= 45) return "WARM";
  return "NURTURE";
}

function parseBedrooms(value: string | undefined): number | null {
  if (!value) return null;
  const match = String(value).match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

export async function OPTIONS(request: Request): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing Supabase server configuration");
    return NextResponse.json({ error: "Server not configured" }, { status: 500, headers });
  }

  let body: LeadSubmissionBody;
  try {
    body = (await request.json()) as LeadSubmissionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers });
  }

  if (!body.name || !body.phone) {
    return NextResponse.json({ error: "name and phone are required" }, { status: 400, headers });
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
    source: body.source || "Property Opportunity Website",
    campaign: body.campaign || null,
    ad_name: null,
    landing_page: body.landingPage || "https://livebettersg.com",
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
    console.error("Failed to insert landing-page lead:", error);
    return NextResponse.json({ error: "Failed to save lead" }, { status: 500, headers });
  }

  return NextResponse.json({ ok: true, id: data.id }, { headers });
}
