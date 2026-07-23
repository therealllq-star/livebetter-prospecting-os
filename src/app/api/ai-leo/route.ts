import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";

const OPENAI_MODEL = "gpt-4.1-mini";

type AiLeoLeadContext = {
  name: string;
  grade: string;
  stage: string;
  source: string;
  campaign: string;
  remarks: string;
  nextFollowUp: string;
  nextAction: string;
  appointmentDate: string;
  focusSummary: string;
  timeline: string[];
};

type AiLeoRequestBody = {
  prompt?: string;
  leadContext?: AiLeoLeadContext;
};

const SYSTEM_PROMPT = [
  "You are AI Leo, Leo's CRM prospecting copilot for real estate lead follow-up.",
  "Reason only from the CRM context provided.",
  "Clearly separate known facts from missing information.",
  "Do not invent buyer details, motivations, objections, or timeline.",
  "Help identify the best next objective and next action.",
  "When asked, draft concise WhatsApp or call preparation notes in a warm, human, non-pushy style.",
  "Keep answers practical and tailored to the lead context.",
].join(" ");

function buildLeadContextText(leadContext: AiLeoLeadContext) {
  return [
    `Name: ${leadContext.name || "Unknown"}`,
    `Grade: ${leadContext.grade || "Unknown"}`,
    `Stage: ${leadContext.stage || "Unknown"}`,
    `Source: ${leadContext.source || "Unknown"}`,
    `Campaign: ${leadContext.campaign || "Unknown"}`,
    `Remarks: ${leadContext.remarks || "None"}`,
    `Next follow-up: ${leadContext.nextFollowUp || "Not set"}`,
    `Next action: ${leadContext.nextAction || "Not set"}`,
    `Appointment: ${leadContext.appointmentDate || "Not set"}`,
    `Focus summary: ${leadContext.focusSummary || "None"}`,
    "Timeline (oldest to newest):",
    ...(leadContext.timeline.length ? leadContext.timeline.map((entry) => `- ${entry}`) : ["- No recorded activity"]),
  ].join("\n");
}

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";

  const outputText = (payload as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText.trim();
  }

  const output = (payload as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }).output;
  if (!Array.isArray(output)) return "";

  const text = output
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text?.trim())
    .filter(Boolean)
    .join("\n\n");

  return text;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "You must be signed in to use AI Leo." },
      { status: 401 },
    );
  }

  let body: AiLeoRequestBody;
  try {
    body = (await request.json()) as AiLeoRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  const leadContext = body.leadContext;

  if (!prompt) {
    return NextResponse.json({ error: "A prompt is required." }, { status: 400 });
  }

  if (!leadContext?.name) {
    return NextResponse.json({ error: "Lead context is required." }, { status: 400 });
  }

  const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `User request:\n${prompt}\n\nLead context:\n${buildLeadContextText(leadContext)}`,
            },
          ],
        },
      ],
      max_output_tokens: 500,
    }),
  });

  const payload = (await openAiResponse.json().catch(() => null)) as unknown;

  if (!openAiResponse.ok) {
    const errorMessage =
      payload && typeof payload === "object" && "error" in payload && payload.error && typeof payload.error === "object" && "message" in payload.error
        ? String(payload.error.message)
        : "OpenAI request failed.";

    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }

  const responseText = extractResponseText(payload);
  if (!responseText) {
    return NextResponse.json(
      { error: "OpenAI returned an empty response." },
      { status: 502 },
    );
  }

  return NextResponse.json({ response: responseText, model: OPENAI_MODEL });
}