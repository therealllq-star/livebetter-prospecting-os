import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const runtime = "nodejs";

type LeadRecord = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  source?: string | null;
};

type StoredPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;
const LEAD_PUSH_WEBHOOK_SECRET = process.env.LEAD_PUSH_WEBHOOK_SECRET;

function extractLeadRecord(payload: unknown): LeadRecord | null {
  if (!payload || typeof payload !== "object") return null;

  const candidate = payload as {
    record?: unknown;
    new?: unknown;
  };

  const raw =
    candidate.record && typeof candidate.record === "object"
      ? candidate.record
      : candidate.new && typeof candidate.new === "object"
        ? candidate.new
        : payload;

  if (!raw || typeof raw !== "object") return null;
  return raw as LeadRecord;
}

function buildLeadDisplay(lead: LeadRecord): { leadId: string; name: string; source: string } | null {
  const leadId = lead.id?.trim();
  if (!leadId) return null;

  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "Unnamed lead";
  const source = lead.source?.trim() || "Other";

  return { leadId, name, source };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !VAPID_PUBLIC_KEY ||
    !VAPID_PRIVATE_KEY ||
    !VAPID_SUBJECT ||
    !LEAD_PUSH_WEBHOOK_SECRET
  ) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const providedSecret = request.headers.get("x-webhook-secret");
  if (!providedSecret || providedSecret !== LEAD_PUSH_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leadRecord = extractLeadRecord(payload);
  const lead = leadRecord ? buildLeadDisplay(leadRecord) : null;

  if (!lead) {
    return NextResponse.json({ ok: true, delivered: 0, staleRemoved: 0, skipped: true });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth");

  if (subscriptionsError) {
    return NextResponse.json({ error: "Failed to read push subscriptions" }, { status: 500 });
  }

  const activeSubscriptions = (subscriptions ?? []) as StoredPushSubscription[];
  if (!activeSubscriptions.length) {
    return NextResponse.json({ ok: true, delivered: 0, staleRemoved: 0 });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const notificationPayload = {
    title: "New inbound lead",
    body: `${lead.name} · ${lead.source}`,
    data: {
      leadId: lead.leadId,
      url: `/?leadId=${encodeURIComponent(lead.leadId)}&view=Master%20CRM`,
    },
  };

  let delivered = 0;
  const staleEndpoints: string[] = [];

  for (const subscription of activeSubscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify(notificationPayload)
      );
      delivered += 1;
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error
        ? Number((error as { statusCode?: number }).statusCode)
        : null;

      if (statusCode === 404 || statusCode === 410) {
        staleEndpoints.push(subscription.endpoint);
      }
    }
  }

  if (staleEndpoints.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
  }

  return NextResponse.json({ ok: true, delivered, staleRemoved: staleEndpoints.length });
}
