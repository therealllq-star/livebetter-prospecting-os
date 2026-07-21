export type LeadGrade = "A" | "B" | "C" | "D";
export type LeadSource =
  | "Facebook Ads"
  | "PropertyGuru"
  | "Carousell"
  | "Referral"
  | "Old Lead"
  | "Organic"
  | "Other";
export type LeadType =
  | "HDB Upgrader"
  | "First-Time Buyer"
  | "Investor"
  | "Resale Buyer"
  | "Seller"
  | "New Launch Buyer"
  | "Unknown";
export type LeadStage =
  | "New Lead"
  | "Attempting Contact"
  | "Connected"
  | "Conversation"
  | "Follow-Up"
  | "Appointment Set"
  | "Showflat"
  | "Negotiation"
  | "Closed"
  | "Lost / KIV";
export type ActivityType =
  | "note"
  | "follow-up"
  | "stage"
  | "grade"
  | "appointment"
  | "call"
  | "whatsapp"
  | "status";

export type LeadOutcome = "no-answer" | "connected" | "follow-up" | "kiv" | "appointment-set" | "invalid-number";

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  title: string;
  details: string;
  createdAt: string;
  outcome?: LeadOutcome;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  grade: LeadGrade;
  source: LeadSource;
  campaign: string;
  leadType: LeadType;
  stage: LeadStage;
  lastContact: string;
  nextFollowUp: string;
  nextAction: string;
  remarks: string;
  appointmentDate: string;
  createdDate: string;
  isDemo?: boolean;
  lastOutcome?: LeadOutcome;
  lastOutcomeNotes?: string;
  queueReason?: string;
  focusSummary?: string;
  activity: ActivityEntry[];
}

export interface ScriptLibrary {
  newLeadCall: string;
  noAnswerWhatsApp: string;
  reconnectCall: string;
  reconnectWhatsApp: string;
  appointmentSetting: string;
  notRightTime: string;
  personalReasonKIV: string;
  showflatFollowUp: string;
}

export const gradeLabels: Record<LeadGrade, string> = {
  A: "Hot",
  B: "Warm",
  C: "Nurture",
  D: "Low Priority",
};

export const gradeAccent: Record<LeadGrade, string> = {
  A: "bg-amber-100 text-amber-800 border-amber-200",
  B: "bg-stone-100 text-stone-800 border-stone-300",
  C: "bg-slate-100 text-slate-700 border-slate-200",
  D: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

export const stages: LeadStage[] = [
  "New Lead",
  "Attempting Contact",
  "Connected",
  "Conversation",
  "Follow-Up",
  "Appointment Set",
  "Showflat",
  "Negotiation",
  "Closed",
  "Lost / KIV",
];

export const sources: LeadSource[] = [
  "Facebook Ads",
  "PropertyGuru",
  "Carousell",
  "Referral",
  "Old Lead",
  "Organic",
  "Other",
];

export const leadTypes: LeadType[] = [
  "HDB Upgrader",
  "First-Time Buyer",
  "Investor",
  "Resale Buyer",
  "Seller",
  "New Launch Buyer",
  "Unknown",
];

export const emptyLead = {
  id: "",
  name: "",
  phone: "",
  grade: "B" as LeadGrade,
  source: "Other" as LeadSource,
  campaign: "",
  leadType: "Unknown" as LeadType,
  stage: "New Lead" as LeadStage,
  lastContact: "",
  nextFollowUp: "",
  nextAction: "",
  remarks: "",
  appointmentDate: "",
  createdDate: "",
  activity: [],
};

export const scriptDefaults: ScriptLibrary = {
  newLeadCall:
    "Hi, this is Sarah from Live Better SG. I’m checking in on your property plans and just wanted to share a few relevant options. Is now a good time for a quick chat?",
  noAnswerWhatsApp:
    "Hi, it’s Sarah from Live Better SG. I tried reaching you just now. If it’s convenient, I can share a few options that may be relevant to your plans.",
  reconnectCall:
    "Hi, this is Sarah from Live Better SG. I’m reaching out again because the market has shifted a bit and I thought it may be useful to compare a few options with you.",
  reconnectWhatsApp:
    "Hi, I’m Sarah from Live Better SG. It’s been a while since we last connected, and I thought I’d share a quick update in case it’s useful for your plans.",
  appointmentSetting:
    "Would you be open to a 15-minute chat this week to review the options that fit your timeline?",
  notRightTime:
    "No worries at all. I’ll leave it here for now and check back in a bit later when it’s more suitable.",
  personalReasonKIV:
    "I understand. I’ll keep your details on file and reach out again later when the timing feels right.",
  showflatFollowUp:
    "Thanks for the visit today. I’ve noted your thoughts and can help narrow down the next best option based on your preferences.",
};

function pad(num: number) {
  return String(num).padStart(2, "0");
}

export function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function daysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function buildDemoLeads(): Lead[] {
  return [
    {
      id: "demo-1",
      name: "Megan Tan",
      phone: "+65 9123 4567",
      grade: "A",
      source: "Facebook Ads",
      campaign: "2-Room HDB",
      leadType: "First-Time Buyer",
      stage: "Appointment Set",
      lastContact: daysFromNow(-1),
      nextFollowUp: todayString(),
      nextAction: "Confirm appointment details",
      remarks: "Interested in River Green and wants to compare payments.",
      appointmentDate: daysFromNow(2),
      createdDate: daysFromNow(-8),
      isDemo: true,
      activity: [
        { id: "a1", type: "call", title: "Call made", details: "Spoke about HDB financing options.", createdAt: daysFromNow(-1) },
        { id: "a2", type: "appointment", title: "Appointment set", details: "Viewing confirmed for Friday evening.", createdAt: daysFromNow(0) },
      ],
    },
    {
      id: "demo-2",
      name: "Jared Lim",
      phone: "+65 9777 1122",
      grade: "A",
      source: "PropertyGuru",
      campaign: "New Launch",
      leadType: "Investor",
      stage: "Conversation",
      lastContact: daysFromNow(-3),
      nextFollowUp: daysFromNow(1),
      nextAction: "Send financing comparison",
      remarks: "Comparing yields across suburban projects.",
      appointmentDate: "",
      createdDate: daysFromNow(-12),
      isDemo: true,
      activity: [
        { id: "a3", type: "whatsapp", title: "WhatsApp sent", details: "Shared project comparison notes.", createdAt: daysFromNow(-2) },
      ],
    },
    {
      id: "demo-3",
      name: "Alicia Koh",
      phone: "+65 9334 2111",
      grade: "B",
      source: "Referral",
      campaign: "Resale Review",
      leadType: "Resale Buyer",
      stage: "Follow-Up",
      lastContact: daysFromNow(-5),
      nextFollowUp: daysFromNow(-2),
      nextAction: "Follow up on shortlist",
      remarks: "Needs a larger kitchen and school proximity.",
      appointmentDate: "",
      createdDate: daysFromNow(-20),
      isDemo: true,
      activity: [
        { id: "a4", type: "follow-up", title: "Follow-up scheduled", details: "Sent shortlisting notes.", createdAt: daysFromNow(-5) },
      ],
    },
    {
      id: "demo-4",
      name: "Darren Ong",
      phone: "+65 9888 3344",
      grade: "B",
      source: "Carousell",
      campaign: "Budget Condo",
      leadType: "First-Time Buyer",
      stage: "Attempting Contact",
      lastContact: daysFromNow(-10),
      nextFollowUp: daysFromNow(0),
      nextAction: "Call again today",
      remarks: "Asked for a lower budget plan.",
      appointmentDate: "",
      createdDate: daysFromNow(-18),
      isDemo: true,
      activity: [],
    },
    {
      id: "demo-5",
      name: "Siti Rahman",
      phone: "+65 8123 9988",
      grade: "C",
      source: "Old Lead",
      campaign: "Re-Engage",
      leadType: "Seller",
      stage: "Connected",
      lastContact: daysFromNow(-45),
      nextFollowUp: daysFromNow(7),
      nextAction: "Send updated market snapshot",
      remarks: "Still exploring options; no urgency now.",
      appointmentDate: "",
      createdDate: daysFromNow(-120),
      isDemo: true,
      activity: [
        { id: "a5", type: "status", title: "Reconnected", details: "Spoke about current pricing trends.", createdAt: daysFromNow(-45) },
      ],
    },
    {
      id: "demo-6",
      name: "Kumar Nair",
      phone: "+65 9234 5678",
      grade: "C",
      source: "Organic",
      campaign: "Open House",
      leadType: "HDB Upgrader",
      stage: "New Lead",
      lastContact: daysFromNow(-30),
      nextFollowUp: daysFromNow(5),
      nextAction: "Share recent launch insights",
      remarks: "Interested in upgrading but waiting for the right timing.",
      appointmentDate: "",
      createdDate: daysFromNow(-80),
      isDemo: true,
      activity: [],
    },
    {
      id: "demo-7",
      name: "Rebecca Teo",
      phone: "+65 9765 2211",
      grade: "D",
      source: "Other",
      campaign: "Long Tail",
      leadType: "Unknown",
      stage: "Lost / KIV",
      lastContact: daysFromNow(-90),
      nextFollowUp: daysFromNow(14),
      nextAction: "Revisit in 2 weeks",
      remarks: "On hold due to personal circumstances.",
      appointmentDate: "",
      createdDate: daysFromNow(-180),
      isDemo: true,
      activity: [
        { id: "a6", type: "note", title: "KIV note", details: "Saved for future follow-up.", createdAt: daysFromNow(-90) },
      ],
    },
    {
      id: "demo-8",
      name: "Evelyn Chua",
      phone: "+65 9012 3456",
      grade: "A",
      source: "Facebook Ads",
      campaign: "Executive Condo",
      leadType: "New Launch Buyer",
      stage: "Showflat",
      lastContact: daysFromNow(-2),
      nextFollowUp: daysFromNow(3),
      nextAction: "Send showflat feedback summary",
      remarks: "Very engaged and comparing two sites.",
      appointmentDate: daysFromNow(1),
      createdDate: daysFromNow(-14),
      isDemo: true,
      activity: [
        { id: "a7", type: "note", title: "Showflat feedback", details: "Liked the larger balcony option.", createdAt: daysFromNow(-2) },
      ],
    },
  ];
}

export function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}

export function buildWhatsAppLink(phone: string) {
  const digits = normalizePhone(phone).replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

export function getLeadQueueReason(lead: Lead) {
  if (lead.lastOutcome === "appointment-set") return "Appointment momentum is strong; keep the confirmation thread moving.";
  if (lead.grade === "A" && isOverdue(lead.nextFollowUp)) return "High-value lead is overdue and should be re-engaged now.";
  if (lead.grade === "A" && isDueToday(lead.nextFollowUp)) return "High-value lead is due today for a decisive next step.";
  if (lead.stage === "New Lead" || lead.stage === "Attempting Contact") return "Fresh lead that needs a first meaningful contact this session.";
  if (isOverdue(lead.nextFollowUp)) return "Lead is overdue and needs a clear restart.";
  if (isDueToday(lead.nextFollowUp)) return "Lead is due today and ready for a next action.";
  if (lead.stage === "Follow-Up") return "Follow-up lead that needs a strong close or next meeting.";
  return "Balanced opportunity that fits the current daily queue.";
}

export function getSuggestedObjective(lead: Lead) {
  if (lead.grade === "A" && lead.stage === "Appointment Set") return "Confirm the appointment and send a concise summary before the meeting.";
  if (lead.grade === "A") return "Move this lead into conversation or an appointment today.";
  if (lead.stage === "New Lead" || lead.stage === "Attempting Contact") return "Break the ice and identify their property intent.";
  if (lead.stage === "Follow-Up") return "Reinforce the value proposition and decide on the next meeting.";
  if (lead.stage === "Connected") return "Capture the conversation outcome and book the next step.";
  if (lead.stage === "Appointment Set") return "Confirm details and prepare a sharp pre-visit summary.";
  return "Keep momentum by advancing the next action with a clear call to action.";
}

export function describeOutcome(outcome: LeadOutcome) {
  switch (outcome) {
    case "no-answer":
      return "No answer";
    case "connected":
      return "Connected";
    case "follow-up":
      return "Follow-up";
    case "kiv":
      return "KIV";
    case "appointment-set":
      return "Appointment set";
    case "invalid-number":
      return "Invalid number";
    default:
      return "Update";
  }
}

export function hasDuplicateLead(leads: Lead[], candidate: Lead) {
  const normalized = normalizePhone(candidate.phone);
  if (!normalized) return false;
  return leads.some((lead) => lead.id !== candidate.id && normalizePhone(lead.phone) === normalized);
}

export function getWeeklyActivityMetrics(leads: Lead[]) {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - 7);

  const calls = leads.reduce((count, lead) => {
    return count + lead.activity.filter((entry) => entry.type === "call" && new Date(entry.createdAt) >= cutoff).length;
  }, 0);

  const conversations = leads.reduce((count, lead) => {
    const recentConversation = lead.activity.some((entry) => {
      const createdAt = new Date(entry.createdAt);
      return createdAt >= cutoff && (entry.type === "status" || entry.type === "whatsapp" || entry.type === "call" || entry.type === "appointment");
    });
    return count + (recentConversation ? 1 : 0);
  }, 0);

  const appointments = leads.reduce((count, lead) => {
    return count + lead.activity.filter((entry) => entry.type === "appointment" && new Date(entry.createdAt) >= cutoff).length;
  }, 0);

  return { calls, conversations, appointments };
}

export function compareLeadPriority(a: Lead, b: Lead) {
  const aRank = leadPriorityRank(a);
  const bRank = leadPriorityRank(b);
  if (aRank !== bRank) return aRank - bRank;
  const aDue = a.nextFollowUp ? new Date(a.nextFollowUp).getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.nextFollowUp ? new Date(b.nextFollowUp).getTime() : Number.POSITIVE_INFINITY;
  return aDue - bDue;
}

export function leadPriorityRank(lead: Lead) {
  const today = new Date();
  const due = lead.nextFollowUp ? new Date(lead.nextFollowUp) : null;
  const overdue = due && due < new Date(today.toDateString());
  const dueToday = due && due.toDateString() === today.toDateString();

  if (lead.grade === "A" && overdue) return 0;
  if (lead.grade === "A" && dueToday) return 1;
  if (lead.grade === "B" && overdue) return 2;
  if (lead.grade === "B" && dueToday) return 3;
  if (lead.stage === "New Lead" || lead.stage === "Attempting Contact") return 4;
  if (lead.grade === "C") return 5;
  return 6;
}

export function isOverdue(date: string) {
  if (!date) return false;
  const today = new Date();
  const day = new Date(date);
  today.setHours(0, 0, 0, 0);
  day.setHours(0, 0, 0, 0);
  return day < today;
}

export function isDueToday(date: string) {
  if (!date) return false;
  const today = new Date();
  const day = new Date(date);
  today.setHours(0, 0, 0, 0);
  day.setHours(0, 0, 0, 0);
  return day.getTime() === today.getTime();
}

export function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function getStorageKey() {
  return "livebetter-prospecting-os";
}
