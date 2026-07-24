"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  type ActivityEntry,
  buildCallLink,
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
import {
  createSupabaseActivity,
  createSupabaseAppointment,
  deleteSupabaseActivity,
  createSupabaseLead,
  deleteSupabaseLead,
  fetchSupabaseLeads,
  inspectSupabaseLeadRead,
  isValidSupabaseUuid,
  updateSupabaseLead,
} from "@/lib/supabase-repository";

const views = [
  "Dashboard",
  "Daily Queue",
  "Master CRM",
  "Pipeline",
  "Playbook",
  "Settings",
] as const;

type View = (typeof views)[number];

type InboundLeadNotification = {
  id: string;
  leadId: string;
  name: string;
  source: string;
  createdAt: string;
  unread: boolean;
};

type RealtimeLeadInsertRecord = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  source?: string | null;
};

type PushEnableState = "idle" | "enabling" | "enabled" | "denied" | "unsupported" | "error";

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padded = base64String.padEnd(Math.ceil(base64String.length / 4) * 4, "=");
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray.buffer;
}

export default function Home() {
  const router = useRouter();
  const supabaseClient = useMemo(() => createClient(), []);
  const notifiedLeadIdsRef = useRef<Set<string>>(new Set());
  const handledDeepLinkLeadIdRef = useRef<string | null>(null);
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
  const [currentQueueLeadId, setCurrentQueueLeadId] = useState<string | null>(null);
  const [queueNoteInput, setQueueNoteInput] = useState("");
  const [detailNoteInput, setDetailNoteInput] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [aiLeoPrompt, setAiLeoPrompt] = useState("");
  const [aiLeoResponse, setAiLeoResponse] = useState("");
  const [aiLeoError, setAiLeoError] = useState<string | null>(null);
  const [isAiLeoLoading, setIsAiLeoLoading] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasInitialLeadLoadCompleted, setHasInitialLeadLoadCompleted] = useState(false);
  const [inboundNotifications, setInboundNotifications] = useState<InboundLeadNotification[]>([]);
  const [toastNotificationIds, setToastNotificationIds] = useState<string[]>([]);
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);
  const [pushEnableState, setPushEnableState] = useState<PushEnableState>("idle");
  const [pushStatusMessage, setPushStatusMessage] = useState("Not enabled on this device yet.");
  const [deepLinkLeadId, setDeepLinkLeadId] = useState<string | null>(null);
  const [deepLinkView, setDeepLinkView] = useState<string | null>(null);
  const [supabaseReadState, setSupabaseReadState] = useState<{
    status: "idle" | "loading" | "connected" | "error";
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
    Promise.all([supabaseClient.auth.getSession(), supabaseClient.auth.getUser()]).then(([sessionResult, userResult]) => {
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
  }, [router, supabaseClient]);

  const loadSupabaseLeads = useCallback(async (options?: { focusLeadId?: string }) => {
    try {
      setSupabaseReadState((prev) => ({
        ...prev,
        status: "loading",
        error: null,
        errorCode: null,
        errorMessage: null,
      }));

      const {
        data: { user },
        error: userError,
      } = await supabaseClient.auth.getUser();

      const inspection = await inspectSupabaseLeadRead(supabaseClient);

      if (userError || !user || !inspection.sessionExists || !inspection.userExists) {
        setLeads([]);
        setSelectedLeadId(null);
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

      const leadsFromSupabase = await fetchSupabaseLeads(supabaseClient);
      // Use successfully fetched Supabase leads as the Master CRM dataset.
      setLeads(leadsFromSupabase);
      if (options?.focusLeadId) {
        const focusedLead = leadsFromSupabase.find((lead) => lead.id === options.focusLeadId);
        if (focusedLead) setSelectedLeadId(focusedLead.id);
      }

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
      setLeads([]);
      setSelectedLeadId(null);
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
  }, [supabaseClient]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated) {
      setHasInitialLeadLoadCompleted(false);
      setSupabaseReadState({ status: "idle", authenticated: false, leadCount: 0, rawLeadCount: 0, leads: [], error: null, errorCode: null, errorMessage: null, sessionExists: false, userExists: false });
      return;
    }

    let isMounted = true;
    void loadSupabaseLeads().finally(() => {
      if (isMounted) setHasInitialLeadLoadCompleted(true);
    });

    return () => {
      isMounted = false;
    };
  }, [authChecked, isAuthenticated]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated || !hasInitialLeadLoadCompleted) {
      return;
    }

    const channel = supabaseClient
      .channel("prospecting-os-leads-insert")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, (payload) => {
        try {
          const inserted = payload.new as RealtimeLeadInsertRecord;
          const leadId = inserted.id?.trim();
          if (!leadId || notifiedLeadIdsRef.current.has(leadId)) {
            return;
          }

          notifiedLeadIdsRef.current.add(leadId);

          const fullName = [inserted.first_name, inserted.last_name].filter(Boolean).join(" ").trim() || "Unnamed lead";
          const source = inserted.source?.trim() || "Other";
          const notificationId = `${leadId}:${Date.now()}`;
          const newNotification: InboundLeadNotification = {
            id: notificationId,
            leadId,
            name: fullName,
            source,
            createdAt: new Date().toISOString(),
            unread: true,
          };

          setInboundNotifications((prev) => [newNotification, ...prev].slice(0, 50));
          setToastNotificationIds((prev) => [notificationId, ...prev].slice(0, 10));

          // Reconcile via canonical Supabase read + mapping path.
          void loadSupabaseLeads();
        } catch (error) {
          console.error("Realtime leads insert handler failed:", error);
        }
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error("Realtime channel error for leads insert subscription.");
        }
      });

    return () => {
      void supabaseClient.removeChannel(channel);
    };
  }, [authChecked, hasInitialLeadLoadCompleted, isAuthenticated, loadSupabaseLeads, supabaseClient]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDeepLinkLeadId(params.get("leadId"));
    setDeepLinkView(params.get("view"));
  }, []);

  useEffect(() => {
    if (!authChecked || !isAuthenticated || !deepLinkLeadId) {
      return;
    }

    if (handledDeepLinkLeadIdRef.current === deepLinkLeadId) {
      return;
    }

    const hasLeadInState = leads.some((lead) => lead.id === deepLinkLeadId);
    if (!hasLeadInState) {
      return;
    }

    if (deepLinkView === "Master CRM") {
      setActiveView("Master CRM");
    }
    setSelectedLeadId(deepLinkLeadId);
    handledDeepLinkLeadIdRef.current = deepLinkLeadId;
  }, [authChecked, deepLinkLeadId, deepLinkView, isAuthenticated, leads]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated) {
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushEnableState("unsupported");
      setPushStatusMessage("Push notifications are not supported on this device/browser.");
      return;
    }

    void navigator.serviceWorker
      .getRegistration("/")
      .then(async (registration) => {
        if (!registration) return;
        const existingSubscription = await registration.pushManager.getSubscription();
        if (existingSubscription) {
          setPushEnableState("enabled");
          setPushStatusMessage("Phone notifications are enabled.");
        }
      })
      .catch(() => {
        // No-op: setup check failure should not block CRM usage.
      });
  }, [authChecked, isAuthenticated]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(getStorageKey());
      if (stored) {
        const parsed = JSON.parse(stored) as { leads?: Lead[]; scripts?: ScriptLibrary };
        if (parsed.scripts) setScriptLibrary(parsed.scripts);
      }
    } catch {
      // Ignore localStorage read errors. Supabase remains the source of truth.
    }
  }, []);

  useEffect(() => {
    if (leads.length) {
      window.localStorage.setItem(getStorageKey(), JSON.stringify({ leads, scripts: scriptLibrary }));
    }
  }, [leads, scriptLibrary]);

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;
  const unreadNotificationCount = useMemo(() => inboundNotifications.filter((notification) => notification.unread).length, [inboundNotifications]);
  const activeToastNotifications = useMemo(
    () => toastNotificationIds
      .map((id) => inboundNotifications.find((notification) => notification.id === id))
      .filter((notification): notification is InboundLeadNotification => Boolean(notification)),
    [inboundNotifications, toastNotificationIds]
  );
  const isSupabaseLoading = authChecked && isAuthenticated && (supabaseReadState.status === "idle" || supabaseReadState.status === "loading");
  const hasSupabaseError = authChecked && isAuthenticated && supabaseReadState.status === "error";
  const hasNoSupabaseLeads = authChecked && isAuthenticated && supabaseReadState.status === "connected" && leads.length === 0;

  const markNotificationRead = (notificationId: string) => {
    setInboundNotifications((prev) =>
      prev.map((notification) =>
        notification.id === notificationId ? { ...notification, unread: false } : notification
      )
    );
  };

  const dismissToastNotification = (notificationId: string) => {
    setToastNotificationIds((prev) => prev.filter((id) => id !== notificationId));
  };

  const viewLeadFromNotification = async (notification: InboundLeadNotification) => {
    markNotificationRead(notification.id);
    dismissToastNotification(notification.id);
    setActiveView("Master CRM");
    setShowNotificationMenu(false);

    const leadExists = leads.some((lead) => lead.id === notification.leadId);
    if (leadExists) {
      setSelectedLeadId(notification.leadId);
      return;
    }

    await loadSupabaseLeads({ focusLeadId: notification.leadId });
  };

  const toggleNotificationMenu = () => {
    setShowNotificationMenu((prev) => {
      const next = !prev;
      if (next) {
        setInboundNotifications((current) =>
          current.map((notification) => (notification.unread ? { ...notification, unread: false } : notification))
        );
        setToastNotificationIds([]);
      }
      return next;
    });
  };

  const enablePhoneNotifications = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushEnableState("unsupported");
      setPushStatusMessage("Push notifications are not supported on this device/browser.");
      return;
    }

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      setPushEnableState("error");
      setPushStatusMessage("Missing VAPID public key in app configuration.");
      return;
    }

    setPushEnableState("enabling");
    setPushStatusMessage("Requesting permission and registering this device...");

    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setPushEnableState("denied");
        setPushStatusMessage("Notification permission was denied.");
        return;
      }

      const existingSubscription = await registration.pushManager.getSubscription();
      const subscription =
        existingSubscription ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
        }));

      const payload = subscription.toJSON();
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscription: {
            endpoint: payload.endpoint,
            keys: {
              p256dh: payload.keys?.p256dh,
              auth: payload.keys?.auth,
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Unable to save push subscription.");
      }

      setPushEnableState("enabled");
      setPushStatusMessage("Phone notifications are enabled.");
    } catch {
      setPushEnableState("error");
      setPushStatusMessage("Unable to enable phone notifications on this device.");
    }
  };

  useEffect(() => {
    setAiLeoPrompt("");
    setAiLeoResponse("");
    setAiLeoError(null);
    setIsAiLeoLoading(false);
  }, [selectedLeadId]);

  const formatDateOnly = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const nextFollowUpDate = (daysFromToday: number) => {
    const date = new Date();
    date.setDate(date.getDate() + daysFromToday);
    return formatDateOnly(date);
  };

  const isValidDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());

  const chooseFollowUpDate = () => {
    const choice = window.prompt("Follow-up schedule: 1) Tomorrow 2) 3 Days 3) 1 Week 4) Pick Date", "1");
    if (choice === null) return null;
    const normalized = choice.trim().toLowerCase();

    if (normalized === "1" || normalized === "tomorrow") return nextFollowUpDate(1);
    if (normalized === "2" || normalized === "3 days") return nextFollowUpDate(3);
    if (normalized === "3" || normalized === "1 week") return nextFollowUpDate(7);

    if (normalized === "4" || normalized === "pick date") {
      const picked = window.prompt("Enter follow-up date (YYYY-MM-DD)", nextFollowUpDate(1));
      if (!picked) return null;
      if (!isValidDateOnly(picked.trim())) {
        alert("Invalid date. Please use YYYY-MM-DD.");
        return null;
      }
      return picked.trim();
    }

    alert("Invalid option. Please choose 1, 2, 3, or 4.");
    return null;
  };

  const chooseAppointmentDate = () => {
    const picked = window.prompt("Enter appointment date (YYYY-MM-DD)", nextFollowUpDate(3));
    if (!picked) return null;
    const trimmedDate = picked.trim();
    if (!isValidDateOnly(trimmedDate)) {
      alert("Invalid date. Please use YYYY-MM-DD.");
      return null;
    }

    const pickedTime = window.prompt("Optional appointment time (HH:MM)", "");
    if (!pickedTime) return trimmedDate;
    const trimmedTime = pickedTime.trim();
    if (!trimmedTime) return trimmedDate;
    if (!/^\d{2}:\d{2}$/.test(trimmedTime)) {
      alert("Invalid time. Please use HH:MM.");
      return null;
    }

    return `${trimmedDate}T${trimmedTime}:00`;
  };

  const isQueueEligibleLead = (lead: Lead) => {
    if (lead.stage === "Closed" || lead.stage === "Lost / KIV") return false;
    if (!lead.nextFollowUp) return true;
    return isDueToday(lead.nextFollowUp) || isOverdue(lead.nextFollowUp);
  };

  const isOverdueLead = (lead: Lead) => Boolean(lead.nextFollowUp && isOverdue(lead.nextFollowUp));
  const isDueTodayLead = (lead: Lead) => Boolean(lead.nextFollowUp && isDueToday(lead.nextFollowUp));
  const isUnscheduledActiveLead = (lead: Lead) => lead.stage !== "Closed" && lead.stage !== "Lost / KIV" && !lead.nextFollowUp;

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

  const overdueQueueLeads = useMemo(() => [...leads].filter(isOverdueLead).sort(compareLeadPriority), [leads]);
  const dueTodayQueueLeads = useMemo(() => [...leads].filter(isDueTodayLead).sort(compareLeadPriority), [leads]);
  const unscheduledBacklogLeads = useMemo(() => [...leads].filter(isUnscheduledActiveLead).sort(compareLeadPriority), [leads]);
  const queueLeads = useMemo(
    () => [...overdueQueueLeads, ...dueTodayQueueLeads, ...unscheduledBacklogLeads],
    [overdueQueueLeads, dueTodayQueueLeads, unscheduledBacklogLeads]
  );
  const sortedPriorityLeads = useMemo(() => queueLeads.slice(0, 5), [queueLeads]);
  const todayCalls = useMemo(() => queueLeads.slice(0, 6), [queueLeads]);
  const weeklyMetrics = useMemo(() => getWeeklyActivityMetrics(leads), [leads]);
  const currentQueueLead = useMemo(() => queueLeads.find((lead) => lead.id === currentQueueLeadId) ?? todayCalls[0] ?? null, [currentQueueLeadId, queueLeads, todayCalls]);

  useEffect(() => {
    if (queueLeads.length === 0) {
      setCurrentQueueLeadId(null);
      return;
    }

    const currentLeadStillEligible = currentQueueLeadId ? queueLeads.some((lead) => lead.id === currentQueueLeadId) : false;
    if (!currentLeadStillEligible) {
      setCurrentQueueLeadId(queueLeads[0]?.id ?? null);
    }
  }, [currentQueueLeadId, queueLeads]);

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
  };

  const updateLead = (leadId: string, updates: Partial<Lead>) => {
    setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, ...updates } : lead)));
  };

  const sortActivitiesNewestFirst = (activities: ActivityEntry[]) => {
    return [...activities].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  };

  const buildAiLeoLeadContext = (lead: Lead) => {
    const timeline = [...lead.activity]
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      .map((entry) => `${formatDate(entry.createdAt)} | ${entry.title} | ${entry.details}`);

    return {
      name: lead.name,
      grade: lead.grade,
      stage: lead.stage,
      source: lead.source,
      campaign: lead.campaign,
      remarks: lead.remarks,
      nextFollowUp: lead.nextFollowUp,
      nextAction: lead.nextAction,
      appointmentDate: lead.appointmentDate,
      focusSummary: lead.focusSummary ?? "",
      timeline,
    };
  };

  const askAiLeo = async (prompt: string) => {
    if (!selectedLead) return;

    setIsAiLeoLoading(true);
    setAiLeoError(null);

    try {
      const response = await fetch("/api/ai-leo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          leadContext: buildAiLeoLeadContext(selectedLead),
        }),
      });

      const payload = (await response.json().catch(() => null)) as { response?: string; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "AI Leo could not complete this request.");
      }

      setAiLeoResponse(payload?.response || "AI Leo returned an empty response.");
    } catch (error) {
      setAiLeoResponse("");
      setAiLeoError(
        error instanceof Error
          ? error.message
          : "AI Leo could not complete this request.",
      );
    } finally {
      setIsAiLeoLoading(false);
    }
  };

  const submitAiLeoPrompt = async () => {
    const prompt = aiLeoPrompt.trim();
    if (!prompt) return;
    await askAiLeo(prompt);
  };

  const addNoteToLead = async (lead: Lead, details: string) => {
    const note = details.trim();
    if (!note) return;
    try {
      await persistLeadMutation(lead.id, {}, { type: "note", title: "Note added", details: note });
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Unable to save this note to Supabase."
      );
      throw error;
    }
  };

  const scheduleFollowUpForLead = async (lead: Lead, selectedDate: string) => {
    try {
      await persistLeadMutation(
        lead.id,
        { stage: "Follow-Up", nextFollowUp: selectedDate, nextAction: `Follow up on ${selectedDate}` },
        { type: "follow-up", title: "Follow-up scheduled", details: `Next follow-up set for ${selectedDate}` }
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Unable to schedule this follow-up in Supabase."
      );
      throw error;
    }
  };

  const changeLeadGrade = async (lead: Lead, grade: LeadGrade) => {
    if (lead.grade === grade) return;
    try {
      await persistLeadMutation(
        lead.id,
        { grade },
        { type: "status", title: "Grade changed", details: `Grade changed from ${lead.grade} to ${grade}` }
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Unable to persist this grade change to Supabase."
      );
      throw error;
    }
  };

  const markLeadAppointment = async (lead: Lead, appointmentDate: string, note?: string) => {
    try {
      const client = createClient();
      const persistedLead = await persistLeadMutation(
        lead.id,
        { stage: "Appointment Set", appointmentDate, nextFollowUp: appointmentDate, nextAction: "Prepare appointment summary" },
        { type: "appointment", title: "Appointment set", details: note?.trim() ? `Appointment set for ${appointmentDate}. ${note.trim()}` : `Appointment set for ${appointmentDate}` }
      );
      await createSupabaseAppointment(client, persistedLead.id, appointmentDate, note?.trim() ?? "");
      return { ...persistedLead, appointmentDate };
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Unable to persist this appointment to Supabase."
      );
      throw error;
    }
  };

  const persistLeadMutation = async (
    leadId: string,
    updates: Partial<Lead>,
    activity?: {
      type: ActivityEntry["type"];
      title: string;
      details: string;
      outcome?: LeadOutcome;
    }
  ) => {
    const currentLead = leads.find((lead) => lead.id === leadId);
    if (!currentLead) {
      throw new Error("Lead could not be found for this action.");
    }

    if (!isValidSupabaseUuid(currentLead.id)) {
      throw new Error("This lead is not yet persisted to Supabase. Save the lead first, then retry this action.");
    }

    const now = new Date().toISOString();
    const mergedLead: Lead = {
      ...currentLead,
      ...updates,
    };

    if (activity) {
      mergedLead.lastContact = now;
      mergedLead.lastOutcome = activity.outcome ?? mergedLead.lastOutcome;
      mergedLead.lastOutcomeNotes = activity.details;
      mergedLead.queueReason = getLeadQueueReason({
        ...mergedLead,
        lastOutcome: mergedLead.lastOutcome,
        lastOutcomeNotes: mergedLead.lastOutcomeNotes,
      });
      mergedLead.focusSummary = `${activity.title}: ${activity.details}`;
    } else {
      mergedLead.queueReason = getLeadQueueReason({
        ...mergedLead,
        lastOutcome: mergedLead.lastOutcome,
        lastOutcomeNotes: mergedLead.lastOutcomeNotes,
      });
      mergedLead.focusSummary = mergedLead.focusSummary || mergedLead.remarks || "Ready for the next action";
    }

    const client = createClient();
    const savedLead = await updateSupabaseLead(client, mergedLead);

    let activityToAppend: ActivityEntry | null = null;
    if (activity) {
      const activityDraft: ActivityEntry = {
        id: `activity-${Date.now()}`,
        type: activity.type,
        title: activity.title,
        details: activity.details,
        createdAt: now,
        outcome: activity.outcome,
      };
      activityToAppend = await createSupabaseActivity(client, savedLead.id, activityDraft);
    }

      const persistedLead: Lead = {
      ...savedLead,
      lastContact: mergedLead.lastContact,
      lastOutcome: mergedLead.lastOutcome,
      lastOutcomeNotes: mergedLead.lastOutcomeNotes,
      queueReason: mergedLead.queueReason,
      focusSummary: mergedLead.focusSummary,
        activity: activityToAppend ? sortActivitiesNewestFirst([...currentLead.activity, activityToAppend]) : sortActivitiesNewestFirst(currentLead.activity),
    };

    setLeads((prev) => prev.map((lead) => (lead.id === leadId ? persistedLead : lead)));
    return persistedLead;
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

  const saveDraft = async () => {
    const normalized = { ...draft, phone: draft.phone.trim() };
    const duplicate = hasDuplicateLead(leads, { ...normalized, id: normalized.id || `lead-${Date.now()}` } as Lead);
    if (duplicate) {
      setValidationMessage("This number already exists in your CRM. Please review or merge the duplicate before saving.");
      return;
    }

    const id = normalized.id || `lead-${Date.now()}`;
    const isPersistedLead = isValidSupabaseUuid(normalized.id);
    const toSave: Lead = {
      ...normalized,
      id,
      queueReason: getLeadQueueReason({ ...normalized, id, lastOutcome: undefined, lastOutcomeNotes: undefined, queueReason: undefined } as Lead),
      focusSummary: normalized.remarks || "Ready for the next action",
      activity: normalized.activity.length ? normalized.activity : [{ id: `activity-${Date.now()}`, type: "status", title: "Lead created", details: "New lead added to CRM", createdAt: new Date().toISOString() }],
    };

    let persistedId = id;
    try {
      const client = createClient();
      const previousLead = leads.find((lead) => lead.id === normalized.id) ?? null;

      if (isPersistedLead) {
        const savedLead = await updateSupabaseLead(client, toSave);
        const activitiesToCreate: ActivityEntry[] = [];

        if (previousLead && previousLead.stage !== toSave.stage) {
          activitiesToCreate.push({
            id: `activity-${Date.now()}-stage`,
            type: "status",
            title: "Stage changed",
            details: `Stage updated to ${toSave.stage}`,
            createdAt: new Date().toISOString(),
          });
        }

        if (previousLead && previousLead.grade !== toSave.grade) {
          activitiesToCreate.push({
            id: `activity-${Date.now()}-grade`,
            type: "status",
            title: "Grade changed",
            details: `Grade updated to ${toSave.grade}`,
            createdAt: new Date().toISOString(),
          });
        }

        if (previousLead && previousLead.nextFollowUp !== toSave.nextFollowUp && toSave.nextFollowUp) {
          activitiesToCreate.push({
            id: `activity-${Date.now()}-followup`,
            type: "follow-up",
            title: "Follow-up scheduled",
            details: `Next follow-up set for ${toSave.nextFollowUp}`,
            createdAt: new Date().toISOString(),
          });
        }

        if (previousLead && previousLead.remarks !== toSave.remarks && toSave.remarks) {
          activitiesToCreate.push({
            id: `activity-${Date.now()}-note`,
            type: "note",
            title: "Note updated",
            details: toSave.remarks,
            createdAt: new Date().toISOString(),
          });
        }

        const persistedActivities: ActivityEntry[] = [];
        for (const activity of activitiesToCreate) {
          const persistedActivity = await createSupabaseActivity(client, savedLead.id, activity);
          persistedActivities.push(persistedActivity);
        }

          if (toSave.appointmentDate && previousLead?.appointmentDate !== toSave.appointmentDate) {
            await createSupabaseAppointment(client, savedLead.id, toSave.appointmentDate, toSave.remarks || "");
          }

        persistedId = savedLead.id;
        setLeads((prev) =>
            prev.map((lead) => (lead.id === normalized.id ? {
              ...savedLead,
                activity: sortActivitiesNewestFirst([...lead.activity, ...persistedActivities]),
            } : lead))
        );
      } else {
        const savedLead = await createSupabaseLead(client, toSave);
        const createdActivity: ActivityEntry = {
          id: `activity-${Date.now()}-created`,
          type: "status",
          title: "Lead created",
          details: "New lead added to CRM",
          createdAt: new Date().toISOString(),
        };
        const persistedCreatedActivity = await createSupabaseActivity(client, savedLead.id, createdActivity);
          if (toSave.appointmentDate) {
            await createSupabaseAppointment(client, savedLead.id, toSave.appointmentDate, toSave.remarks || "");
          }
        persistedId = savedLead.id;
          setLeads((prev) => [{ ...savedLead, activity: sortActivitiesNewestFirst([persistedCreatedActivity]) }, ...prev]);
      }
    } catch (error) {
      console.error("Failed to save lead to Supabase:", error);
      setValidationMessage(
        error instanceof Error ? error.message : "Failed to save lead. Please try again."
      );
      return;
    }

    setValidationMessage("");
    setSelectedLeadId(persistedId);
    setShowModal(false);
    setDraft(emptyLead);
  };

  const deleteLead = async (leadId: string) => {
    try {
      const client = createClient();
      await deleteSupabaseLead(client, leadId);

      setLeads((prev) => prev.filter((lead) => lead.id !== leadId));

      if (selectedLeadId === leadId) {
        const remaining = leads.filter((lead) => lead.id !== leadId);
        setSelectedLeadId(remaining[0]?.id ?? null);
      }
    } catch (error) {
      console.error("Failed to delete lead from Supabase:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to delete lead. Please try again."
      );
    }
  };

  const deleteTimelineActivity = async (leadId: string, activityId: string) => {
    if (!window.confirm("Delete this timeline activity? This cannot be undone.")) return;

    setTimelineError(null);

    try {
      const client = createClient();
      await deleteSupabaseActivity(client, activityId);

      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId
            ? { ...lead, activity: lead.activity.filter((entry) => entry.id !== activityId) }
            : lead
        )
      );
    } catch (error) {
      setTimelineError(
        error instanceof Error
          ? error.message
          : "Unable to delete this timeline activity from Supabase."
      );
    }
  };

  const updateSelectedLead = async (
    updates: Partial<Lead>,
    activity?: {
      type: ActivityEntry["type"];
      title: string;
      details: string;
      outcome?: LeadOutcome;
    }
  ) => {
    if (!selectedLead) return;
    try {
      await persistLeadMutation(selectedLead.id, updates, activity);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Unable to persist the lead update to Supabase."
      );
    }
  };

  const handleLeadAction = async (leadId: string, action: string) => {
    const lead = leads.find((item) => item.id === leadId);
    if (!lead) return;

    const nextQueueLeadId = todayCalls.find((item) => item.id !== leadId)?.id ?? null;

    try {
      let shouldAdvanceQueue = false;
      let persistedLead: Lead | null = null;

      if (action === "CALL") {
        persistedLead = await persistLeadMutation(
          leadId,
          {},
          { type: "call", title: "Call attempted", details: `Attempted call to ${lead.name}` }
        );
        const callUrl = buildCallLink(lead.phone);
        if (callUrl) {
          window.location.href = callUrl;
        }
      } else if (action === "WHATSAPP") {
        persistedLead = await persistLeadMutation(
          leadId,
          {},
          { type: "whatsapp", title: "WhatsApp initiated", details: `Opened WhatsApp for ${lead.name}` }
        );
        const whatsAppUrl = buildWhatsAppLink(lead.phone);
        if (whatsAppUrl) {
          window.open(whatsAppUrl, "_blank", "noopener,noreferrer");
        }
      } else if (action === "CONNECTED") {
        persistedLead = await persistLeadMutation(
          leadId,
          { stage: "Connected", nextAction: "Capture notes and set next follow-up" },
          { type: "status", title: "Connected", details: `Connected with ${lead.name}`, outcome: "connected" }
        );
      } else if (action === "NO ANSWER") {
        persistedLead = await persistLeadMutation(
          leadId,
          { stage: "Attempting Contact", nextFollowUp: nextFollowUpDate(1), nextAction: "Retry contact tomorrow" },
          { type: "follow-up", title: "Attempted Contact / No Answer", details: `No answer from ${lead.name}`, outcome: "no-answer" }
        );
      } else if (action === "FOLLOW UP") {
        const selectedDate = chooseFollowUpDate();
        if (!selectedDate) return;

        const followUpDetails = `Scheduled follow-up for ${selectedDate}`;
        persistedLead = await persistLeadMutation(
          leadId,
          { stage: "Follow-Up", nextFollowUp: selectedDate, nextAction: "Follow up as scheduled" },
          { type: "follow-up", title: "Follow-up scheduled", details: followUpDetails, outcome: "follow-up" }
        );
      } else if (action === "APPOINTMENT SET") {
        const appointmentDate = chooseAppointmentDate();
        if (!appointmentDate) return;

        persistedLead = await markLeadAppointment(lead, appointmentDate);
      } else if (action === "NOT INTERESTED") {
        persistedLead = await persistLeadMutation(
          leadId,
          { stage: "Lost / KIV", nextFollowUp: "", nextAction: "Not interested" },
          { type: "status", title: "Not interested", details: `${lead.name} is not interested`, outcome: "kiv" }
        );
      } else if (action === "INVALID NUMBER") {
        persistedLead = await persistLeadMutation(
          leadId,
          { stage: "Lost / KIV", nextFollowUp: "", nextAction: "No further action required" },
          { type: "status", title: "Invalid number", details: `Marked ${lead.name} as invalid number`, outcome: "invalid-number" }
        );
      }

      if (persistedLead) {
        shouldAdvanceQueue = !isQueueEligibleLead(persistedLead);
      }

      if (shouldAdvanceQueue && currentQueueLeadId === leadId) {
        setCurrentQueueLeadId(nextQueueLeadId);
      }
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Unable to persist this action to Supabase."
      );
    }
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
                  Supabase is the source of truth for authenticated sessions.
              </div>
              <div className="relative">
                <button
                  onClick={toggleNotificationMenu}
                  className="relative rounded-2xl border border-[#e7e0d0] px-4 py-3 text-sm font-semibold text-[#171717]"
                >
                  Notifications
                  {unreadNotificationCount > 0 ? (
                    <span className="ml-2 rounded-full bg-[#171717] px-2 py-0.5 text-xs text-white">{unreadNotificationCount}</span>
                  ) : null}
                </button>
                {showNotificationMenu ? (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-[320px] rounded-2xl border border-[#e7e0d0] bg-white p-3 shadow-lg">
                    <p className="px-2 pb-2 text-xs uppercase tracking-[0.2em] text-[#5f5a52]">Inbound leads this session</p>
                    <div className="max-h-80 space-y-2 overflow-y-auto">
                      {inboundNotifications.length === 0 ? (
                        <p className="rounded-xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2 text-sm text-[#5f5a52]">No inbound lead notifications yet.</p>
                      ) : (
                        inboundNotifications.map((notification) => (
                          <div key={notification.id} className="rounded-xl border border-[#e7e0d0] bg-[#fcfaef] p-3">
                            <p className="text-sm font-semibold text-[#171717]">New inbound lead</p>
                            <p className="mt-1 text-sm text-[#5f5a52]">{notification.name} · {notification.source}</p>
                            <div className="mt-2 flex items-center justify-between">
                              <p className="text-xs text-[#8a847b]">{formatDate(notification.createdAt)}</p>
                              <button
                                onClick={() => { void viewLeadFromNotification(notification); }}
                                className="rounded-full border border-[#e7e0d0] bg-white px-3 py-1 text-xs font-semibold"
                              >
                                View Lead
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
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

          {activeToastNotifications.length ? (
            <div className="fixed bottom-5 right-5 z-30 flex w-[320px] flex-col gap-3">
              {activeToastNotifications.map((notification) => (
                <section key={notification.id} className="rounded-2xl border border-[#e7e0d0] bg-white p-4 shadow-xl">
                  <p className="text-sm font-semibold text-[#171717]">New inbound lead</p>
                  <p className="mt-1 text-sm text-[#5f5a52]">{notification.name} · {notification.source}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => { void viewLeadFromNotification(notification); }}
                      className="rounded-full bg-[#171717] px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      View Lead
                    </button>
                    <button
                      onClick={() => dismissToastNotification(notification.id)}
                      className="rounded-full border border-[#e7e0d0] px-3 py-1.5 text-xs font-semibold text-[#171717]"
                    >
                      Dismiss
                    </button>
                  </div>
                </section>
              ))}
            </div>
          ) : null}

            {activeView !== "Settings" && isSupabaseLoading ? (
              <section className="mb-6 rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Loading Leads</p>
                <p className="mt-2 text-sm text-[#5f5a52]">Loading leads from Supabase...</p>
              </section>
            ) : null}

            {activeView !== "Settings" && hasSupabaseError ? (
              <section className="mb-6 rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Supabase Read Error</p>
                <p className="mt-2 text-sm text-[#5f5a52]">{supabaseReadState.error ?? "Unable to load leads from Supabase."}</p>
                {supabaseReadState.errorCode ? <p className="mt-2 text-sm text-[#5f5a52]">Error code: {supabaseReadState.errorCode}</p> : null}
                {supabaseReadState.errorMessage ? <p className="mt-2 text-sm text-[#5f5a52]">Error message: {supabaseReadState.errorMessage}</p> : null}
              </section>
            ) : null}

            {activeView !== "Settings" && hasNoSupabaseLeads ? (
              <section className="mb-6 rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">No Leads Found</p>
                <p className="mt-2 text-sm text-[#5f5a52]">No leads were returned from Supabase for this authenticated session.</p>
              </section>
            ) : null}

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
                            <button onClick={() => { void handleLeadAction(lead.id, "CALL"); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Call</button>
                            <button onClick={() => { void handleLeadAction(lead.id, "WHATSAPP"); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">WhatsApp</button>
                            <button onClick={() => { void handleLeadAction(lead.id, "NO ANSWER"); }} className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white">No Answer</button>
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
                      {overdueQueueLeads.length} overdue · {dueTodayQueueLeads.length} due today · {unscheduledBacklogLeads.length} unscheduled
                      <div className="mt-1 text-xs">Showing next {todayCalls.length} to work</div>
                    </div>
                </div>

                {currentQueueLead ? (
                  <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.8fr]">
                    <div className="rounded-[24px] border border-[#e7e0d0] bg-[#fcfaef] p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold">{currentQueueLead.name}</p>
                          <p className="mt-1 text-sm text-[#5f5a52]">{currentQueueLead.phone} · {currentQueueLead.source}</p>
                        </div>
                        <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${gradeAccent[currentQueueLead.grade]}`}>{gradeLabels[currentQueueLead.grade]}</div>
                      </div>

                      <div className="mt-4 space-y-3 text-sm text-[#5f5a52]">
                        <p><span className="font-semibold text-[#171717]">Why this lead is next:</span> {currentQueueLead.queueReason ?? getLeadQueueReason(currentQueueLead)}</p>
                        <p><span className="font-semibold text-[#171717]">Suggested objective:</span> {getSuggestedObjective(currentQueueLead)}</p>
                        <p><span className="font-semibold text-[#171717]">Context:</span> {currentQueueLead.remarks || "No context captured yet."}</p>
                        <p><span className="font-semibold text-[#171717]">Next action:</span> {currentQueueLead.nextAction || "No next action captured."}</p>
                      </div>

                      <div className="mt-5 space-y-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5f5a52]">Quick Actions</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button onClick={() => { void addNoteToLead(currentQueueLead, queueNoteInput).then(() => setQueueNoteInput("")); }} className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white">Add Note</button>
                            <button onClick={() => { const selectedDate = chooseFollowUpDate(); if (!selectedDate) return; void scheduleFollowUpForLead(currentQueueLead, selectedDate); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Follow Up</button>
                            <button onClick={() => { const appointmentDate = chooseAppointmentDate(); if (!appointmentDate) return; const appointmentNote = window.prompt("Optional appointment note", "") ?? ""; void markLeadAppointment(currentQueueLead, appointmentDate, appointmentNote); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Appointment</button>
                          </div>
                          <textarea value={queueNoteInput} onChange={(event) => setQueueNoteInput(event.target.value)} className="mt-3 min-h-[96px] w-full rounded-2xl border border-[#e7e0d0] bg-white px-3 py-2 text-sm" placeholder="Add conversation notes or context" />
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(["A", "B", "C", "D"] as LeadGrade[]).map((grade) => (
                              <button key={grade} onClick={() => { void changeLeadGrade(currentQueueLead, grade); }} className={`rounded-full border px-3 py-2 text-sm ${currentQueueLead.grade === grade ? gradeAccent[grade] : "border-[#e7e0d0] bg-white"}`}>{grade}</button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5f5a52]">Contact</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "CALL"); }} className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white">Call</button>
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "WHATSAPP"); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">WhatsApp</button>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5f5a52]">Outcome</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "CONNECTED"); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Connected</button>
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "NO ANSWER"); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">No Answer</button>
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "NOT INTERESTED"); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Not Interested</button>
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "INVALID NUMBER"); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Invalid Number</button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-[24px] border border-[#e7e0d0] bg-white p-4">
                        <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Timeline preview</p>
                        <div className="mt-3 space-y-2">
                          {sortActivitiesNewestFirst(currentQueueLead.activity).slice(0, 5).map((entry) => (
                            <div key={entry.id} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-3 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-semibold">{entry.title}</p>
                                <p className="text-xs text-[#5f5a52]">{formatDate(entry.createdAt)}</p>
                              </div>
                              <p className="mt-1 text-[#5f5a52]">{entry.details}</p>
                            </div>
                          ))}
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
                          <button onClick={() => openLead(lead)} className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white">View Lead Detail</button>
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
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Phone notifications</p>
                <h3 className="mt-2 text-xl font-semibold">Enable push alerts for new inbound leads</h3>
                <p className="mt-4 text-sm text-[#5f5a52]">Enable this once on your installed phone app to receive background notifications for any new lead source.</p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => { void enablePhoneNotifications(); }}
                    disabled={pushEnableState === "enabling"}
                    className="rounded-2xl bg-[#171717] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pushEnableState === "enabling" ? "Enabling..." : "Enable phone notifications"}
                  </button>
                  <p className="text-sm text-[#5f5a52]">Status: {pushEnableState}</p>
                </div>
                <p className="mt-3 text-sm text-[#5f5a52]">{pushStatusMessage}</p>
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
                  <div className="rounded-2xl border border-[#e7e0d0] bg-white p-4">
                    <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Quick Actions</p>
                    <textarea value={detailNoteInput} onChange={(event) => setDetailNoteInput(event.target.value)} className="mt-3 min-h-[96px] w-full rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2 text-sm" placeholder="Add note or conversation memory" />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => { void addNoteToLead(selectedLead, detailNoteInput).then(() => setDetailNoteInput("")); }} className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white">Add Note</button>
                      <button onClick={() => {
                        const selectedDate = chooseFollowUpDate();
                        if (!selectedDate) return;
                        void scheduleFollowUpForLead(selectedLead, selectedDate);
                      }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Schedule Follow-Up</button>
                      <button onClick={() => {
                        const appointmentDate = chooseAppointmentDate();
                        if (!appointmentDate) return;
                        const appointmentNote = window.prompt("Optional appointment note", "") ?? "";
                        void markLeadAppointment(selectedLead, appointmentDate, appointmentNote);
                      }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Mark Appointment</button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(["A", "B", "C", "D"] as LeadGrade[]).map((grade) => (
                        <button key={grade} onClick={() => { void changeLeadGrade(selectedLead, grade); }} className={`rounded-full border px-3 py-2 text-sm ${selectedLead.grade === grade ? gradeAccent[grade] : "border-[#e7e0d0] bg-white"}`}>{grade}</button>
                      ))}
                    </div>
                  </div>
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
                    {timelineError ? <p className="mt-2 text-sm text-[#b08c2c]">{timelineError}</p> : null}
                    <div className="mt-3 space-y-2">
                      {sortActivitiesNewestFirst(selectedLead.activity).map((entry) => (
                        <div key={entry.id} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <p className="font-semibold">{entry.title}</p>
                            <div className="flex items-center gap-3">
                              <p className="text-xs text-[#5f5a52]">{formatDate(entry.createdAt)}</p>
                              <button
                                onClick={() => {
                                  void deleteTimelineActivity(selectedLead.id, entry.id);
                                }}
                                className="text-xs font-semibold text-[#5f5a52] underline"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <p className="mt-1 text-[#5f5a52]">{entry.details}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#e7e0d0] bg-white p-4">
                    <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Actions</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => { void handleLeadAction(selectedLead.id, "CALL"); }} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Call</button>
                      <button onClick={() => { void handleLeadAction(selectedLead.id, "WHATSAPP"); }} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">WhatsApp</button>
                      <button onClick={() => { void handleLeadAction(selectedLead.id, "CONNECTED"); }} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Connected</button>
                      <button onClick={() => { void handleLeadAction(selectedLead.id, "NO ANSWER"); }} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">No Answer</button>
                      <button onClick={() => { void handleLeadAction(selectedLead.id, "NOT INTERESTED"); }} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Not Interested</button>
                      <button onClick={() => { void handleLeadAction(selectedLead.id, "INVALID NUMBER"); }} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Invalid Number</button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#e7e0d0] bg-white p-4">
                    <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">AI Leo</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => { void askAiLeo("Read the full history of this lead as a sequence of behaviour, not just CRM entries.\n\nTell me what you think is actually happening.\n\nSeparate what we know from what you are interpreting where necessary.\n\nIdentify the single biggest thing stopping this lead from progressing OR the most important thing we still don't know.\n\nThen tell me the ONE best next move and why.\n\nBe willing to tell me not to follow up, not to send another project, or to wait if that is the smarter move."); }} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">What should I do next?</button>
                      <button onClick={() => { void askAiLeo("Read the full lead history first.\n\nBefore writing anything, determine what this WhatsApp actually needs to accomplish.\n\nThen draft ONE natural WhatsApp message I could realistically send now.\n\nKeep one main conversational objective.\n\nDo not try to qualify everything in one message.\n\nDo not use generic agent follow-up language.\n\nDo not say 'just checking in', 'touching base', 'feel free', 'whenever convenient', or 'no rush'.\n\nUse previous conversation context where possible.\n\nIf sending a WhatsApp now is not the right move, do not blindly write one. Tell me what I should do instead and why."); }} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Draft WhatsApp</button>
                      <button onClick={() => { void askAiLeo("I may be calling this lead now.\n\nRead the full CRM history first.\n\nGive me a practical 30-second pre-call brief.\n\nStart with:\n\nMY READ:\nWhat you think is actually happening based on behaviour and history.\n\nMY OBJECTIVE:\nThe ONE thing I should accomplish or understand from this call.\n\nThen frame my opening using:\n\nCONTEXT → PROBLEM → SOLUTION → HOOK\n\nCONTEXT:\nWhy I am calling and the relevant previous interaction.\n\nPROBLEM:\nWhat genuine problem, uncertainty, risk, or decision difficulty may be relevant enough for this person to care about the conversation.\n\nDo not invent a personal problem if the CRM does not support it.\n\nSOLUTION:\nThe useful perspective or approach I can offer. Position me around clarity and better decision-making, not simply selling or recommending projects.\n\nHOOK:\nOne natural question or curiosity hook that gets the prospect talking.\n\nKeep the PSH opening conversational and short. It should not become a sales monologue.\n\nThen give me:\n\nDISCOVERY:\nThe 2-3 most important things I should uncover.\n\nLISTEN FOR:\nSignals, phrases, motivations, objections, or changes in circumstances that would alter my next move.\n\nAVOID:\nThe ONE biggest mistake I should avoid.\n\nFinish with:\n\nHOW I'D OPEN:\n\nGive me ONE natural example of how the first 20-30 seconds could actually sound in Leo's conversational style.\n\nIt should sound spoken, not written.\n\nDo not use generic phrases like:\n- I'm reaching out\n- touching base\n- checking in\n- just wanted to follow up\n- I wanted to see if you're still interested\n\nThe opening should create relevance before asking for commitment."); }} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Prepare My Call</button>
                    </div>
                    <div className="mt-3 flex flex-col gap-3">
                      <textarea
                        value={aiLeoPrompt}
                        onChange={(event) => setAiLeoPrompt(event.target.value)}
                        placeholder="Ask AI Leo about this lead..."
                        className="min-h-[96px] w-full rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2 text-sm"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-[#5f5a52]">AI Leo uses only this lead&apos;s CRM context and timeline.</p>
                        <button
                          onClick={() => {
                            void submitAiLeoPrompt();
                          }}
                          disabled={isAiLeoLoading || !aiLeoPrompt.trim()}
                          className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isAiLeoLoading ? "Thinking..." : "Ask AI Leo"}
                        </button>
                      </div>
                    </div>
                    {aiLeoError ? <p className="mt-3 text-sm text-[#b08c2c]">{aiLeoError}</p> : null}
                    {aiLeoResponse ? <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-3 text-sm text-[#171717]">{aiLeoResponse}</div> : null}
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
