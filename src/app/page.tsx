"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  buildDemoLeads,
  buildWhatsAppLink,
  compareLeadPriority,
  describeOutcome,
  emptyLead,
  formatDate,
  getLeadQueueReason,
  getStorageKey,
  getSuggestedObjective,
  getWeeklyActivityMetrics,
  gradeAccent,
  gradeLabels,
  hasDuplicateLead,
  isDueToday,
  isOverdue,
  scriptDefaults,
  type Lead,
  type LeadGrade,
  type LeadOutcome,
  type LeadSource,
  type LeadStage,
  type ScriptLibrary,
} from "@/lib/crm";
import { fetchSupabaseLeads, inspectSupabaseLeadRead } from "@/lib/supabase-repository";

const views = [
  "Dashboard",
  "Daily Queue",
  "Master CRM",
  "Pipeline",
  "Reconnect",
  "Playbook",
  "Settings",
] as const;

type View = (typeof views)[number];

export default function Home() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<View>("Dashboard");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState<LeadGrade | "All">("All");
  const [stageFilter, setStageFilter] = useState<LeadStage | "All">("All");
  const [sourceFilter, setSourceFilter] = useState<LeadSource | "All">("All");
  const [draft, setDraft] = useState<Lead>(emptyLead);
  const [showModal, setShowModal] = useState(false);
  const [scriptLibrary, setScriptLibrary] = useState<ScriptLibrary>(scriptDefaults);
  const [reconnectMessage, setReconnectMessage] = useState("");
  const [focusLeadId, setFocusLeadId] = useState<string | null>(null);
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [supabaseReadState, setSupabaseReadState] = useState<{
    status: "idle" | "connected" | "error";
    authenticated: boolean;
    leadCount: number;
    rawLeadCount: number;
    leads: Lead[];
    error: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    sessionExists: boolean;
    userExists: boolean;
  }>({ status: "idle", authenticated: false, leadCount: 0, rawLeadCount: 0, leads: [], error: null, errorCode: null, errorMessage: null, sessionExists: false, userExists: false });

  useEffect(() => {
    const client = createClient();
    Promise.all([client.auth.getSession(), client.auth.getUser()]).then(([sessionResult, userResult]) => {
      const session = sessionResult.data.session;
      const user = userResult.data.user;
      const hasSession = Boolean(session && session.access_token);
      const hasUser = Boolean(!userResult.error && user);

      if (hasSession && hasUser) {
        setIsAuthenticated(true);
      } else {
        router.replace("/login");
      }
      setAuthChecked(true);
    });
  }, [router]);

  const loadSupabaseLeads = async () => {
    const client = createClient();
    try {
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser();

      const inspection = await inspectSupabaseLeadRead(client);

      if (userError || !user || !inspection.sessionExists || !inspection.userExists) {
        setSupabaseReadState({
          status: "error",
          authenticated: false,
          leadCount: 0,
          rawLeadCount: inspection.rawLeadCount,
          leads: [],
          error: "No authenticated Supabase session is available for the leads query.",
          errorCode: inspection.queryErrorCode,
          errorMessage: inspection.queryErrorMessage,
          sessionExists: inspection.sessionExists,
          userExists: inspection.userExists,
        });
        return;
      }

      const leadsFromSupabase = await fetchSupabaseLeads(client);
      setLeads(leadsFromSupabase);
      if (leadsFromSupabase[0]) setSelectedLeadId(leadsFromSupabase[0].id);
      setSupabaseReadState({
        status: "connected",
        authenticated: true,
        leadCount: leadsFromSupabase.length,
        rawLeadCount: inspection.rawLeadCount,
        leads: leadsFromSupabase,
        error: null,
        errorCode: inspection.queryErrorCode,
        errorMessage: inspection.queryErrorMessage,
        sessionExists: inspection.sessionExists,
        userExists: inspection.userExists,
      });
    } catch (error) {
      setSupabaseReadState({
        status: "error",
        authenticated: true,
        leadCount: 0,
        rawLeadCount: 0,
        leads: [],
        error: error instanceof Error ? error.message : "Unknown Supabase read error.",
        errorCode: null,
        errorMessage: error instanceof Error ? error.message : null,
        sessionExists: false,
        userExists: false,
      });
    }
  };

  useEffect(() => {
    if (!authChecked || !isAuthenticated) {
      setSupabaseReadState({ status: "idle", authenticated: false, leadCount: 0, rawLeadCount: 0, leads: [], error: null, errorCode: null, errorMessage: null, sessionExists: false, userExists: false });
      return;
    }

    void loadSupabaseLeads();
  }, [authChecked, isAuthenticated]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(getStorageKey());
      if (stored) {
        const parsed = JSON.parse(stored) as { leads?: Lead[]; scripts?: ScriptLibrary };
        if (parsed.leads?.length) {
          setLeads(parsed.leads);
          if (parsed.leads[0]) setSelectedLeadId(parsed.leads[0].id);
        } else {
          const demoLeads = buildDemoLeads();
          setLeads(demoLeads);
          setSelectedLeadId(demoLeads[0].id);
        }
        if (parsed.scripts) setScriptLibrary(parsed.scripts);
      } else {
        const demoLeads = buildDemoLeads();
        setLeads(demoLeads);
        setSelectedLeadId(demoLeads[0].id);
      }
    } catch {
      const demoLeads = buildDemoLeads();
      setLeads(demoLeads);
      setSelectedLeadId(demoLeads[0].id);
    }
  }, []);

  useEffect(() => {
    if (leads.length) {
      window.localStorage.setItem(getStorageKey(), JSON.stringify({ leads, scripts: scriptLibrary }));
    }
  }, [leads, scriptLibrary]);

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const matchesSearch = [lead.name, lead.phone, lead.nextAction, lead.remarks]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesGrade = gradeFilter === "All" || lead.grade === gradeFilter;
      const matchesStage = stageFilter === "All" || lead.stage === stageFilter;
      const matchesSource = sourceFilter === "All" || lead.source === sourceFilter;
      return matchesSearch && matchesGrade && matchesStage && matchesSource;
    });
  }, [leads, gradeFilter, search, sourceFilter, stageFilter]);

  const sortedPriorityLeads = useMemo(() => [...filteredLeads].sort(compareLeadPriority).slice(0, 5), [filteredLeads]);
  const todayCalls = useMemo(() => [...filteredLeads].sort(compareLeadPriority).slice(0, 6), [filteredLeads]);
  const weeklyMetrics = useMemo(() => getWeeklyActivityMetrics(leads), [leads]);
  const focusLead = useMemo(() => leads.find((lead) => lead.id === focusLeadId) ?? todayCalls[0] ?? null, [focusLeadId, leads, todayCalls]);

  const pipelineByStage = useMemo(() => {
    return (["New Lead", "Attempting Contact", "Connected", "Conversation", "Follow-Up", "Appointment Set", "Showflat", "Negotiation", "Closed", "Lost / KIV"] as LeadStage[]).map((stage) => ({
      stage,
      leads: filteredLeads.filter((lead) => lead.stage === stage),
    }));
  }, [filteredLeads]);

  const summary = useMemo(() => {
    const total = leads.length;
    const gradeA = leads.filter((lead) => lead.grade === "A").length;
    const dueToday = leads.filter((lead) => isDueToday(lead.nextFollowUp)).length;
    const overdue = leads.filter((lead) => isOverdue(lead.nextFollowUp)).length;
    const appointments = leads.filter((lead) => lead.stage === "Appointment Set" || lead.stage === "Showflat").length;
    const conversionRate = total ? Math.round((leads.filter((lead) => lead.stage === "Closed").length / total) * 100) : 0;
    return { total, gradeA, dueToday, overdue, appointments, conversionRate };
  }, [leads]);

  const openLead = (lead: Lead) => {
    setSelectedLeadId(lead.id);
    setFocusLeadId(lead.id);
    setActiveView("Master CRM");
  };

  const updateLead = (leadId: string, updates: Partial<Lead>) => {
    setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, ...updates } : lead)));
  };

  const addLead = () => {
    const newLead: Lead = {
      ...emptyLead,
      id: `lead-${Date.now()}`,
      createdDate: new Date().toISOString(),
      lastContact: new Date().toISOString(),
      nextFollowUp: new Date().toISOString(),
      nextAction: "Make first contact",
      remarks: "Added from quick add",
      activity: [{ id: `activity-${Date.now()}`, type: "status", title: "Lead created", details: "New lead added to CRM", createdAt: new Date().toISOString() }],
    };
    setLeads((prev) => [newLead, ...prev]);
    setSelectedLeadId(newLead.id);
    setShowModal(true);
    setDraft(newLead);
    setActiveView("Master CRM");
  };

  const saveDraft = () => {
    const normalized = { ...draft, phone: draft.phone.trim() };
    const duplicate = hasDuplicateLead(leads, { ...normalized, id: normalized.id || `lead-${Date.now()}` } as Lead);
    if (duplicate) {
      setValidationMessage("This number already exists in your CRM. Please review or merge the duplicate before saving.");
      return;
    }

    const id = normalized.id || `lead-${Date.now()}`;
    const toSave: Lead = {
      ...normalized,
      id,
      queueReason: getLeadQueueReason({ ...normalized, id, lastOutcome: undefined, lastOutcomeNotes: undefined, queueReason: undefined } as Lead),
      focusSummary: normalized.remarks || "Ready for the next action",
      activity: normalized.activity.length ? normalized.activity : [{ id: `activity-${Date.now()}`, type: "status", title: "Lead created", details: "New lead added to CRM", createdAt: new Date().toISOString() }],
    };
    if (normalized.id) {
      updateLead(normalized.id, toSave);
    } else {
      setLeads((prev) => [toSave, ...prev]);
    }
    setValidationMessage("");
    setSelectedLeadId(id);
    setShowModal(false);
    setDraft(emptyLead);
  };

  const deleteLead = (leadId: string) => {
    setLeads((prev) => prev.filter((lead) => lead.id !== leadId));
    if (selectedLeadId === leadId) {
      const remaining = leads.filter((lead) => lead.id !== leadId);
      setSelectedLeadId(remaining[0]?.id ?? null);
    }
  };

  const quickAction = (leadId: string, action: string, details: string, type: LeadOutcome | null = null) => {
    setLeads((prev) => prev.map((lead) => (lead.id === leadId ? {
      ...lead,
      activity: [
        ...lead.activity,
        { id: `activity-${Date.now()}`, type: "status", title: action, details, createdAt: new Date().toISOString(), outcome: type ?? undefined },
      ],
      lastContact: new Date().toISOString(),
      lastOutcome: type ?? lead.lastOutcome,
      lastOutcomeNotes: details,
      queueReason: getLeadQueueReason({ ...lead, lastOutcome: type ?? lead.lastOutcome, lastOutcomeNotes: details }),
      focusSummary: `${action}: ${details}`,
    } : lead)));
  };

  const updateSelectedLead = (updates: Partial<Lead>) => {
    if (!selectedLead) return;
    updateLead(selectedLead.id, updates);
  };

  const handleLeadAction = (leadId: string, action: string) => {
    const lead = leads.find((item) => item.id === leadId);
    if (!lead) return;

    if (action === "CALL") {
      quickAction(leadId, "Call made", `Called ${lead.name}`, "connected");
      return;
    }

    if (action === "WHATSAPP") {
      quickAction(leadId, "WhatsApp sent", `Sent WhatsApp to ${lead.name}`, "follow-up");
      return;
    }

    if (action === "CONNECTED") {
      updateLead(leadId, { stage: "Connected", nextAction: "Capture notes and next follow-up" });
      quickAction(leadId, "Connected", `Connected with ${lead.name}`, "connected");
      return;
    }

    if (action === "NO ANSWER") {
      const followUpDate = new Date();
      followUpDate.setDate(followUpDate.getDate() + 2);
      updateLead(leadId, { stage: "Attempting Contact", nextFollowUp: followUpDate.toISOString(), nextAction: "Try again tomorrow" });
      quickAction(leadId, "No answer", `No answer from ${lead.name}`, "no-answer");
      return;
    }

    if (action === "FOLLOW UP") {
      const followUpDate = new Date();
      followUpDate.setDate(followUpDate.getDate() + 1);
      updateLead(leadId, { nextFollowUp: followUpDate.toISOString(), nextAction: "Follow up again" });
      quickAction(leadId, "Follow up", `Scheduled follow-up for ${lead.name}`, "follow-up");
      return;
    }

    if (action === "APPOINTMENT SET") {
      const appointmentDate = new Date();
      appointmentDate.setDate(appointmentDate.getDate() + 3);
      updateLead(leadId, { stage: "Appointment Set", appointmentDate: appointmentDate.toISOString(), nextAction: "Prepare appointment summary" });
      quickAction(leadId, "Appointment set", `Appointment set for ${lead.name}`, "appointment-set");
      return;
    }

    if (action === "INVALID NUMBER") {
      updateLead(leadId, { stage: "Lost / KIV", nextAction: "Verify contact details and keep a note" });
      quickAction(leadId, "Invalid number", `Marked ${lead.name} as invalid number`, "invalid-number");
    }
  };

  const saveOutcome = () => {
    if (!focusLead) return;
    const outcome: LeadOutcome = "follow-up";
    updateLead(focusLead.id, {
      lastOutcome: outcome,
      lastOutcomeNotes: outcomeNotes || "Outcome captured in queue",
      nextAction: "Take the next step from the captured outcome",
      queueReason: getLeadQueueReason({ ...focusLead, lastOutcome: outcome, lastOutcomeNotes: outcomeNotes || "Outcome captured in queue" }),
      focusSummary: outcomeNotes || "Outcome captured in queue",
    });
    quickAction(focusLead.id, "Outcome logged", outcomeNotes || "Outcome captured in queue", outcome);
    setOutcomeNotes("");
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(leads, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "livebetter-leads.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed)) {
          setLeads(parsed as Lead[]);
          setSelectedLeadId(parsed[0]?.id ?? null);
        }
      } catch {
        alert("The selected file could not be imported.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-[#fcfaef] text-[#171717]">
      <div className="mx-auto flex max-w-7xl flex-col lg:flex-row">
        <aside className="w-full border-b border-[#e7e0d0] bg-[#f8f3e5] p-6 lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r">
          <div className="mb-8">
            <p className="text-xs uppercase tracking-[0.3em] text-[#b08c2c]">Live Better SG</p>
            <h1 className="mt-2 text-2xl font-semibold">Prospecting OS</h1>
            <p className="mt-2 text-sm text-[#5f5a52]">Buy Smart. Live Better.</p>
          </div>
          <button onClick={addLead} className="mb-8 w-full rounded-2xl bg-[#171717] px-4 py-3 text-sm font-semibold text-white">+ ADD LEAD</button>
          <nav className="space-y-2">
            {views.map((view) => (
              <button key={view} onClick={() => setActiveView(view)} className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm transition ${activeView === view ? "bg-white text-[#171717] shadow-sm" : "text-[#5f5a52] hover:bg-white/70"}`}>
                {view}
                {activeView === view ? <span className="text-[#b08c2c]">●</span> : null}
              </button>
            ))}
          </nav>
          <div className="mt-8 rounded-2xl border border-[#e7e0d0] bg-white/70 p-4 text-sm text-[#5f5a52]">
            <p className="font-semibold text-[#171717]">Focus today</p>
            <p className="mt-2">Contact, converse, follow up, and convert.</p>
          </div>
        </aside>
        <main className="flex-1 p-6 lg:p-8">
          <header className="mb-6 flex flex-col gap-4 rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">{activeView}</p>
              <h2 className="mt-2 text-2xl font-semibold">Premium lead operations for a Singapore real estate advisory practice.</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-4 py-3 text-sm text-[#5f5a52]">
                Demo data is enabled locally. Your changes are saved in this browser.
              </div>
              <button
                onClick={async () => {
                  await createClient().auth.signOut();
                  router.replace("/login");
                }}
                className="rounded-2xl border border-[#e7e0d0] px-4 py-3 text-sm font-semibold text-[#171717]"
              >
                Sign out
              </button>
            </div>
          </header>

          {activeView === "Dashboard" && (
            <div className="space-y-6">
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Total Leads", value: summary.total },
                  { label: "Grade A Leads", value: summary.gradeA },
                  { label: "Follow-ups Due Today", value: summary.dueToday },
                  { label: "Overdue Follow-ups", value: summary.overdue },
                  { label: "Appointments", value: summary.appointments },
                  { label: "Calls Made This Week", value: weeklyMetrics.calls },
                  { label: "Conversations This Week", value: weeklyMetrics.conversations },
                  { label: "Appointment Conversion Rate", value: `${summary.conversionRate}%` },
                ].map((card) => (
                  <div key={card.label} className="rounded-[24px] border border-[#e7e0d0] bg-white p-5 shadow-sm">
                    <p className="text-sm text-[#5f5a52]">{card.label}</p>
                    <p className="mt-3 text-2xl font-semibold">{card.value}</p>
                  </div>
                ))}
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
                <div className="rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Today's Priority</p>
                      <h3 className="mt-2 text-xl font-semibold">Highest value leads needing action</h3>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {sortedPriorityLeads.map((lead) => (
                      <div key={lead.id} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold">{lead.name}</p>
                            <p className="text-sm text-[#5f5a52]">{lead.grade} · {lead.source} · {lead.stage}</p>
                          </div>
                          <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${gradeAccent[lead.grade]}`}>{gradeLabels[lead.grade]}</div>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm text-[#5f5a52] md:grid-cols-2">
                          <p>Last contact: {formatDate(lead.lastContact)}</p>
                          <p>Next action: {lead.nextAction}</p>
                          <p>Follow-up: {formatDate(lead.nextFollowUp)}</p>
                          <p>Stage: {lead.stage}</p>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button onClick={() => handleLeadAction(lead.id, "CALL")} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Quick Call</button>
                          <button onClick={() => handleLeadAction(lead.id, "WHATSAPP")} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">WhatsApp</button>
                          <button onClick={() => handleLeadAction(lead.id, "FOLLOW UP")} className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white">Mark Complete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                  <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Weekly activity</p>
                  <h3 className="mt-2 text-xl font-semibold">Calls, conversations and appointments</h3>
                  <div className="mt-6 space-y-4">
                    {[
                      { label: "Calls", value: weeklyMetrics.calls, target: "20/week" },
                      { label: "Conversations", value: weeklyMetrics.conversations, target: "15/week" },
                      { label: "Appointments", value: weeklyMetrics.appointments, target: "8/week" },
                    ].map((item) => (
                      <div key={item.label}>
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span>{item.label}</span>
                          <span className="font-semibold">{item.value}</span>
                        </div>
                        <div className="h-2 rounded-full bg-[#f0e8d8]">
                          <div className="h-2 rounded-full bg-[#171717]" style={{ width: `${Math.min(100, Math.round((Number(item.value) / 20) * 100))}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-[#5f5a52]">Target {item.target}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeView === "Master CRM" && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3 rounded-[24px] border border-[#e7e0d0] bg-white p-4 shadow-sm">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search leads" className="min-w-[220px] flex-1 rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2" />
                <select value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value as LeadGrade | "All")} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2">
                  <option value="All">All grades</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </select>
                <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as LeadStage | "All")} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2">
                  <option value="All">All stages</option>
                  {['New Lead','Attempting Contact','Connected','Conversation','Follow-Up','Appointment Set','Showflat','Negotiation','Closed','Lost / KIV'].map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                </select>
                <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as LeadSource | "All")} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2">
                  <option value="All">All sources</option>
                  <option value="Facebook Ads">Facebook Ads</option>
                  <option value="PropertyGuru">PropertyGuru</option>
                  <option value="Carousell">Carousell</option>
                  <option value="Referral">Referral</option>
                  <option value="Old Lead">Old Lead</option>
                  <option value="Organic">Organic</option>
                  <option value="Other">Other</option>
                </select>
                <button onClick={() => setShowModal(true)} className="rounded-2xl bg-[#171717] px-4 py-2 text-sm font-semibold text-white">Add Lead</button>
              </div>

              <div className="overflow-hidden rounded-[24px] border border-[#e7e0d0] bg-white shadow-sm">
                <div className="grid grid-cols-[1.3fr_0.7fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-[#e7e0d0] bg-[#f8f3e5] px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#5f5a52]">
                  <div>Name</div>
                  <div>Grade</div>
                  <div>Source</div>
                  <div>Stage</div>
                  <div>Next Follow-up</div>
                  <div>Action</div>
                </div>
                {filteredLeads.map((lead) => (
                  <div key={lead.id} className="grid grid-cols-[1.3fr_0.7fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-[#f0e8d8] px-4 py-3 text-sm last:border-b-0">
                    <button onClick={() => openLead(lead)} className="text-left font-semibold text-[#171717]">{lead.name}</button>
                    <div className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${gradeAccent[lead.grade]}`}>{lead.grade}</div>
                    <div>{lead.source}</div>
                    <div>{lead.stage}</div>
                    <div>{formatDate(lead.nextFollowUp)}</div>
                    <div className="flex gap-2">
                      <button onClick={() => { setDraft({ ...lead }); setShowModal(true); }} className="rounded-full border border-[#e7e0d0] px-2 py-1">Edit</button>
                      <button onClick={() => deleteLead(lead.id)} className="rounded-full border border-[#e7e0d0] px-2 py-1">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeView === "Daily Queue" && (
            <div className="space-y-6">
              <section className="rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Daily action queue</p>
                    <h3 className="mt-2 text-xl font-semibold">One lead at a time, with the next best action surfaced.</h3>
                  </div>
                  <div className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-4 py-3 text-sm text-[#5f5a52]">
                    {todayCalls.length} leads in the queue today
                  </div>
                </div>

                {focusLead ? (
                  <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.8fr]">
                    <div className="rounded-[24px] border border-[#e7e0d0] bg-[#fcfaef] p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold">{focusLead.name}</p>
                          <p className="mt-1 text-sm text-[#5f5a52]">{focusLead.phone} · {focusLead.source}</p>
                        </div>
                        <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${gradeAccent[focusLead.grade]}`}>{gradeLabels[focusLead.grade]}</div>
                      </div>

                      <div className="mt-4 space-y-3 text-sm text-[#5f5a52]">
                        <p><span className="font-semibold text-[#171717]">Why this lead is next:</span> {focusLead.queueReason ?? getLeadQueueReason(focusLead)}</p>
                        <p><span className="font-semibold text-[#171717]">Suggested objective:</span> {getSuggestedObjective(focusLead)}</p>
                        <p><span className="font-semibold text-[#171717]">Context:</span> {focusLead.remarks || "No context captured yet."}</p>
                        <p><span className="font-semibold text-[#171717]">Next action:</span> {focusLead.nextAction}</p>
                      </div>

                      <div className="mt-5 flex flex-wrap gap-2">
                        <button onClick={() => handleLeadAction(focusLead.id, "CALL")} className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white">CALL</button>
                        <button onClick={() => handleLeadAction(focusLead.id, "WHATSAPP")} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">WHATSAPP</button>
                        <button onClick={() => handleLeadAction(focusLead.id, "CONNECTED")} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">CONNECTED</button>
                        <button onClick={() => handleLeadAction(focusLead.id, "NO ANSWER")} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">NO ANSWER</button>
                        <button onClick={() => handleLeadAction(focusLead.id, "FOLLOW UP")} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">FOLLOW UP</button>
                        <button onClick={() => handleLeadAction(focusLead.id, "APPOINTMENT SET")} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">APPOINTMENT SET</button>
                        <button onClick={() => handleLeadAction(focusLead.id, "INVALID NUMBER")} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">INVALID NUMBER</button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-[24px] border border-[#e7e0d0] bg-white p-4">
                        <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Capture outcome</p>
                        <textarea value={outcomeNotes} onChange={(event) => setOutcomeNotes(event.target.value)} className="mt-3 min-h-[100px] w-full rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2" placeholder="What happened on the call?" />
                        <button onClick={saveOutcome} className="mt-3 rounded-2xl bg-[#171717] px-4 py-2 text-sm font-semibold text-white">Save outcome</button>
                      </div>
                      <div className="rounded-[24px] border border-[#e7e0d0] bg-white p-4">
                        <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Quick links</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {focusLead.phone ? <a href={buildWhatsAppLink(focusLead.phone)} target="_blank" rel="noreferrer" className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Open WhatsApp</a> : null}
                          <button onClick={() => setActiveView("Master CRM")} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Open CRM</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 rounded-[24px] border border-[#e7e0d0] bg-white p-8 text-center text-[#5f5a52]">No leads need attention right now.</div>
                )}
              </section>

              <section className="rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Queue roster</p>
                    <h3 className="mt-2 text-xl font-semibold">Next few leads to work through</h3>
                  </div>
                </div>
                <div className="space-y-3">
                  {todayCalls.map((lead) => (
                    <div key={lead.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
                      <div>
                        <p className="font-semibold">{lead.name}</p>
                        <p className="text-sm text-[#5f5a52]">{lead.grade} · {lead.stage} · {lead.nextAction}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setFocusLeadId(lead.id)} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Focus</button>
                        <button onClick={() => openLead(lead)} className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white">Open lead</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeView === "Pipeline" && (
            <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {pipelineByStage.map((column) => (
                <div key={column.stage} className="rounded-[24px] border border-[#e7e0d0] bg-white p-4 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-semibold">{column.stage}</h3>
                    <span className="text-sm text-[#5f5a52]">{column.leads.length}</span>
                  </div>
                  <div className="space-y-3">
                    {column.leads.map((lead) => (
                      <div key={lead.id} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-3">
                        <p className="font-semibold">{lead.name}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#5f5a52]">
                          <span className={`rounded-full border px-2 py-1 ${gradeAccent[lead.grade]}`}>{lead.grade}</span>
                          <span className="rounded-full border border-[#e7e0d0] px-2 py-1">{lead.source}</span>
                        </div>
                        <p className="mt-3 text-sm">Next action: {lead.nextAction}</p>
                        <p className="text-sm">Follow-up: {formatDate(lead.nextFollowUp)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeView === "Reconnect" && (
            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Reconnect</p>
                <h3 className="mt-2 text-xl font-semibold">Work through old leads systematically</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {['No contact > 30 days','No contact > 60 days','No contact > 90 days','KIV leads','Old Facebook leads','Old PropertyGuru leads'].map((filter) => <span key={filter} className="rounded-full border border-[#e7e0d0] px-3 py-1 text-sm text-[#5f5a52]">{filter}</span>)}
                </div>
                <div className="mt-6 space-y-3">
                  {leads.filter((lead) => lead.grade === "C" || lead.grade === "D" || isOverdue(lead.nextFollowUp)).slice(0, 5).map((lead) => (
                    <div key={lead.id} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{lead.name}</p>
                          <p className="text-sm text-[#5f5a52]">Last contact {formatDate(lead.lastContact)}</p>
                        </div>
                        <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${gradeAccent[lead.grade]}`}>{gradeLabels[lead.grade]}</div>
                      </div>
                      <textarea value={reconnectMessage} onChange={(event) => setReconnectMessage(event.target.value)} className="mt-3 min-h-[100px] w-full rounded-2xl border border-[#e7e0d0] bg-white px-3 py-2" placeholder="Write a reconnect message for this lead" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Suggested framework</p>
                <div className="mt-4 space-y-3 text-sm text-[#5f5a52]">
                  <p>Warm opener</p>
                  <p>→ Context</p>
                  <p>→ What changed?</p>
                  <p>→ Market-based or personal-based reason?</p>
                  <p>→ Relevant insight</p>
                  <p>→ Soft next step</p>
                </div>
              </div>
            </div>
          )}

          {activeView === "Playbook" && (
            <div className="space-y-4">
              {Object.entries(scriptLibrary).map(([key, value]) => (
                <div key={key} className="rounded-[24px] border border-[#e7e0d0] bg-white p-5 shadow-sm">
                  <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">{key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase())}</p>
                  <textarea value={value} onChange={(event) => setScriptLibrary((prev) => ({ ...prev, [key]: event.target.value }))} className="mt-3 min-h-[120px] w-full rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2" />
                </div>
              ))}
            </div>
          )}

          {activeView === "Settings" && (
            <div className="space-y-6">
              <div className="rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">SUPABASE CONNECTION TEST</p>
                <h3 className="mt-2 text-xl font-semibold">Read-only verification for the authenticated leads table</h3>
                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
                    <p className="text-sm text-[#5f5a52]">Connection</p>
                    <p className="mt-2 font-semibold">{supabaseReadState.status === "connected" ? "Connected" : supabaseReadState.status === "error" ? "Error" : "Idle"}</p>
                  </div>
                  <div className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
                    <p className="text-sm text-[#5f5a52]">Authenticated</p>
                    <p className="mt-2 font-semibold">{supabaseReadState.authenticated ? "Yes" : "No"}</p>
                  </div>
                  <div className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
                    <p className="text-sm text-[#5f5a52]">Supabase leads found</p>
                    <p className="mt-2 font-semibold">{supabaseReadState.leadCount}</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
                    <p className="text-sm text-[#5f5a52]">Raw rows before mapping</p>
                    <p className="mt-2 font-semibold">{supabaseReadState.rawLeadCount}</p>
                  </div>
                  <div className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
                    <p className="text-sm text-[#5f5a52]">Session exists</p>
                    <p className="mt-2 font-semibold">{supabaseReadState.sessionExists ? "Yes" : "No"}</p>
                  </div>
                  <div className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
                    <p className="text-sm text-[#5f5a52]">User exists</p>
                    <p className="mt-2 font-semibold">{supabaseReadState.userExists ? "Yes" : "No"}</p>
                  </div>
                </div>
                {supabaseReadState.error ? <p className="mt-4 text-sm text-[#b08c2c]">{supabaseReadState.error}</p> : null}
                {supabaseReadState.errorCode ? <p className="mt-2 text-sm text-[#5f5a52]">Error code: {supabaseReadState.errorCode}</p> : null}
                {supabaseReadState.errorMessage ? <p className="mt-2 text-sm text-[#5f5a52]">Error message: {supabaseReadState.errorMessage}</p> : null}
                <div className="mt-6 flex flex-wrap gap-3">
                  <button onClick={() => { void loadSupabaseLeads(); }} className="rounded-2xl bg-[#171717] px-4 py-2 text-sm font-semibold text-white">VIEW SUPABASE LEADS</button>
                  <p className="text-sm text-[#5f5a52]">No localStorage data is changed by this test.</p>
                </div>
                {supabaseReadState.leads.length ? (
                  <div className="mt-6 space-y-3">
                    {supabaseReadState.leads.map((lead) => (
                      <div key={lead.id} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold">{lead.name}</p>
                            <p className="text-sm text-[#5f5a52]">{lead.phone || "No phone on record"}</p>
                          </div>
                          <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${gradeAccent[lead.grade]}`}>{gradeLabels[lead.grade]}</div>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm text-[#5f5a52] md:grid-cols-2">
                          <p>Stage: {lead.stage}</p>
                          <p>Source: {lead.source}</p>
                          <p>Next action: {lead.nextAction || "—"}</p>
                          <p>Remarks: {lead.remarks || "—"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Data safety</p>
                <h3 className="mt-2 text-xl font-semibold">Export and import your CRM locally</h3>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button onClick={exportData} className="rounded-2xl border border-[#e7e0d0] px-4 py-2">EXPORT DATA</button>
                  <label className="cursor-pointer rounded-2xl bg-[#171717] px-4 py-2 text-white">
                    IMPORT DATA
                    <input type="file" accept="application/json" className="hidden" onChange={importData} />
                  </label>
                </div>
                <p className="mt-4 text-sm text-[#5f5a52]">This is designed for a smooth transition to Supabase later.</p>
              </div>
            </div>
          )}

          {selectedLead && (
            <section className="mt-6 rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Lead detail</p>
                  <h3 className="mt-2 text-xl font-semibold">{selectedLead.name}</h3>
                </div>
                <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${gradeAccent[selectedLead.grade]}`}>{gradeLabels[selectedLead.grade]}</div>
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
                <div className="space-y-4 rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Contact</p>
                    <p className="mt-2 font-semibold">{selectedLead.phone}</p>
                  </div>
                  <div>
                    <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Lead profile</p>
                    <p className="mt-2 text-sm">Source: {selectedLead.source}</p>
                    <p className="text-sm">Campaign: {selectedLead.campaign}</p>
                    <p className="text-sm">Lead type: {selectedLead.leadType}</p>
                  </div>
                  <div>
                    <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Current stage</p>
                    <p className="mt-2 text-sm">{selectedLead.stage}</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[#e7e0d0] bg-white p-4">
                    <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Timeline / activity</p>
                    <div className="mt-3 space-y-2">
                      {selectedLead.activity.map((entry) => (
                        <div key={entry.id} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <p className="font-semibold">{entry.title}</p>
                            <p className="text-xs text-[#5f5a52]">{formatDate(entry.createdAt)}</p>
                          </div>
                          <p className="mt-1 text-[#5f5a52]">{entry.details}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#e7e0d0] bg-white p-4">
                    <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Actions</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => updateSelectedLead({ nextAction: "Add note", stage: "Connected" })} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Add Note</button>
                      <button onClick={() => updateSelectedLead({ nextAction: "Schedule follow-up" })} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Schedule Follow-Up</button>
                      <button onClick={() => updateSelectedLead({ grade: selectedLead.grade === "A" ? "B" : "A" })} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Change Grade</button>
                      <button onClick={() => updateSelectedLead({ stage: "Appointment Set" })} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Mark Appointment</button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Lead editor</p>
                <h3 className="mt-2 text-xl font-semibold">{draft.id ? "Edit lead" : "Add lead"}</h3>
              </div>
              <button onClick={() => { setShowModal(false); setDraft(emptyLead); }} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Close</button>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="Name" className="rounded-2xl border border-[#e7e0d0] px-3 py-2" />
              <input value={draft.phone} onChange={(event) => setDraft((prev) => ({ ...prev, phone: event.target.value }))} placeholder="Phone Number" className="rounded-2xl border border-[#e7e0d0] px-3 py-2" />
              <select value={draft.grade} onChange={(event) => setDraft((prev) => ({ ...prev, grade: event.target.value as LeadGrade }))} className="rounded-2xl border border-[#e7e0d0] px-3 py-2">
                <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option>
              </select>
              <select value={draft.source} onChange={(event) => setDraft((prev) => ({ ...prev, source: event.target.value as LeadSource }))} className="rounded-2xl border border-[#e7e0d0] px-3 py-2">
                {['Facebook Ads','PropertyGuru','Carousell','Referral','Old Lead','Organic','Other'].map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
              <input value={draft.campaign} onChange={(event) => setDraft((prev) => ({ ...prev, campaign: event.target.value }))} placeholder="Campaign" className="rounded-2xl border border-[#e7e0d0] px-3 py-2" />
              <select value={draft.leadType} onChange={(event) => setDraft((prev) => ({ ...prev, leadType: event.target.value as Lead["leadType"] }))} className="rounded-2xl border border-[#e7e0d0] px-3 py-2">
                {['HDB Upgrader','First-Time Buyer','Investor','Resale Buyer','Seller','New Launch Buyer','Unknown'].map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <select value={draft.stage} onChange={(event) => setDraft((prev) => ({ ...prev, stage: event.target.value as LeadStage }))} className="rounded-2xl border border-[#e7e0d0] px-3 py-2">
                {['New Lead','Attempting Contact','Connected','Conversation','Follow-Up','Appointment Set','Showflat','Negotiation','Closed','Lost / KIV'].map((stage) => <option key={stage} value={stage}>{stage}</option>)}
              </select>
              <input type="date" value={draft.nextFollowUp?.slice(0, 10) ?? ""} onChange={(event) => setDraft((prev) => ({ ...prev, nextFollowUp: event.target.value }))} className="rounded-2xl border border-[#e7e0d0] px-3 py-2" />
              <input value={draft.nextAction} onChange={(event) => setDraft((prev) => ({ ...prev, nextAction: event.target.value }))} placeholder="Next Action" className="rounded-2xl border border-[#e7e0d0] px-3 py-2" />
              <input value={draft.remarks} onChange={(event) => setDraft((prev) => ({ ...prev, remarks: event.target.value }))} placeholder="Remarks" className="rounded-2xl border border-[#e7e0d0] px-3 py-2" />
              <input type="date" value={draft.appointmentDate?.slice(0, 10) ?? ""} onChange={(event) => setDraft((prev) => ({ ...prev, appointmentDate: event.target.value }))} className="rounded-2xl border border-[#e7e0d0] px-3 py-2" />
            </div>
            {validationMessage ? <p className="mt-4 text-sm text-[#b08c2c]">{validationMessage}</p> : null}
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => { setShowModal(false); setDraft(emptyLead); setValidationMessage(""); }} className="rounded-2xl border border-[#e7e0d0] px-4 py-2">Cancel</button>
              <button onClick={saveDraft} className="rounded-2xl bg-[#171717] px-4 py-2 text-white">Save Lead</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
