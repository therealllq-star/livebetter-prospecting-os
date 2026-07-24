import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSupabaseServerClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

type SubscriptionPayload = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

type SubscribeRequestBody = {
  subscription?: SubscriptionPayload;
};

export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  const supabase = createSupabaseServerClient(cookieStore);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SubscribeRequestBody;
  try {
    const parsed: unknown = await request.json();
    body = (parsed as SubscribeRequestBody) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = body.subscription?.endpoint?.trim();
  const p256dh = body.subscription?.keys?.p256dh?.trim();
  const auth = body.subscription?.keys?.auth?.trim();

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Invalid push subscription payload" }, { status: 400 });
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );

  if (error) {
    return NextResponse.json({ error: "Failed to save push subscription" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
