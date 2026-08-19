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
  legacyStages,
  scriptDefaults,
  type Lead,
  type LeadClientSide,
  type LeadGrade,
  type LeadGroup,
  type LeadOutcome,
  type LeadSource,
  type LeadStage,
  type ScriptLibrary,
  v15Stages,
} from "@/lib/crm";
import {
  createSupabaseActivity,
  createSupabaseAppointment,
  createSupabaseLeadGroup,
  deleteSupabaseActivity,
  createSupabaseLead,
  deleteSupabaseLeadGroup,
  deleteSupabaseLead,
  fetchSupabaseCrmSnapshot,
  inspectSupabaseLeadRead,
  isValidSupabaseUuid,
  setSupabaseLeadGroupAssignments,
  updateSupabaseLeadGroup,
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

type ConnectedNextStepDraft = {
  leadId: string;
  stage: LeadStage;
  nextFollowUp: string;
  note: string;
  clientSide: LeadClientSide | "";
  queueMode: boolean;
};

type AppointmentDraft = {
  leadId: string;
  date: string;
  time: string;
  note: string;
  queueMode: boolean;
};

type CalendarAppointmentCta = {
  leadId: string;
  leadName: string;
  phone: string;
  source: string;
  appointmentDate: string;
  note: string;
  location: string;
};

type PushEnableState = "idle" | "enabling" | "enabled" | "denied" | "unsupported" | "error";

type GroupManagerDraft = {
  name: string;
  color: string;
  isActive: boolean;
};

const DEFAULT_GROUP_COLOR = "#f1e6cc";

function sortLeadGroups(groups: LeadGroup[]) {
  return groups.slice().sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeGroupName(value: string) {
  return value.trim().toLowerCase();
}

function getLeadGroupChipStyle(color?: string | null) {
  const backgroundColor = color?.trim() || DEFAULT_GROUP_COLOR;
  return {
    backgroundColor,
    borderColor: backgroundColor,
    color: "#5f5a52",
  };
}

function renderLeadGroupSummary(groups: LeadGroup[], options?: { limit?: number; emptyLabel?: string }) {
  const limit = options?.limit ?? 2;
  const emptyLabel = options?.emptyLabel ?? "No groups";

  if (!groups.length) {
    return <span className="text-xs text-[#8a8478]">{emptyLabel}</span>;
  }

  const visibleGroups = groups.slice(0, limit);
  const hiddenCount = Math.max(0, groups.length - visibleGroups.length);

  return (
    <div className="flex flex-wrap items-center gap-2" title={groups.map((group) => group.name).join(", ")}>
      {visibleGroups.map((group) => (
        <span key={group.id} className="rounded-full border px-2 py-1 text-xs font-medium" style={getLeadGroupChipStyle(group.color)}>
          {group.name}
        </span>
      ))}
      {hiddenCount > 0 ? <span className="text-xs font-semibold text-[#5f5a52]">+{hiddenCount}</span> : null}
    </div>
  );
}

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
  const leadDetailRef = useRef<HTMLElement | null>(null);
  const [activeView, setActiveView] = useState<View>("Dashboard");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [groups, setGroups] = useState<LeadGroup[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState<LeadGrade | "All">("All");
  const [stageFilter, setStageFilter] = useState<LeadStage | "All">("All");
  const [sourceFilter, setSourceFilter] = useState<LeadSource | "All">("All");
  const [groupFilterIds, setGroupFilterIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Lead>(emptyLead);
  const [showModal, setShowModal] = useState(false);
  const [showDetailGroupPicker, setShowDetailGroupPicker] = useState(false);
  const [showDraftGroupPicker, setShowDraftGroupPicker] = useState(false);
  const [showGroupFilterMenu, setShowGroupFilterMenu] = useState(false);
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [detailGroupSearch, setDetailGroupSearch] = useState("");
  const [draftGroupSearch, setDraftGroupSearch] = useState("");
  const [groupFilterSearch, setGroupFilterSearch] = useState("");
  const [groupManagerDrafts, setGroupManagerDrafts] = useState<Record<string, GroupManagerDraft>>({});
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState(DEFAULT_GROUP_COLOR);
  const [groupUiError, setGroupUiError] = useState<string | null>(null);
  const [scriptLibrary, setScriptLibrary] = useState<ScriptLibrary>(scriptDefaults);
  const [currentQueueLeadId, setCurrentQueueLeadId] = useState<string | null>(null);
  const [queueNoteInput, setQueueNoteInput] = useState("");
  const [detailNoteInput, setDetailNoteInput] = useState("");
  const [remarksDraft, setRemarksDraft] = useState("");
  const [isEditingRemarks, setIsEditingRemarks] = useState(false);
  const [isSavingRemarks, setIsSavingRemarks] = useState(false);
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
  const [showConnectedNextStepModal, setShowConnectedNextStepModal] = useState(false);
  const [connectedNextStepDraft, setConnectedNextStepDraft] = useState<ConnectedNextStepDraft | null>(null);
  const [isMasterLeadDrawerOpen, setIsMasterLeadDrawerOpen] = useState(false);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [appointmentDraft, setAppointmentDraft] = useState<AppointmentDraft | null>(null);
  const [calendarAppointmentCta, setCalendarAppointmentCta] = useState<CalendarAppointmentCta | null>(null);
  const [completedQueueLeadIds, setCompletedQueueLeadIds] = useState<string[]>([]);
  const [isQueueAiLoading, setIsQueueAiLoading] = useState(false);
  const [queueAiError, setQueueAiError] = useState<string | null>(null);
  const [queueAiQuestion, setQueueAiQuestion] = useState("");
  const [queueAiResponse, setQueueAiResponse] = useState("");
  const [queueAiMessageDraft, setQueueAiMessageDraft] = useState("");
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

  const stageOptionsForSelection = useMemo(() => v15Stages, []);
  const stageOptionsForFilterAndPipeline = useMemo(() => [...v15Stages, ...legacyStages], []);
  const activeClientSides = useMemo(() => ["Buyer", "Seller", "Buyer + Seller"] as const, []);

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

      const crmSnapshot = await fetchSupabaseCrmSnapshot(supabaseClient);
      const leadsFromSupabase = crmSnapshot.leads;
      // Use successfully fetched Supabase leads as the Master CRM dataset.
      setLeads(leadsFromSupabase);
      setGroups(crmSnapshot.groups);
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
      setGroups([]);
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
      setIsMasterLeadDrawerOpen(true);
    }
    setSelectedLeadId(deepLinkLeadId);
    handledDeepLinkLeadIdRef.current = deepLinkLeadId;
  }, [authChecked, deepLinkLeadId, deepLinkView, isAuthenticated, leads]);

  useEffect(() => {
    if (activeView !== "Master CRM") {
      setIsMasterLeadDrawerOpen(false);
    }

    if (activeView === "Daily Queue") {
      setSelectedLeadId(null);
    }
  }, [activeView]);

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
  const activeGroups = useMemo(() => sortLeadGroups(groups.filter((group) => group.isActive)), [groups]);
  const selectedGroupFilters = useMemo(
    () => activeGroups.filter((group) => groupFilterIds.includes(group.id)),
    [activeGroups, groupFilterIds]
  );
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
  const isMasterCRMView = activeView === "Master CRM";
  const showLeadDetailDrawer = isMasterCRMView && Boolean(selectedLead) && isMasterLeadDrawerOpen;
  const showInlineLeadDetail = Boolean(selectedLead) && !isMasterCRMView;

  useEffect(() => {
    setIsEditingRemarks(false);
    setIsSavingRemarks(false);
    setRemarksDraft(selectedLead?.remarks ?? "");
  }, [selectedLeadId]);

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
      setIsMasterLeadDrawerOpen(true);
      if (selectedLeadId === notification.leadId && leadDetailRef.current) {
        leadDetailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        setSelectedLeadId(notification.leadId);
      }
      return;
    }

    await loadSupabaseLeads({ focusLeadId: notification.leadId });
  };

  useEffect(() => {
    if (!selectedLeadId || !leadDetailRef.current || activeView === "Master CRM") return;
    leadDetailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeView, selectedLeadId]);

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

  useEffect(() => {
    setQueueAiError(null);
    setQueueAiQuestion("");
    setQueueAiResponse("");
    setQueueAiMessageDraft("");
  }, [currentQueueLeadId]);

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
  
  const extractLocationFromText = (value?: string) => {
    const text = value?.trim();
    if (!text) return "";
    const match = text.match(/(?:^|\n)\s*location\s*:\s*(.+)$/im);
    return match?.[1]?.trim() ?? "";
  };
  
  const formatGoogleCalendarDateTime = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  };
  
  const formatGoogleCalendarDateOnly = (date: Date) => {
    return date.toISOString().slice(0, 10).replace(/-/g, "");
  };

  const isUpcomingAppointment = (appointmentDate: string) => {
    const timestamp = new Date(appointmentDate).getTime();
    return Number.isFinite(timestamp) && timestamp > Date.now();
  };
  
  const buildGoogleCalendarDates = (appointmentDate: string) => {
    const hasTime = appointmentDate.includes("T");
    if (hasTime) {
      const start = new Date(appointmentDate);
      if (!Number.isNaN(start.getTime())) {
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        return `${formatGoogleCalendarDateTime(start)}/${formatGoogleCalendarDateTime(end)}`;
      }
    }
  
    const dayStart = new Date(`${appointmentDate.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(dayStart.getTime())) {
      const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      return `${formatGoogleCalendarDateOnly(dayStart)}/${formatGoogleCalendarDateOnly(nextDay)}`;
    }
  
    const fallbackStart = new Date();
    const fallbackEnd = new Date(fallbackStart.getTime() + 60 * 60 * 1000);
    return `${formatGoogleCalendarDateTime(fallbackStart)}/${formatGoogleCalendarDateTime(fallbackEnd)}`;
  };
  
  const buildGoogleCalendarEventUrl = (lead: Lead, appointmentDate: string, options?: { note?: string; location?: string }) => {
    const title = `Property Appointment — ${lead.name}`;
    const details: string[] = [`Client: ${lead.name}`];
  
    if (lead.phone?.trim()) {
      details.push(`Phone: ${lead.phone.trim()}`);
    }
  
    if (lead.source?.trim()) {
      details.push(`Source: ${lead.source.trim()}`);
    }
  
    if (options?.note?.trim()) {
      details.push(`Notes: ${options.note.trim()}`);
    }
  
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates: buildGoogleCalendarDates(appointmentDate),
      details: details.join("\n"),
    });
  
    if (options?.location?.trim()) {
      params.set("location", options.location.trim());
    }
  
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };
  
  const openGoogleCalendarForAppointment = (lead: Lead, appointmentDate: string, options?: { note?: string; location?: string }) => {
    const url = buildGoogleCalendarEventUrl(lead, appointmentDate, options);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const isQueueEligibleLead = (lead: Lead) => {
    if (lead.stage === "Closed" || lead.stage === "Lost / KIV") return false;
    if (lead.stage === "New Lead") return true;
    if (!lead.nextFollowUp) return true;
    return isDueToday(lead.nextFollowUp) || isOverdue(lead.nextFollowUp);
  };

  const compareNewestLeadFirst = (left: Lead, right: Lead) => {
    const leftTime = left.createdDate ? new Date(left.createdDate).getTime() : 0;
    const rightTime = right.createdDate ? new Date(right.createdDate).getTime() : 0;
    return rightTime - leftTime;
  };

  const isOverdueLead = (lead: Lead) => Boolean(lead.nextFollowUp && isOverdue(lead.nextFollowUp));
  const isDueTodayLead = (lead: Lead) => Boolean(lead.nextFollowUp && isDueToday(lead.nextFollowUp));
  const isUnscheduledActiveLead = (lead: Lead) => lead.stage !== "Closed" && lead.stage !== "Lost / KIV" && lead.stage !== "New Lead" && !lead.nextFollowUp;
  const isCompletedQueueLead = (leadId: string) => completedQueueLeadIds.includes(leadId);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const matchesSearch = [lead.name, lead.phone, lead.nextAction, lead.remarks]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesGrade = gradeFilter === "All" || lead.grade === gradeFilter;
      const matchesStage = stageFilter === "All" || lead.stage === stageFilter;
      const matchesSource = sourceFilter === "All" || lead.source === sourceFilter;
      const matchesGroups = groupFilterIds.length === 0 || lead.groups.some((group) => groupFilterIds.includes(group.id));
      return matchesSearch && matchesGrade && matchesStage && matchesSource && matchesGroups;
    });
  }, [groupFilterIds, leads, gradeFilter, search, sourceFilter, stageFilter]);

  const newLeadQueueLeads = useMemo(
    () => [...leads].filter((lead) => lead.stage === "New Lead" && !isCompletedQueueLead(lead.id)).sort(compareNewestLeadFirst),
    [completedQueueLeadIds, leads]
  );
  const overdueQueueLeads = useMemo(
    () => [...leads].filter((lead) => lead.stage !== "New Lead" && isOverdueLead(lead) && !isCompletedQueueLead(lead.id)).sort(compareLeadPriority),
    [completedQueueLeadIds, leads]
  );
  const dueTodayQueueLeads = useMemo(
    () => [...leads].filter((lead) => lead.stage !== "New Lead" && isDueTodayLead(lead) && !isCompletedQueueLead(lead.id)).sort(compareLeadPriority),
    [completedQueueLeadIds, leads]
  );
  const unscheduledBacklogLeads = useMemo(
    () => [...leads].filter((lead) => isUnscheduledActiveLead(lead) && !isCompletedQueueLead(lead.id)).sort(compareLeadPriority),
    [completedQueueLeadIds, leads]
  );
  const queueLeads = useMemo(
    () => [...newLeadQueueLeads, ...overdueQueueLeads, ...dueTodayQueueLeads, ...unscheduledBacklogLeads],
    [newLeadQueueLeads, overdueQueueLeads, dueTodayQueueLeads, unscheduledBacklogLeads]
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
    return stageOptionsForFilterAndPipeline.map((stage) => ({
      stage,
      leads: filteredLeads.filter((lead) => lead.stage === stage),
    }));
  }, [filteredLeads, stageOptionsForFilterAndPipeline]);

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
    if (activeView === "Master CRM") {
      setSelectedLeadId(lead.id);
      setIsMasterLeadDrawerOpen(true);
      return;
    }

    if (selectedLeadId === lead.id && leadDetailRef.current) {
      leadDetailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setSelectedLeadId(lead.id);
  };

  const updateLead = (leadId: string, updates: Partial<Lead>) => {
    setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, ...updates } : lead)));
  };

  const updateLeadGroupsInState = useCallback((group: LeadGroup) => {
    setLeads((prev) => prev.map((lead) => ({
      ...lead,
      groups: sortLeadGroups(lead.groups.map((item) => (item.id === group.id ? group : item))),
    })));
    setDraft((prev) => ({
      ...prev,
      groups: sortLeadGroups(prev.groups.map((item) => (item.id === group.id ? group : item))),
    }));
  }, []);

  const removeGroupFromState = useCallback((groupId: string) => {
    setLeads((prev) => prev.map((lead) => ({ ...lead, groups: lead.groups.filter((group) => group.id !== groupId) })));
    setDraft((prev) => ({ ...prev, groups: prev.groups.filter((group) => group.id !== groupId) }));
    setGroupFilterIds((prev) => prev.filter((currentId) => currentId !== groupId));
  }, []);

  const findGroupByName = useCallback((name: string) => {
    const normalized = normalizeGroupName(name);
    return groups.find((group) => normalizeGroupName(group.name) === normalized) ?? null;
  }, [groups]);

  const ensureGroupExists = useCallback(async (name: string, color?: string | null) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Group name is required.");
    }

    const existingGroup = findGroupByName(trimmedName);
    const client = createClient();

    if (existingGroup) {
      if (!existingGroup.isActive) {
        const reactivatedGroup = await updateSupabaseLeadGroup(client, existingGroup.id, {
          name: trimmedName,
          color: color ?? existingGroup.color ?? DEFAULT_GROUP_COLOR,
          isActive: true,
        });
        setGroups((prev) => sortLeadGroups(prev.map((group) => (group.id === reactivatedGroup.id ? reactivatedGroup : group))));
        updateLeadGroupsInState(reactivatedGroup);
        return reactivatedGroup;
      }

      return existingGroup;
    }

    const createdGroup = await createSupabaseLeadGroup(client, { name: trimmedName, color: color ?? DEFAULT_GROUP_COLOR });
    setGroups((prev) => sortLeadGroups([...prev, createdGroup]));
    return createdGroup;
  }, [findGroupByName, updateLeadGroupsInState]);

  const saveLeadGroups = useCallback(async (leadId: string, nextGroups: LeadGroup[]) => {
    const currentLead = leads.find((lead) => lead.id === leadId);
    if (!currentLead) {
      throw new Error("Lead could not be found for this action.");
    }

    const client = createClient();
    const sortedGroups = sortLeadGroups(nextGroups.filter((group) => group.isActive));
    await setSupabaseLeadGroupAssignments(client, leadId, sortedGroups.map((group) => group.id));
    setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, groups: sortedGroups } : lead)));
    setDraft((prev) => (prev.id === leadId ? { ...prev, groups: sortedGroups } : prev));
  }, [leads]);

  const openGroupManager = useCallback(() => {
    setGroupManagerDrafts(
      Object.fromEntries(
        groups.map((group) => [group.id, { name: group.name, color: group.color ?? DEFAULT_GROUP_COLOR, isActive: group.isActive }])
      )
    );
    setGroupUiError(null);
    setNewGroupName("");
    setNewGroupColor(DEFAULT_GROUP_COLOR);
    setShowGroupManager(true);
  }, [groups]);

  const toggleGroupFilter = (groupId: string) => {
    setGroupFilterIds((prev) => (prev.includes(groupId) ? prev.filter((currentId) => currentId !== groupId) : [...prev, groupId]));
  };

  const toggleSelectedLeadGroup = async (group: LeadGroup) => {
    if (!selectedLead) return;

    const nextGroups = selectedLead.groups.some((item) => item.id === group.id)
      ? selectedLead.groups.filter((item) => item.id !== group.id)
      : sortLeadGroups([...selectedLead.groups, group]);

    try {
      setGroupUiError(null);
      await saveLeadGroups(selectedLead.id, nextGroups);
    } catch (error) {
      setGroupUiError(error instanceof Error ? error.message : "Unable to save lead groups.");
    }
  };

  const createAndAssignGroupToSelectedLead = async () => {
    if (!selectedLead || !detailGroupSearch.trim()) return;

    try {
      setGroupUiError(null);
      const group = await ensureGroupExists(detailGroupSearch);
      const nextGroups = selectedLead.groups.some((item) => item.id === group.id)
        ? selectedLead.groups
        : sortLeadGroups([...selectedLead.groups, group]);
      await saveLeadGroups(selectedLead.id, nextGroups);
      setDetailGroupSearch("");
    } catch (error) {
      setGroupUiError(error instanceof Error ? error.message : "Unable to create this group.");
    }
  };

  const toggleDraftGroup = (group: LeadGroup) => {
    setDraft((prev) => {
      const exists = prev.groups.some((item) => item.id === group.id);
      return {
        ...prev,
        groups: exists ? prev.groups.filter((item) => item.id !== group.id) : sortLeadGroups([...prev.groups, group]),
      };
    });
  };

  const createAndAssignGroupToDraft = async () => {
    if (!draftGroupSearch.trim()) return;

    try {
      setGroupUiError(null);
      const group = await ensureGroupExists(draftGroupSearch);
      setDraft((prev) => ({
        ...prev,
        groups: prev.groups.some((item) => item.id === group.id) ? prev.groups : sortLeadGroups([...prev.groups, group]),
      }));
      setDraftGroupSearch("");
    } catch (error) {
      setGroupUiError(error instanceof Error ? error.message : "Unable to create this group.");
    }
  };

  const saveManagedGroup = async (groupId: string) => {
    const editor = groupManagerDrafts[groupId];
    if (!editor) return;

    try {
      setGroupUiError(null);
      const updatedGroup = await updateSupabaseLeadGroup(createClient(), groupId, {
        name: editor.name,
        color: editor.color,
        isActive: editor.isActive,
      });

      setGroups((prev) => sortLeadGroups(prev.map((group) => (group.id === updatedGroup.id ? updatedGroup : group))));
      if (updatedGroup.isActive) {
        updateLeadGroupsInState(updatedGroup);
      } else {
        removeGroupFromState(updatedGroup.id);
      }
    } catch (error) {
      setGroupUiError(error instanceof Error ? error.message : "Unable to update this group.");
    }
  };

  const deleteManagedGroup = async (groupId: string) => {
    if (!window.confirm("Delete this group? Leads will remain and only the group relationship will be removed.")) {
      return;
    }

    try {
      setGroupUiError(null);
      await deleteSupabaseLeadGroup(createClient(), groupId);
      setGroups((prev) => prev.filter((group) => group.id !== groupId));
      setGroupManagerDrafts((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      removeGroupFromState(groupId);
    } catch (error) {
      setGroupUiError(error instanceof Error ? error.message : "Unable to delete this group.");
    }
  };

  const createManagedGroup = async () => {
    try {
      setGroupUiError(null);
      const createdGroup = await ensureGroupExists(newGroupName, newGroupColor);
      setGroupManagerDrafts((prev) => ({
        ...prev,
        [createdGroup.id]: {
          name: createdGroup.name,
          color: createdGroup.color ?? DEFAULT_GROUP_COLOR,
          isActive: createdGroup.isActive,
        },
      }));
      setNewGroupName("");
      setNewGroupColor(DEFAULT_GROUP_COLOR);
    } catch (error) {
      setGroupUiError(error instanceof Error ? error.message : "Unable to create this group.");
    }
  };

  const detailGroupResults = useMemo(
    () => activeGroups.filter((group) => group.name.toLowerCase().includes(detailGroupSearch.toLowerCase())),
    [activeGroups, detailGroupSearch]
  );
  const draftGroupResults = useMemo(
    () => activeGroups.filter((group) => group.name.toLowerCase().includes(draftGroupSearch.toLowerCase())),
    [activeGroups, draftGroupSearch]
  );
  const filterGroupResults = useMemo(
    () => activeGroups.filter((group) => group.name.toLowerCase().includes(groupFilterSearch.toLowerCase())),
    [activeGroups, groupFilterSearch]
  );

  const sortActivitiesNewestFirst = (activities: ActivityEntry[]) => {
    return [...activities].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  };

  const formatActivityDateTime = (value?: string) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleString("en-SG", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const getActivityTypeLabel = (type: ActivityEntry["type"]) => {
    switch (type) {
      case "note":
        return "Note";
      case "call":
        return "Call";
      case "whatsapp":
        return "WhatsApp";
      case "appointment":
        return "Appointment";
      case "follow-up":
        return "Follow-Up";
      case "status":
        return "Status";
      case "stage":
        return "Stage";
      case "grade":
        return "Grade";
      default:
        return "Activity";
    }
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

  const requestAiLeoForLead = async (lead: Lead, prompt: string) => {
    const response = await fetch("/api/ai-leo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        leadContext: buildAiLeoLeadContext(lead),
      }),
    });

    const payload = (await response.json().catch(() => null)) as { response?: string; error?: string } | null;
    if (!response.ok) {
      throw new Error(payload?.error || "AI Leo could not complete this request.");
    }

    return payload?.response || "AI Leo returned an empty response.";
  };

  const extractClientReadyMessage = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return "";

    // Prefer explicit tag output when model follows instruction exactly.
    const tagged = trimmed.match(/<message>([\s\S]*?)<\/message>/i);
    if (tagged?.[1]) {
      return tagged[1].trim();
    }

    // Fall back to removing common reasoning labels if the model adds them.
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !/^(analysis|reasoning|observation|context|objective|rationale|notes?|why|strategy)\s*[:\-]/i.test(line));

    return lines.join("\n").trim();
  };

  const askAiLeo = async (prompt: string) => {
    if (!selectedLead) return;

    setIsAiLeoLoading(true);
    setAiLeoError(null);

    try {
      const result = await requestAiLeoForLead(selectedLead, prompt);
      setAiLeoResponse(result);
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

  const runQueueAi = async (prompt: string, options?: { asMessageDraft?: boolean }) => {
    if (!currentQueueLead) return;
    setIsQueueAiLoading(true);
    setQueueAiError(null);

    try {
      const result = await requestAiLeoForLead(currentQueueLead, prompt);
      if (options?.asMessageDraft) {
        setQueueAiMessageDraft(extractClientReadyMessage(result));
      } else {
        setQueueAiResponse(result);
      }
    } catch (error) {
      setQueueAiError(error instanceof Error ? error.message : "AI Leo could not complete this request.");
    } finally {
      setIsQueueAiLoading(false);
    }
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

  const requestActiveClientSide = (current?: LeadClientSide | null): LeadClientSide | null => {
    const input = window.prompt("Client Side: Buyer, Seller, or Buyer + Seller", current ?? "Buyer");
    if (input === null) return null;
    const normalized = input.trim().toLowerCase();
    if (normalized === "buyer") return "Buyer";
    if (normalized === "seller") return "Seller";
    if (normalized === "buyer + seller" || normalized === "buyer+seller") return "Buyer + Seller";
    alert("Please enter Buyer, Seller, or Buyer + Seller.");
    return null;
  };

  const changeLeadStage = async (lead: Lead, stage: LeadStage, note?: string) => {
    if (lead.stage === stage && !note) return;

    let nextClientSide = lead.clientSide ?? null;
    if (stage === "Active Client") {
      const selectedClientSide = requestActiveClientSide(lead.clientSide);
      if (!selectedClientSide) return;
      nextClientSide = selectedClientSide;
    }

    const updates: Partial<Lead> = {
      stage,
      clientSide: stage === "Active Client" ? nextClientSide : lead.clientSide ?? null,
    };

    if (stage === "Follow-Up" && !lead.nextFollowUp) {
      updates.nextAction = "Set next follow-up";
    }

    const detail = note?.trim()
      ? `Stage updated to ${stage}. ${note.trim()}`
      : `Stage updated to ${stage}`;

    try {
      await persistLeadMutation(
        lead.id,
        updates,
        { type: "status", title: "Stage changed", details: detail }
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Unable to persist this stage change to Supabase."
      );
      throw error;
    }
  };

  const completeQueueLeadAndAdvance = (leadId: string) => {
    setCompletedQueueLeadIds((prev) => (prev.includes(leadId) ? prev : [...prev, leadId]));
    const nextLead = queueLeads.find((candidate) => candidate.id !== leadId);
    setCurrentQueueLeadId(nextLead?.id ?? null);
  };

  const openConnectedNextStepPrompt = (lead: Lead, options?: { queueMode?: boolean }) => {
    setConnectedNextStepDraft({
      leadId: lead.id,
      stage: "Conversation",
      nextFollowUp: lead.nextFollowUp?.slice(0, 10) ?? "",
      note: "",
      clientSide: lead.clientSide ?? "",
      queueMode: Boolean(options?.queueMode),
    });
    setShowConnectedNextStepModal(true);
  };

  const openUnifiedAppointmentFlow = (lead: Lead, options?: { queueMode?: boolean; note?: string; date?: string }) => {
    setAppointmentDraft({
      leadId: lead.id,
      date: options?.date ?? (lead.nextFollowUp?.slice(0, 10) ?? ""),
      time: "",
      note: options?.note ?? "",
      queueMode: Boolean(options?.queueMode),
    });
    setShowAppointmentModal(true);
  };

  const saveUnifiedAppointmentFlow = async () => {
    if (!appointmentDraft) return;
    if (!appointmentDraft.date) {
      alert("Please choose an appointment date.");
      return;
    }

    const lead = leads.find((item) => item.id === appointmentDraft.leadId);
    if (!lead) {
      setShowAppointmentModal(false);
      setAppointmentDraft(null);
      return;
    }

    const normalizedTime = appointmentDraft.time.trim();
    if (normalizedTime && !/^\d{2}:\d{2}$/.test(normalizedTime)) {
      alert("Invalid time. Please use HH:MM.");
      return;
    }

    const appointmentDate = normalizedTime ? `${appointmentDraft.date}T${normalizedTime}:00` : appointmentDraft.date;

    try {
      await markLeadAppointment(lead, appointmentDate, appointmentDraft.note.trim());
      const savedNote = appointmentDraft.note.trim();
      const savedLocation = extractLocationFromText(savedNote);
      setCalendarAppointmentCta({
        leadId: lead.id,
        leadName: lead.name,
        phone: lead.phone,
        source: lead.source,
        appointmentDate,
        note: savedNote,
        location: savedLocation,
      });
      const shouldAdvance = appointmentDraft.queueMode;
      setShowAppointmentModal(false);
      setAppointmentDraft(null);
      if (shouldAdvance) {
        completeQueueLeadAndAdvance(lead.id);
      }
    } catch {
      // markLeadAppointment already handles user-facing error details.
    }
  };

  const saveConnectedNextStep = async () => {
    if (!connectedNextStepDraft) return;

    const lead = leads.find((item) => item.id === connectedNextStepDraft.leadId);
    if (!lead) {
      setShowConnectedNextStepModal(false);
      setConnectedNextStepDraft(null);
      return;
    }

    const updates: Partial<Lead> = {
      stage: connectedNextStepDraft.stage,
    };

    if (connectedNextStepDraft.nextFollowUp) {
      updates.nextFollowUp = connectedNextStepDraft.nextFollowUp;
      updates.nextAction = `Follow up on ${connectedNextStepDraft.nextFollowUp}`;
    }

    if (connectedNextStepDraft.stage === "Active Client") {
      if (!connectedNextStepDraft.clientSide) {
        alert("Please choose a Client Side before saving Active Client.");
        return;
      }
      updates.clientSide = connectedNextStepDraft.clientSide;
    }

    if (connectedNextStepDraft.stage === "Appointment Set") {
      setShowConnectedNextStepModal(false);
      openUnifiedAppointmentFlow(lead, {
        queueMode: connectedNextStepDraft.queueMode,
        note: connectedNextStepDraft.note,
        date: connectedNextStepDraft.nextFollowUp,
      });
      return;
    }

    const note = connectedNextStepDraft.note.trim();
    const detailParts = [`Connected next step saved. Stage: ${connectedNextStepDraft.stage}.`];
    if (connectedNextStepDraft.nextFollowUp) {
      detailParts.push(`Follow-up: ${connectedNextStepDraft.nextFollowUp}.`);
    }
    if (connectedNextStepDraft.stage === "Active Client" && connectedNextStepDraft.clientSide) {
      detailParts.push(`Client Side: ${connectedNextStepDraft.clientSide}.`);
    }
    if (note) {
      detailParts.push(`Note: ${note}`);
    }

    try {
      await persistLeadMutation(
        lead.id,
        updates,
        {
          type: "follow-up",
          title: "Connected next step",
          details: detailParts.join(" "),
          outcome: "follow-up",
        }
      );
      setShowConnectedNextStepModal(false);
      setConnectedNextStepDraft(null);
      if (connectedNextStepDraft.queueMode) {
        completeQueueLeadAndAdvance(lead.id);
      }
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Unable to save the connected next step."
      );
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
      groups: currentLead.groups,
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
    if (normalized.stage === "Active Client" && !normalized.clientSide) {
      setValidationMessage("Please choose a Client Side for Active Client stage.");
      return;
    }
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

        await setSupabaseLeadGroupAssignments(client, savedLead.id, toSave.groups.map((group) => group.id));

        persistedId = savedLead.id;
        setLeads((prev) =>
          prev.map((lead) => (lead.id === normalized.id ? {
              ...savedLead,
              groups: sortLeadGroups(toSave.groups),
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
        await setSupabaseLeadGroupAssignments(client, savedLead.id, toSave.groups.map((group) => group.id));
        persistedId = savedLead.id;
        setLeads((prev) => [{ ...savedLead, groups: sortLeadGroups(toSave.groups), activity: sortActivitiesNewestFirst([persistedCreatedActivity]) }, ...prev]);
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

  const startEditingRemarks = () => {
    setRemarksDraft(selectedLead?.remarks ?? "");
    setIsEditingRemarks(true);
  };

  const cancelEditingRemarks = () => {
    setRemarksDraft(selectedLead?.remarks ?? "");
    setIsEditingRemarks(false);
  };

  const saveRemarks = async () => {
    if (!selectedLead) return;

    try {
      setIsSavingRemarks(true);
      await persistLeadMutation(selectedLead.id, { remarks: remarksDraft });
      setIsEditingRemarks(false);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Unable to persist remarks to Supabase."
      );
    } finally {
      setIsSavingRemarks(false);
    }
  };

  const handleLeadAction = async (leadId: string, action: string, options?: { queueMode?: boolean }) => {
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
        if (persistedLead) {
          openConnectedNextStepPrompt(persistedLead, { queueMode: options?.queueMode });
        }
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
        openUnifiedAppointmentFlow(lead, { queueMode: options?.queueMode });
        return;
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
        if (options?.queueMode) {
          if (action === "NO ANSWER" || action === "NOT INTERESTED" || action === "INVALID NUMBER") {
            shouldAdvanceQueue = true;
          }
        } else {
          shouldAdvanceQueue = !isQueueEligibleLead(persistedLead);
        }
      }

      if (shouldAdvanceQueue && currentQueueLeadId === leadId) {
        if (options?.queueMode) {
          completeQueueLeadAndAdvance(leadId);
        } else {
          setCurrentQueueLeadId(nextQueueLeadId);
        }
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

            {calendarAppointmentCta ? (
              <section className="mb-6 rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm">
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Appointment saved</p>
                <p className="mt-2 text-sm text-[#5f5a52]">
                  {calendarAppointmentCta.leadName} · {formatDate(calendarAppointmentCta.appointmentDate)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      const lead = leads.find((item) => item.id === calendarAppointmentCta.leadId);
                      if (!lead) return;
                      openGoogleCalendarForAppointment(lead, calendarAppointmentCta.appointmentDate, {
                        note: calendarAppointmentCta.note,
                        location: calendarAppointmentCta.location,
                      });
                    }}
                    className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white"
                  >
                    Add to Google Calendar
                  </button>
                  <button
                    onClick={() => setCalendarAppointmentCta(null)}
                    className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm"
                  >
                    Dismiss
                  </button>
                </div>
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
                  {stageOptionsForSelection.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
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
                <div className="relative">
                  <button onClick={() => setShowGroupFilterMenu((prev) => !prev)} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2 text-sm">
                    {selectedGroupFilters.length ? `Groups: ${selectedGroupFilters.map((group) => group.name).join(", ")}` : "Groups"}
                  </button>
                  {showGroupFilterMenu ? (
                    <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-[20px] border border-[#e7e0d0] bg-white p-3 shadow-xl">
                      <input
                        value={groupFilterSearch}
                        onChange={(event) => setGroupFilterSearch(event.target.value)}
                        placeholder="Search groups"
                        className="w-full rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2 text-sm"
                      />
                      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                        {filterGroupResults.map((group) => (
                          <label key={group.id} className="flex items-center gap-3 rounded-2xl border border-[#f0e8d8] px-3 py-2 text-sm">
                            <input type="checkbox" checked={groupFilterIds.includes(group.id)} onChange={() => toggleGroupFilter(group.id)} />
                            <span className="rounded-full border px-2 py-1 text-xs font-medium" style={getLeadGroupChipStyle(group.color)}>{group.name}</span>
                          </label>
                        ))}
                        {!filterGroupResults.length ? <p className="text-sm text-[#8a8478]">No groups found.</p> : null}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <button onClick={() => setGroupFilterIds([])} className="text-sm font-semibold text-[#5f5a52] underline">Clear</button>
                        <button onClick={() => setShowGroupFilterMenu(false)} className="rounded-full border border-[#e7e0d0] px-3 py-1 text-xs font-semibold">Done</button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <button onClick={openGroupManager} className="rounded-2xl border border-[#e7e0d0] px-4 py-2 text-sm font-semibold">Manage Groups</button>
                <button onClick={() => setShowModal(true)} className="rounded-2xl bg-[#171717] px-4 py-2 text-sm font-semibold text-white">Add Lead</button>
              </div>

              {selectedGroupFilters.length ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-[#5f5a52]">
                  <span className="font-semibold">Groups:</span>
                  {selectedGroupFilters.map((group) => (
                    <button key={group.id} onClick={() => toggleGroupFilter(group.id)} className="rounded-full border px-2 py-1 text-xs font-medium" style={getLeadGroupChipStyle(group.color)}>
                      {group.name} ×
                    </button>
                  ))}
                  <button onClick={() => setGroupFilterIds([])} className="text-xs font-semibold underline">Clear</button>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-[24px] border border-[#e7e0d0] bg-white shadow-sm">
                <div className="grid grid-cols-[1.2fr_0.7fr_0.8fr_0.8fr_1fr_0.8fr_0.8fr] gap-3 border-b border-[#e7e0d0] bg-[#f8f3e5] px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#5f5a52]">
                  <div>Name</div>
                  <div>Grade</div>
                  <div>Source</div>
                  <div>Stage</div>
                  <div>Groups</div>
                  <div>Next Follow-up</div>
                  <div>Action</div>
                </div>
                {filteredLeads.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => openLead(lead)}
                    className="grid cursor-pointer grid-cols-[1.2fr_0.7fr_0.8fr_0.8fr_1fr_0.8fr_0.8fr] gap-3 border-b border-[#f0e8d8] px-4 py-3 text-sm last:border-b-0 hover:bg-[#fcfaef]"
                  >
                    <p className="text-left font-semibold text-[#171717]">{lead.name}</p>
                    <div className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${gradeAccent[lead.grade]}`}>{lead.grade}</div>
                    <div>{lead.source}</div>
                    <div>{lead.stage}</div>
                    <div>{renderLeadGroupSummary(lead.groups, { limit: 2, emptyLabel: "—" })}</div>
                    <div>{formatDate(lead.nextFollowUp)}</div>
                    <div className="flex gap-2">
                      <button onClick={(event) => { event.stopPropagation(); setDraft({ ...lead }); setShowModal(true); }} className="rounded-full border border-[#e7e0d0] px-2 py-1">Edit</button>
                      <button onClick={(event) => { event.stopPropagation(); void deleteLead(lead.id); }} className="rounded-full border border-[#e7e0d0] px-2 py-1">Delete</button>
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
                      {newLeadQueueLeads.length} new · {overdueQueueLeads.length} overdue · {dueTodayQueueLeads.length} due today · {unscheduledBacklogLeads.length} unscheduled
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
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5f5a52]">AI Leo</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                void runQueueAi("I may be calling this lead now. Read the full CRM history first and give me a practical 30-second pre-call brief with one objective, key discovery points, and one natural opening line.");
                              }}
                              className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm"
                            >
                              Prepare My Call
                            </button>
                            <button
                              onClick={() => {
                                void runQueueAi("Read the full lead history and draft one natural WhatsApp message I can send now with one clear conversational objective.");
                              }}
                              className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm"
                            >
                              Draft WhatsApp
                            </button>
                            <button
                              onClick={() => {
                                if (!queueAiQuestion.trim()) return;
                                void runQueueAi(queueAiQuestion.trim());
                              }}
                              className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white"
                            >
                              Ask AI Leo
                            </button>
                          </div>
                          <textarea
                            value={queueAiQuestion}
                            onChange={(event) => setQueueAiQuestion(event.target.value)}
                            className="mt-3 min-h-[84px] w-full rounded-2xl border border-[#e7e0d0] bg-white px-3 py-2 text-sm"
                            placeholder="Ask AI Leo about this lead's context and best next move"
                          />
                          {isQueueAiLoading ? <p className="mt-2 text-sm text-[#5f5a52]">AI Leo is thinking...</p> : null}
                          {queueAiError ? <p className="mt-2 text-sm text-[#b08c2c]">{queueAiError}</p> : null}
                          {queueAiResponse ? (
                            <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-[#e7e0d0] bg-white p-3 text-sm text-[#171717]">
                              {queueAiResponse}
                            </div>
                          ) : null}
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5f5a52]">Action</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "CALL"); }} className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white">Call</button>
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "WHATSAPP"); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">WhatsApp</button>
                            <button
                              onClick={() => {
                                void runQueueAi(
                                  "Draft one short context-aware WhatsApp message I can send this lead now. Return ONLY the final client-ready message wrapped in <message>...</message>. Do not include any analysis, reasoning, labels, bullets, or preamble.",
                                  { asMessageDraft: true }
                                );
                              }}
                              className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm"
                            >
                              AI Message
                            </button>
                          </div>
                          {queueAiMessageDraft ? (
                            <div className="mt-3 rounded-2xl border border-[#e7e0d0] bg-white p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5f5a52]">AI message preview</p>
                              <textarea
                                value={queueAiMessageDraft}
                                onChange={(event) => setQueueAiMessageDraft(event.target.value)}
                                className="mt-2 min-h-[90px] w-full rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2 text-sm"
                              />
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  onClick={() => {
                                    void navigator.clipboard.writeText(queueAiMessageDraft);
                                  }}
                                  className="rounded-full border border-[#e7e0d0] bg-white px-3 py-1.5 text-xs font-semibold"
                                >
                                  Copy
                                </button>
                                <button
                                  onClick={() => {
                                    const baseWhatsAppUrl = buildWhatsAppLink(currentQueueLead.phone);
                                    if (!baseWhatsAppUrl) return;
                                    const url = `${baseWhatsAppUrl}?text=${encodeURIComponent(queueAiMessageDraft)}`;
                                    window.open(url, "_blank", "noopener,noreferrer");
                                  }}
                                  className="rounded-full bg-[#171717] px-3 py-1.5 text-xs font-semibold text-white"
                                >
                                  Open in WhatsApp
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5f5a52]">Add note</p>
                          <textarea value={queueNoteInput} onChange={(event) => setQueueNoteInput(event.target.value)} className="mt-3 min-h-[96px] w-full rounded-2xl border border-[#e7e0d0] bg-white px-3 py-2 text-sm" placeholder="Add conversation notes or context" />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button onClick={() => { void addNoteToLead(currentQueueLead, queueNoteInput).then(() => setQueueNoteInput("")); }} className="rounded-full bg-[#171717] px-3 py-2 text-sm text-white">Save Note</button>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5f5a52]">Outcome</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "CONNECTED", { queueMode: true }); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Connected</button>
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "APPOINTMENT SET", { queueMode: true }); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Appointment</button>
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "NO ANSWER", { queueMode: true }); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">No Answer</button>
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "NOT INTERESTED", { queueMode: true }); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Not Interested</button>
                            <button onClick={() => { void handleLeadAction(currentQueueLead.id, "INVALID NUMBER", { queueMode: true }); }} className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm">Invalid Number</button>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5f5a52]">Manual controls</p>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[#5f5a52]">
                              Grade
                              <select
                                value={currentQueueLead.grade}
                                onChange={(event) => { void changeLeadGrade(currentQueueLead, event.target.value as LeadGrade); }}
                                className="rounded-2xl border border-[#e7e0d0] bg-white px-3 py-2 text-sm normal-case tracking-normal text-[#171717]"
                              >
                                <option value="A">A</option>
                                <option value="B">B</option>
                                <option value="C">C</option>
                                <option value="D">D</option>
                              </select>
                            </label>
                            <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[#5f5a52]">
                              Stage
                              <select
                                value={currentQueueLead.stage}
                                onChange={(event) => { void changeLeadStage(currentQueueLead, event.target.value as LeadStage); }}
                                className="rounded-2xl border border-[#e7e0d0] bg-white px-3 py-2 text-sm normal-case tracking-normal text-[#171717]"
                              >
                                {stageOptionsForSelection.map((stage) => (
                                  <option key={stage} value={stage}>{stage}</option>
                                ))}
                                {!stageOptionsForSelection.includes(currentQueueLead.stage) ? <option value={currentQueueLead.stage}>{currentQueueLead.stage}</option> : null}
                              </select>
                            </label>
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
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Operational settings</p>
                <h3 className="mt-2 text-xl font-semibold">Manage notifications and data tools</h3>
                <p className="mt-4 text-sm text-[#5f5a52]">Prospecting OS now loads and syncs leads automatically from Supabase during normal CRM usage.</p>
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

          {showLeadDetailDrawer ? (
            <button
              onClick={() => setIsMasterLeadDrawerOpen(false)}
              className="fixed inset-0 z-40 bg-black/35"
              aria-label="Close lead detail drawer"
            />
          ) : null}

          {(showInlineLeadDetail || showLeadDetailDrawer) && selectedLead ? (
            <section
              ref={leadDetailRef}
              className={showLeadDetailDrawer
                ? "fixed inset-y-0 right-0 z-50 w-full overflow-y-auto border-l border-[#e7e0d0] bg-white p-5 shadow-2xl sm:max-w-2xl"
                : "mt-6 rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-sm"}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Lead detail</p>
                  <h3 className="mt-2 text-xl font-semibold">{selectedLead.name}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${gradeAccent[selectedLead.grade]}`}>{gradeLabels[selectedLead.grade]}</div>
                  {showLeadDetailDrawer ? (
                    <button
                      onClick={() => setIsMasterLeadDrawerOpen(false)}
                      className="rounded-full border border-[#e7e0d0] px-3 py-1 text-xs font-semibold"
                    >
                      Close
                    </button>
                  ) : null}
                </div>
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
                      {selectedLead.appointmentDate && isUpcomingAppointment(selectedLead.appointmentDate) ? (
                        <button
                          onClick={() => {
                            openGoogleCalendarForAppointment(selectedLead, selectedLead.appointmentDate, {
                              note: selectedLead.remarks,
                              location: extractLocationFromText(selectedLead.remarks),
                            });
                          }}
                          className="rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm"
                        >
                          Add to Google Calendar
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[#5f5a52]">
                        Grade
                        <select
                          value={selectedLead.grade}
                          onChange={(event) => { void changeLeadGrade(selectedLead, event.target.value as LeadGrade); }}
                          className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2 text-sm normal-case tracking-normal text-[#171717]"
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="C">C</option>
                          <option value="D">D</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.2em] text-[#5f5a52]">
                        Stage
                        <select
                          value={selectedLead.stage}
                          onChange={(event) => { void changeLeadStage(selectedLead, event.target.value as LeadStage); }}
                          className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2 text-sm normal-case tracking-normal text-[#171717]"
                        >
                          {stageOptionsForSelection.map((stage) => (
                            <option key={stage} value={stage}>{stage}</option>
                          ))}
                          {!stageOptionsForSelection.includes(selectedLead.stage) ? <option value={selectedLead.stage}>{selectedLead.stage}</option> : null}
                        </select>
                      </label>
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
                    <p className="text-sm">Client side: {selectedLead.clientSide ?? "—"}</p>
                    <div className="mt-3 rounded-2xl border border-[#e7e0d0] bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-[0.2em] text-[#b08c2c]">Remarks</p>
                        {!isEditingRemarks ? (
                          <button
                            onClick={startEditingRemarks}
                            className="rounded-full border border-[#e7e0d0] px-3 py-1 text-xs font-semibold"
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>
                      {isEditingRemarks ? (
                        <div className="mt-2 space-y-2">
                          <textarea
                            value={remarksDraft}
                            onChange={(event) => setRemarksDraft(event.target.value)}
                            className="min-h-[120px] w-full rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-2 text-sm text-[#171717]"
                            placeholder=""
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                void saveRemarks();
                              }}
                              disabled={isSavingRemarks}
                              className="rounded-full bg-[#171717] px-3 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isSavingRemarks ? "Saving..." : "Save"}
                            </button>
                            <button
                              onClick={cancelEditingRemarks}
                              disabled={isSavingRemarks}
                              className="rounded-full border border-[#e7e0d0] px-3 py-1 text-xs font-semibold"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : selectedLead.remarks && selectedLead.remarks.trim().length > 0 ? (
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[#171717]">{selectedLead.remarks}</p>
                      ) : (
                        <p className="mt-2 text-sm text-[#5f5a52]">—</p>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#e7e0d0] bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Groups</p>
                      <button onClick={() => setShowDetailGroupPicker((prev) => !prev)} className="rounded-full border border-[#e7e0d0] px-3 py-1 text-xs font-semibold">+ Add group</button>
                    </div>
                    <div className="mt-3">{renderLeadGroupSummary(selectedLead.groups, { limit: 3 })}</div>
                    {showDetailGroupPicker ? (
                      <div className="mt-3 rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-3">
                        <input
                          value={detailGroupSearch}
                          onChange={(event) => setDetailGroupSearch(event.target.value)}
                          placeholder="Search groups"
                          className="w-full rounded-2xl border border-[#e7e0d0] bg-white px-3 py-2 text-sm"
                        />
                        <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                          {detailGroupResults.map((group) => (
                            <label key={group.id} className="flex items-center gap-3 rounded-2xl border border-[#e7e0d0] bg-white px-3 py-2 text-sm">
                              <input type="checkbox" checked={selectedLead.groups.some((item) => item.id === group.id)} onChange={() => { void toggleSelectedLeadGroup(group); }} />
                              <span className="rounded-full border px-2 py-1 text-xs font-medium" style={getLeadGroupChipStyle(group.color)}>{group.name}</span>
                            </label>
                          ))}
                          {!detailGroupResults.length ? <p className="text-sm text-[#8a8478]">No groups found.</p> : null}
                        </div>
                        {detailGroupSearch.trim() && !findGroupByName(detailGroupSearch) ? (
                          <button onClick={() => { void createAndAssignGroupToSelectedLead(); }} className="mt-3 rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm font-semibold">
                            + Create "{detailGroupSearch.trim()}"
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {groupUiError ? <p className="mt-3 text-sm text-[#b08c2c]">{groupUiError}</p> : null}
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
                      {sortActivitiesNewestFirst(selectedLead.activity).length === 0 ? (
                        <p className="rounded-2xl border border-dashed border-[#e7e0d0] bg-[#fcfaef] px-4 py-3 text-sm text-[#5f5a52]">No activity yet</p>
                      ) : (
                        sortActivitiesNewestFirst(selectedLead.activity).map((entry) => (
                          <div key={entry.id} className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="rounded-full border border-[#e7e0d0] bg-white px-2 py-0.5 text-xs font-semibold text-[#5f5a52]">
                                  {getActivityTypeLabel(entry.type)}
                                </span>
                                <p className="text-xs text-[#5f5a52]">{formatActivityDateTime(entry.createdAt)}</p>
                              </div>
                              <button
                                onClick={() => {
                                  void deleteTimelineActivity(selectedLead.id, entry.id);
                                }}
                                className="text-xs font-semibold text-[#5f5a52] underline"
                              >
                                Delete
                              </button>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-[#171717]">
                              {entry.details || entry.title}
                            </p>
                          </div>
                        ))
                      )}
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
          ) : null}
        </main>
      </div>

      {showConnectedNextStepModal && connectedNextStepDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-xl">
            <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Connected next step</p>
            <h3 className="mt-2 text-xl font-semibold">Set the deliberate follow-up plan</h3>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-[#5f5a52]">
                Next stage
                <select
                  value={connectedNextStepDraft.stage}
                  onChange={(event) => {
                    setConnectedNextStepDraft((prev) =>
                      prev ? { ...prev, stage: event.target.value as LeadStage } : prev
                    );
                  }}
                  className="rounded-2xl border border-[#e7e0d0] px-3 py-2 text-[#171717]"
                >
                  {stageOptionsForSelection.map((stage) => (
                    <option key={stage} value={stage}>{stage}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm text-[#5f5a52]">
                Next follow-up date (optional)
                <input
                  type="date"
                  value={connectedNextStepDraft.nextFollowUp}
                  onChange={(event) => {
                    setConnectedNextStepDraft((prev) =>
                      prev ? { ...prev, nextFollowUp: event.target.value } : prev
                    );
                  }}
                  className="rounded-2xl border border-[#e7e0d0] px-3 py-2 text-[#171717]"
                />
              </label>
              {connectedNextStepDraft.stage === "Active Client" ? (
                <label className="flex flex-col gap-2 text-sm text-[#5f5a52] md:col-span-2">
                  Client Side
                  <select
                    value={connectedNextStepDraft.clientSide}
                    onChange={(event) => {
                      setConnectedNextStepDraft((prev) =>
                        prev ? { ...prev, clientSide: event.target.value as LeadClientSide | "" } : prev
                      );
                    }}
                    className="rounded-2xl border border-[#e7e0d0] px-3 py-2 text-[#171717]"
                  >
                    <option value="">Select client side</option>
                    {activeClientSides.map((side) => (
                      <option key={side} value={side}>{side}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="flex flex-col gap-2 text-sm text-[#5f5a52] md:col-span-2">
                Optional context note
                <textarea
                  value={connectedNextStepDraft.note}
                  onChange={(event) => {
                    setConnectedNextStepDraft((prev) =>
                      prev ? { ...prev, note: event.target.value } : prev
                    );
                  }}
                  className="min-h-[96px] rounded-2xl border border-[#e7e0d0] px-3 py-2 text-[#171717]"
                  placeholder="What did you learn and what should happen next?"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  if (connectedNextStepDraft.queueMode) {
                    completeQueueLeadAndAdvance(connectedNextStepDraft.leadId);
                  }
                  setShowConnectedNextStepModal(false);
                  setConnectedNextStepDraft(null);
                }}
                className="rounded-2xl border border-[#e7e0d0] px-4 py-2"
              >
                Skip
              </button>
              <button
                onClick={() => {
                  void saveConnectedNextStep();
                }}
                className="rounded-2xl bg-[#171717] px-4 py-2 text-white"
              >
                Save next step
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showAppointmentModal && appointmentDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-xl">
            <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Appointment outcome</p>
            <h3 className="mt-2 text-xl font-semibold">Save appointment details</h3>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-[#5f5a52]">
                Appointment date
                <input
                  type="date"
                  value={appointmentDraft.date}
                  onChange={(event) => {
                    setAppointmentDraft((prev) =>
                      prev ? { ...prev, date: event.target.value } : prev
                    );
                  }}
                  className="rounded-2xl border border-[#e7e0d0] px-3 py-2 text-[#171717]"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-[#5f5a52]">
                Appointment time (optional)
                <input
                  type="time"
                  value={appointmentDraft.time}
                  onChange={(event) => {
                    setAppointmentDraft((prev) =>
                      prev ? { ...prev, time: event.target.value } : prev
                    );
                  }}
                  className="rounded-2xl border border-[#e7e0d0] px-3 py-2 text-[#171717]"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-[#5f5a52] md:col-span-2">
                Optional note
                <textarea
                  value={appointmentDraft.note}
                  onChange={(event) => {
                    setAppointmentDraft((prev) =>
                      prev ? { ...prev, note: event.target.value } : prev
                    );
                  }}
                  className="min-h-[96px] rounded-2xl border border-[#e7e0d0] px-3 py-2 text-[#171717]"
                  placeholder="Appointment context or preparation notes"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAppointmentModal(false);
                  setAppointmentDraft(null);
                }}
                className="rounded-2xl border border-[#e7e0d0] px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void saveUnifiedAppointmentFlow();
                }}
                className="rounded-2xl bg-[#171717] px-4 py-2 text-white"
              >
                Save appointment
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                {stageOptionsForSelection.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                {!stageOptionsForSelection.includes(draft.stage) ? <option value={draft.stage}>{draft.stage}</option> : null}
              </select>
              {draft.stage === "Active Client" ? (
                <select value={draft.clientSide ?? ""} onChange={(event) => setDraft((prev) => ({ ...prev, clientSide: event.target.value ? (event.target.value as LeadClientSide) : null }))} className="rounded-2xl border border-[#e7e0d0] px-3 py-2">
                  <option value="">Client Side</option>
                  {activeClientSides.map((side) => <option key={side} value={side}>{side}</option>)}
                </select>
              ) : (
                <input value="" readOnly placeholder="Client Side" className="rounded-2xl border border-[#e7e0d0] px-3 py-2 text-[#b7b0a2]" />
              )}
              <input type="date" value={draft.nextFollowUp?.slice(0, 10) ?? ""} onChange={(event) => setDraft((prev) => ({ ...prev, nextFollowUp: event.target.value }))} className="rounded-2xl border border-[#e7e0d0] px-3 py-2" />
              <input value={draft.nextAction} onChange={(event) => setDraft((prev) => ({ ...prev, nextAction: event.target.value }))} placeholder="Next Action" className="rounded-2xl border border-[#e7e0d0] px-3 py-2" />
              <input value={draft.remarks} onChange={(event) => setDraft((prev) => ({ ...prev, remarks: event.target.value }))} placeholder="Remarks" className="rounded-2xl border border-[#e7e0d0] px-3 py-2" />
              <input type="date" value={draft.appointmentDate?.slice(0, 10) ?? ""} onChange={(event) => setDraft((prev) => ({ ...prev, appointmentDate: event.target.value }))} className="rounded-2xl border border-[#e7e0d0] px-3 py-2" />
              <div className="space-y-3 md:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#171717]">Groups</p>
                  <button onClick={() => setShowDraftGroupPicker((prev) => !prev)} className="rounded-full border border-[#e7e0d0] px-3 py-1 text-xs font-semibold">+ Add group</button>
                </div>
                <div>{renderLeadGroupSummary(draft.groups, { limit: 4 })}</div>
                {showDraftGroupPicker ? (
                  <div className="rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-3">
                    <input
                      value={draftGroupSearch}
                      onChange={(event) => setDraftGroupSearch(event.target.value)}
                      placeholder="Search groups"
                      className="w-full rounded-2xl border border-[#e7e0d0] bg-white px-3 py-2 text-sm"
                    />
                    <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                      {draftGroupResults.map((group) => (
                        <label key={group.id} className="flex items-center gap-3 rounded-2xl border border-[#e7e0d0] bg-white px-3 py-2 text-sm">
                          <input type="checkbox" checked={draft.groups.some((item) => item.id === group.id)} onChange={() => toggleDraftGroup(group)} />
                          <span className="rounded-full border px-2 py-1 text-xs font-medium" style={getLeadGroupChipStyle(group.color)}>{group.name}</span>
                        </label>
                      ))}
                      {!draftGroupResults.length ? <p className="text-sm text-[#8a8478]">No groups found.</p> : null}
                    </div>
                    {draftGroupSearch.trim() && !findGroupByName(draftGroupSearch) ? (
                      <button onClick={() => { void createAndAssignGroupToDraft(); }} className="mt-3 rounded-full border border-[#e7e0d0] bg-white px-3 py-2 text-sm font-semibold">
                        + Create "{draftGroupSearch.trim()}"
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            {validationMessage ? <p className="mt-4 text-sm text-[#b08c2c]">{validationMessage}</p> : null}
            {groupUiError ? <p className="mt-2 text-sm text-[#b08c2c]">{groupUiError}</p> : null}
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => { setShowModal(false); setDraft(emptyLead); setValidationMessage(""); }} className="rounded-2xl border border-[#e7e0d0] px-4 py-2">Cancel</button>
              <button onClick={saveDraft} className="rounded-2xl bg-[#171717] px-4 py-2 text-white">Save Lead</button>
            </div>
          </div>
        </div>
      )}

      {showGroupManager ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-[24px] border border-[#e7e0d0] bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-[#b08c2c]">Groups</p>
                <h3 className="mt-2 text-xl font-semibold">Manage groups</h3>
              </div>
              <button onClick={() => setShowGroupManager(false)} className="rounded-full border border-[#e7e0d0] px-3 py-2 text-sm">Close</button>
            </div>
            <div className="mt-6 rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] p-4">
              <p className="text-sm font-semibold text-[#171717]">Create group</p>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_120px_auto]">
                <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Group name" className="rounded-2xl border border-[#e7e0d0] bg-white px-3 py-2" />
                <input type="color" value={newGroupColor} onChange={(event) => setNewGroupColor(event.target.value)} className="h-11 w-full rounded-2xl border border-[#e7e0d0] bg-white px-2 py-2" />
                <button onClick={() => { void createManagedGroup(); }} className="rounded-2xl bg-[#171717] px-4 py-2 text-sm font-semibold text-white">Create</button>
              </div>
            </div>
            {groupUiError ? <p className="mt-4 text-sm text-[#b08c2c]">{groupUiError}</p> : null}
            <div className="mt-6 max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {sortLeadGroups(groups).map((group) => {
                const editor = groupManagerDrafts[group.id] ?? { name: group.name, color: group.color ?? DEFAULT_GROUP_COLOR, isActive: group.isActive };
                return (
                  <div key={group.id} className="rounded-2xl border border-[#e7e0d0] p-4">
                    <div className="grid gap-3 md:grid-cols-[1fr_120px_140px_auto_auto] md:items-center">
                      <input
                        value={editor.name}
                        onChange={(event) => setGroupManagerDrafts((prev) => ({
                          ...prev,
                          [group.id]: { ...editor, name: event.target.value },
                        }))}
                        className="rounded-2xl border border-[#e7e0d0] px-3 py-2"
                      />
                      <input
                        type="color"
                        value={editor.color || DEFAULT_GROUP_COLOR}
                        onChange={(event) => setGroupManagerDrafts((prev) => ({
                          ...prev,
                          [group.id]: { ...editor, color: event.target.value },
                        }))}
                        className="h-11 w-full rounded-2xl border border-[#e7e0d0] bg-white px-2 py-2"
                      />
                      <label className="flex items-center gap-2 text-sm text-[#5f5a52]">
                        <input
                          type="checkbox"
                          checked={editor.isActive}
                          onChange={(event) => setGroupManagerDrafts((prev) => ({
                            ...prev,
                            [group.id]: { ...editor, isActive: event.target.checked },
                          }))}
                        />
                        Active
                      </label>
                      <button onClick={() => { void saveManagedGroup(group.id); }} className="rounded-2xl border border-[#e7e0d0] px-4 py-2 text-sm font-semibold">Save</button>
                      <button onClick={() => { void deleteManagedGroup(group.id); }} className="rounded-2xl border border-[#e7e0d0] px-4 py-2 text-sm font-semibold">Delete</button>
                    </div>
                  </div>
                );
              })}
              {!groups.length ? <p className="text-sm text-[#8a8478]">No groups created yet.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
