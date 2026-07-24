import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// These are read from Vercel's environment variables — never hard-code
// secrets in this file. NEXT_PUBLIC_SUPABASE_URL already exists (the rest
// of the app uses it); SUPABASE_SERVICE_ROLE_KEY needs to be added fresh in
// Vercel (Project Settings -> Environment Variables). The service role key
// bypasses Row Level Security, which is exactly why it must only ever be
// used here on the server, never sent to the browser.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Optional lightweight spam guard — not real security (it's visible in the
// landing page's public JS anyway), just enough to stop generic bots that
// scan for open POST endpoints and blast them with junk. Leave the Vercel
// env var unset to disable this check entirely.
const INTAKE_SECRET = process.env.LEAD_INTAKE_SECRET;

// Only the exact landing page domain may call this from a browser.
const ALLOWED_ORIGIN = "https://exit-risk-analysis-livebettersg.netlify.app";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-intake-secret",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function splitName(fullName) {
  const trimmed = (fullName || "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts.shift();
  return { first: first || "Unknown", last: parts.join(" ") || null };
}

function temperatureFromScore(score) {
  if (score == null || Number.isNaN(score)) return "WARM";
  if (score >= 70) return "HOT";
  if (score >= 45) return "WARM";
  return "NURTURE";
}

function parseBedrooms(bedType) {
  if (!bedType) return null;
  const match = String(bedType).match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

export async function POST(request) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json({ error: "Server not configured" }, { status: 500, headers: corsHeaders() });
  }

  if (INTAKE_SECRET) {
    const provided = request.headers.get("x-intake-secret");
    if (provided !== INTAKE_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders() });
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders() });
  }

  if (!body?.name || !body?.phone) {
    return NextResponse.json({ error: "name and phone are required" }, { status: 400, headers: corsHeaders() });
  }

  const { first, last } = splitName(body.name);
  const exitScore = body.exitScore != null && body.exitScore !== "" ? parseInt(String(body.exitScore), 10) : null;
  const sizeSqft = body.sizeSqft ? parseFloat(body.sizeSqft) : null;
  const currentPsf = body.currentPsf ? parseFloat(body.currentPsf) : null;
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
