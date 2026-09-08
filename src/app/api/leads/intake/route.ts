import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LEAD_INTAKE_KEY = process.env.LEAD_INTAKE_KEY;

type LeadBody = {
  name?: string;
  phone?: string;
  email?: string;
  situation?: string;
  source?: string;
  page?: string;
  lead_id?: string;
  stage?: string;
  form_position?: string;
  postal?: string;
  address?: string;
  town?: string;
  flat_type?: string;
  floor?: string;
  lease?: string;
  estimate?: string | number;
  submitted_at?: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  if (!LEAD_INTAKE_KEY) {
    console.error("Missing LEAD_INTAKE_KEY");
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const providedKey = request.headers.get("x-api-key");
  if (!providedKey || providedKey !== LEAD_INTAKE_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing Supabase server configuration");
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  let body: LeadBody;
  try {
    body = (await request.json()) as LeadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name || !body.phone) {
    return NextResponse.json({ error: "name and phone are required" }, { status: 400 });
  }

  const parts = body.name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || "Unknown";
  const lastName = parts.join(" ") || null;
  const notes = [
    body.situation ? `Situation: ${body.situation}` : null,
    body.stage ? `Stage: ${body.stage}` : null,
    body.form_position ? `Form position: ${body.form_position}` : null,
    body.postal ? `Postal: ${body.postal}` : null,
    body.address ? `Address: ${body.address}` : null,
    body.town ? `Town: ${body.town}` : null,
    body.flat_type ? `Flat type: ${body.flat_type}` : null,
    body.floor ? `Floor: ${body.floor}` : null,
    body.lease ? `Lease: ${body.lease}` : null,
    body.estimate ? `Estimate: ${body.estimate}` : null,
    body.lead_id ? `Lead ID: ${body.lead_id}` : null,
  ].filter(Boolean).join("\n") || null;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("leads")
    .insert({
      first_name: firstName,
      last_name: lastName,
      phone: body.phone,
      email: body.email || null,
      status: "new",
      temperature: "WARM",
      lead_score: null,
      source: body.source || "HDB Upgrader Calculator",
      campaign: null,
      ad_name: null,
      landing_page: body.page || "hdb-upgraderv3.netlify.app",
      current_property_name: body.flat_type || null,
      estimated_property_value: body.estimate || null,
      bedrooms: null,
      ai_summary: body.situation ? `Situation: ${body.situation}` : null,
      notes,
      automation_status: "manual",
      human_handoff_required: true,
      created_at: body.submitted_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to insert API intake lead:", error.message);
    return NextResponse.json({ error: "Failed to save lead" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id }, { status: 200 });
}
