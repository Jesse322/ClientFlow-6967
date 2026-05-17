import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { getClient, getOmniSolutions, updateClientOmni } from "@/lib/api";
import { saveOnboardingData, completeOnboarding } from "@/lib/api";
import { useTeamMembers } from "@/hooks/useData";
import { RenewalTimelineModal } from "@/components/renewal-timeline-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, ChevronRight, ArrowLeft, Sparkles,
  AlertCircle, ExternalLink, Save, ClipboardList, Users,
  Building2, FileText, Shield, Zap, Truck, Database, BarChart3, Download
} from "lucide-react";
import type { AirtableRecord, Client, OmniSolution } from "@/lib/types";
import { OMNI_CATEGORIES } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
  notes?: string;
}

interface PlanRow {
  id: string;
  plan: string;
  carrier: string;
  policyNumber: string;
  fundingType: string;
  gaCarrier: string;
  carrierContact: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SETUP_CHECKLIST: ChecklistItem[] = [
  { key: "huddle_done", label: "Internal Huddle with Producer completed", required: true, notes: "Discuss expectations, promises made to client, next steps" },
  { key: "analyst_submitted", label: "Analyst Assignment Request submitted", required: true, notes: "Submit once all carrier docs are in ImageRight" },
  { key: "bp_setup_done", label: "BenefitPoint client setup complete", required: false, notes: "Client added, basic info confirmed" },
  { key: "welcome_kit_sent", label: "New Client Welcome Kit distributed", required: false },
  { key: "ced_setup", label: "CED Annual Setup complete", required: false },
  { key: "post_huddle_done", label: "Post-Onboarding Huddle scheduled", required: false },
  { key: "wrangle_setup", label: "Wrangle setup (if applicable)", required: false, notes: "Required if 100+ ERISA participants — Form 5500 filing" },
  { key: "newsletters_confirmed", label: "Confirmed producer setup for USI newsletters", required: false },
];

const DOCUMENT_CHECKLIST: ChecklistItem[] = [
  { key: "baa_sent", label: "BAA (Business Associate Agreement) sent", required: true },
  { key: "comp_disclosure_sent", label: "Compensation Disclosure sent", required: true, notes: "Prior to BOR letter going to carrier; updated version 60 days later" },
  { key: "bor_letter_sent", label: "BOR Letter to Carrier sent", required: false },
  { key: "booklets_gathered", label: "Plan Booklets / Certificates gathered", required: false },
  { key: "sbc_gathered", label: "SBC (Summary of Benefits and Coverage) gathered", required: false },
  { key: "wrap_spd_gathered", label: "Wrap SPD gathered", required: false },
  { key: "wrap_plan_gathered", label: "Wrap Plan Document gathered", required: false },
  { key: "cafeteria_gathered", label: "Cafeteria Plan Document gathered", required: false },
  { key: "hipaa_gathered", label: "HIPAA Policies and Procedures gathered", required: false },
  { key: "form5500_gathered", label: "Copy of Most Recent Form 5500 gathered", required: false, notes: "Verify prior filing at efast.dol.gov" },
];

const DATA_REQUEST_CHECKLIST: ChecklistItem[] = [
  { key: "census_received", label: "Current Employee Census received", required: false, notes: "Age, gender, zip, dependent status, plan participation, employment status, title, salary" },
  { key: "carrier_contact_received", label: "Carrier Contact Sheet received", required: false },
  { key: "rates_received", label: "Current Premium Rates & Experience Data received", required: false, notes: "Rates, by-month enrollment, paid claims, large claimant reports" },
  { key: "plan_docs_received", label: "Plan documents received (booklets, SPD, contracts)", required: false },
  { key: "schedule_a_received", label: "Schedule A insurance information received", required: false },
];



const VALUE_ADDS: ChecklistItem[] = [
  { key: "brc", label: "BRC (Benefit Resource Center)", required: false, notes: "Only set up once final plan details are in BenefitPoint/ImageRight" },
  { key: "mobile_app", label: "USI Mobile App (MyBenefits2Go)", required: false, notes: "Complete mobile app intake form from EB Hub before setup" },
  { key: "zywave", label: "Zywave Client Cloud", required: false, notes: "Generate Zywave Intake Form from the EB Hub" },
  { key: "usi_3d", label: "USI 3D", required: false },
];

const SECTIONS = [
  { id: "setup", label: "Setup Checklist", icon: ClipboardList },
  { id: "basics", label: "Client Basics", icon: Building2 },
  { id: "omni", label: "OMNI Solutions", icon: Sparkles },
  { id: "eligibility", label: "Eligibility Details", icon: Users },
  { id: "plans", label: "Plans & Products", icon: BarChart3 },
  { id: "valueadds", label: "Value Adds", icon: Zap },
  { id: "vendors", label: "Vendor Information", icon: Truck },
  { id: "documents", label: "Document Checklist", icon: FileText },
  { id: "datarequest", label: "Data Request", icon: Database },
];

// ─── Required field check ──────────────────────────────────────────────────

function countRequired(data: Record<string, any>, client: AirtableRecord<Client> | null): [number, number] {
  // [completed, total]
  const checks = [
    // Setup
    ...SETUP_CHECKLIST.filter(i => i.required).map(i => ({ key: i.key, done: !!data[i.key] })),
    // Documents
    ...DOCUMENT_CHECKLIST.filter(i => i.required).map(i => ({ key: i.key, done: !!data[i.key] })),
    // Team (from client record)
    { key: "service_lead", done: !!(client?.fields["Service Lead"]?.length) },
    { key: "producer", done: !!(client?.fields["Producer"]?.length) },
    // OMNI defaults confirmed
    { key: "omni_confirmed", done: !!data["omni_confirmed"] },
  ];
  return [checks.filter(c => c.done).length, checks.length];
}

// ─── Debounce ─────────────────────────────────────────────────────────────────

function useDebounce<T extends (...args: any[]) => any>(fn: T, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback((...args: Parameters<T>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const [, params] = useRoute("/clients/:id/onboard");
  const clientId = params?.id;
  const [, setLocation] = useLocation();

  const [client, setClient] = useState<AirtableRecord<Client> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [activeSection, setActiveSection] = useState("setup");
  const [renewalOpen, setRenewalOpen] = useState(false);
  const [renewalDone, setRenewalDone] = useState(false);

  // Onboarding data blob — seeded from client.fields["Onboarding Data"]
  const [data, setData] = useState<Record<string, any>>({});
  // BOR date stored separately (top-level DB column)
  const [borDate, setBorDate] = useState("");
  const [contacts, setContacts] = useState<{ name: string; email: string; phone: string; title: string; notes: string }[]>([
    { name: "", email: "", phone: "", title: "", notes: "" }
  ]);
  const [plans, setPlans] = useState<PlanRow[]>([
    { id: "1", plan: "", carrier: "", policyNumber: "", fundingType: "", gaCarrier: "", carrierContact: "" }
  ]);
  // omniSelectedIds: Airtable record IDs — synced to client.fields["OMNI Solutions"]
  const [omniSelectedIds, setOmniSelectedIds] = useState<string[]>([]);
  const [omniSolutions, setOmniSolutions] = useState<AirtableRecord<OmniSolution>[]>([]);
  const [omniLoading, setOmniLoading] = useState(false);

  const loadClient = useCallback(() => {
    if (!clientId) return;
    setLoading(true);
    getClient(clientId).then((c) => {
      setClient(c);
      const od = c.fields["Onboarding Data"] || {};

      // Seed from client fields if onboarding data is empty / first time
      const seeded: Record<string, any> = { ...od };
      if (!od.renewal_date && c.fields["Renewal Date"]) seeded.renewal_date = c.fields["Renewal Date"];
      if (!od.funding_strategy && c.fields["Funding Strategy"]) seeded.funding_strategy = c.fields["Funding Strategy"] as string;
      if (!od.company_size && c.fields["Company Size"]) seeded.company_size = c.fields["Company Size"] as string;
      if (!od.segment && c.fields["Segment"]) seeded.segment = c.fields["Segment"] as string;
      if (!od.location && c.fields["Location"]) seeded.location = c.fields["Location"] as string;
      if (!od.revenue && c.fields["Revenue"]) seeded.revenue = c.fields["Revenue"];
      if (!od.medical_carrier && (c.fields["Medical Carrier/TPA"] as string[])?.length)
        seeded.medical_carrier = (c.fields["Medical Carrier/TPA"] as string[]).join(", ");
      if (!od.ancillary_carrier && (c.fields["Ancillary Carrier"] as string[])?.length)
        seeded.ancillary_carrier = (c.fields["Ancillary Carrier"] as string[]).join(", ");
      if (!od.intake_notes && c.fields["Intake Notes"]) seeded.intake_notes = c.fields["Intake Notes"] as string;
      // Self funded fields
      if (!od.peo_name_onboard && c.fields["PEO Name"]) seeded.peo_name_onboard = c.fields["PEO Name"] as string;
      if (!od.tpa_name && c.fields["TPA Name"]) seeded.tpa_name = c.fields["TPA Name"] as string;
      if (!od.pbm && c.fields["PBM"]) seeded.pbm = c.fields["PBM"] as string;
      if (!od.stop_loss && c.fields["Stop Loss"]) seeded.stop_loss = c.fields["Stop Loss"] as string;
      if (!od.sf_arrangement && c.fields["SF Arrangement"]) seeded.sf_arrangement = c.fields["SF Arrangement"] as string;

      setData(seeded);
      setBorDate(c.fields["BOR Date"] || "");
      if (od.contacts?.length) setContacts(od.contacts);
      if (od.plans?.length) setPlans(od.plans);
      // Seed OMNI IDs from the actual client field (source of truth)
      const existingOmni: string[] = c.fields["OMNI Solutions"] || [];
      setOmniSelectedIds(existingOmni);
    }).catch(() => toast.error("Failed to load client"))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { loadClient(); }, [loadClient]);

  // Load OMNI solutions once (lazy — fetch when section is first visited)
  useEffect(() => {
    if (activeSection !== "omni" || omniSolutions.length > 0) return;
    setOmniLoading(true);
    getOmniSolutions()
      .then(setOmniSolutions)
      .catch(() => toast.error("Failed to load OMNI solutions"))
      .finally(() => setOmniLoading(false));
  }, [activeSection, omniSolutions.length]);

  // Team members for PDF name resolution
  const { data: teamMembers } = useTeamMembers();
  const teamMemberMap = useMemo(() => {
    const map: Record<string, string> = {};
    (teamMembers || []).forEach((m) => { map[m.id] = m.fields["Full Name"] || ""; });
    return map;
  }, [teamMembers]);

  // ── Auto-save ──────────────────────────────────────────────────────────────

  const doSave = useCallback(async (patch: Record<string, any>) => {
    if (!clientId) return;
    setSaving(true);
    try {
      await saveOnboardingData(clientId, patch);
    } catch {
      // silent — don't toast on every keystroke
    } finally {
      setSaving(false);
    }
  }, [clientId]);

  const debouncedSave = useDebounce(doSave, 800);

  const updateData = (patch: Record<string, any>) => {
    const next = { ...data, ...patch };
    setData(next);
    debouncedSave(next);
  };

  const updateContacts = (newContacts: typeof contacts) => {
    setContacts(newContacts);
    const next = { ...data, contacts: newContacts };
    setData(next);
    debouncedSave(next);
  };

  const updatePlans = (newPlans: PlanRow[]) => {
    setPlans(newPlans);
    const next = { ...data, plans: newPlans };
    setData(next);
    debouncedSave(next);
  };

  const updateOmni = (newIds: string[]) => {
    if (!clientId) return;
    setOmniSelectedIds(newIds);
    // Update OMNI Solutions on client record (source of truth)
    updateClientOmni(clientId, newIds).catch(() => toast.error("Failed to save OMNI selections"));
    // Also mark confirmed in onboarding data blob
    const next = { ...data, omni_confirmed: newIds.length > 0 };
    setData(next);
    debouncedSave(next);
  };

  const handleBorDate = (val: string) => {
    setBorDate(val);
    if (!clientId) return;
    fetch(`/api/clients/${clientId}/onboarding`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bor_date: val }),
    }).catch(() => {});
  };

  // ── Complete ───────────────────────────────────────────────────────────────

  const handleComplete = async () => {
    if (!clientId) return;
    setCompleting(true);
    try {
      await completeOnboarding(clientId);
      toast.success("Onboarding complete!");
      // Auto-generate onboarding PDF
      if (client) {
        try {
          const { downloadOnboardingPDF } = await import("@/lib/onboarding-pdf");
          await downloadOnboardingPDF(client, teamMemberMap);
        } catch {
          // PDF generation is non-blocking — don't fail completion
          console.warn("Onboarding PDF generation failed");
        }
      }
      setRenewalOpen(true);
    } catch (e: any) {
      toast.error("Failed to complete onboarding: " + e.message);
    } finally {
      setCompleting(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!client) return;
    try {
      const { downloadOnboardingPDF } = await import("@/lib/onboarding-pdf");
      await downloadOnboardingPDF(client, teamMemberMap);
      toast.success("PDF downloaded");
    } catch {
      toast.error("Failed to generate PDF");
    }
  };

  const handleRenewalDone = () => {
    setRenewalDone(true);
    setRenewalOpen(false);
    setLocation(`/clients/${clientId}`);
  };

  const handleSkipRenewal = () => {
    setRenewalOpen(false);
    setLocation(`/clients/${clientId}`);
  };

  // ── Progress ───────────────────────────────────────────────────────────────
  const [completed, total] = countRequired(data, client);
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const canComplete = completed >= total;

  if (!clientId) {
    return <div className="py-12 text-center text-slate-500">Invalid onboarding URL.</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!client) {
    return <div className="py-12 text-center text-slate-500">Client not found.</div>;
  }

  const clientName = client.fields["Client Name"] as string;

  return (
    <div className="max-w-6xl mx-auto pb-24 md:pb-0">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <button
            onClick={() => setLocation(`/clients/${clientId}`)}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-1.5"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Client
          </button>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 leading-tight">{clientName}</h1>
          <p className="text-slate-500 text-sm mt-0.5">New Client Onboarding Setup</p>
        </div>
        <div className="flex items-center gap-2 md:gap-3 flex-wrap justify-end">
          {saving && (
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Save className="w-3 h-3" /> Saving…
            </span>
          )}
          <button
            onClick={handleDownloadPDF}
            className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1 underline underline-offset-2"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Download PDF</span>
          </button>
          <button
            onClick={() => setLocation(`/clients/${clientId}`)}
            className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2 hidden sm:inline"
          >
            Skip
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-xl border border-slate-100 p-3 md:p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700">Required steps completed</span>
          <span className="text-sm font-semibold text-slate-900">{completed} / {total}</span>
        </div>
        <Progress value={pct} className="h-2" />
        {!canComplete && (
          <p className="text-xs text-slate-400 mt-1.5">Complete all required items to finish onboarding</p>
        )}
      </div>

      {/* Mobile section tabs — horizontal scroll */}
      <div className="md:hidden mb-4 -mx-4 px-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide snap-x">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = activeSection === s.id;
            const hasRequired = s.id === "setup" || s.id === "documents";
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors snap-start shrink-0 border",
                  isActive
                    ? "bg-sky-600 text-white border-sky-600 font-medium"
                    : "bg-white text-slate-600 border-slate-200 hover:border-sky-300"
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {s.label}
                {hasRequired && <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left nav — desktop only */}
        <div className="hidden md:block w-52 shrink-0">
          <div className="sticky top-6 space-y-0.5">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = activeSection === s.id;
              const hasRequired = s.id === "setup" || s.id === "documents";
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                    isActive
                      ? "bg-sky-50 text-sky-700 font-medium"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{s.label}</span>
                  {hasRequired && <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />}
                  {isActive && <ChevronRight className="w-3 h-3 shrink-0" />}
                </button>
              );
            })}

            {/* Complete button in sidebar on larger screens */}
            <div className="pt-4">
              <Button
                onClick={handleComplete}
                disabled={!canComplete || completing}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                title={!canComplete ? `${total - completed} required item(s) still needed` : undefined}
              >
                {completing ? "Completing…" : "Complete Onboarding"}
              </Button>
              {!canComplete && (
                <p className="text-xs text-slate-400 mt-1.5 text-center">
                  {total - completed} required item{total - completed !== 1 ? "s" : ""} remaining
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-4 md:space-y-6">

          {/* ── Setup Checklist ── */}
          {activeSection === "setup" && (
            <Section title="Setup Checklist" icon={ClipboardList}>
              <p className="text-sm text-slate-500 mb-4">
                Track key setup tasks. These also appear as <strong>Deliverables</strong> on the client page — mark them complete there when done. Items marked <RequiredDot /> are required to complete onboarding.
              </p>
              <div className="space-y-2">
                {SETUP_CHECKLIST.map((item) => (
                  <CheckRow
                    key={item.key}
                    item={item}
                    checked={!!data[item.key]}
                    onChange={(v) => updateData({ [item.key]: v })}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* ── Client Basics ── */}
          {activeSection === "basics" && (
            <Section title="Client Basics" icon={Building2}>
              <div className="space-y-4">

                {/* ── Assigned Team ── */}
                <div className="border border-slate-100 rounded-xl p-3 space-y-3 bg-slate-50/50">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Assigned Team</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label>Producer <RequiredDot /></Label>
                      <div className="mt-1 px-3 py-2 rounded-md border border-slate-200 bg-white text-sm text-slate-700 min-h-[36px]">
                        {(client?.fields["Producer"] || []).map((id) => teamMemberMap[id] || id).join(", ") || (
                          <span className="text-slate-400 italic">Not assigned</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Set on the client record</p>
                    </div>
                    <div>
                      <Label>Primary Service Lead <RequiredDot /></Label>
                      <div className="mt-1 px-3 py-2 rounded-md border border-slate-200 bg-white text-sm text-slate-700 min-h-[36px]">
                        {(client?.fields["Service Lead"] || []).map((id) => teamMemberMap[id] || id).join(", ") || (
                          <span className="text-slate-400 italic">Not assigned</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Set on the client record</p>
                    </div>
                    <div>
                      <Label>Onboarding Specialist</Label>
                      <select
                        value={data.onboarding_specialist_id || ""}
                        onChange={(e) => updateData({ onboarding_specialist_id: e.target.value || null })}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      >
                        <option value="">— Select —</option>
                        {(teamMembers || [])
                          .slice()
                          .sort((a, b) => (a.fields["Full Name"] || "").localeCompare(b.fields["Full Name"] || ""))
                          .map((m) => (
                            <option key={m.id} value={m.id}>{m.fields["Full Name"]}</option>
                          ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Pre-filled notice */}
                {(data.renewal_date || data.funding_strategy || data.medical_carrier) && (
                  <div className="flex items-start gap-2 text-xs text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2">
                    <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    Some fields were pre-filled from your intake form. Review and update as needed.
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Renewal Date <HelpfulDot /></Label>
                    <Input
                      type="date"
                      value={data.renewal_date || ""}
                      onChange={(e) => updateData({ renewal_date: e.target.value })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>BOR Date <HelpfulDot /></Label>
                    <Input
                      type="date"
                      value={borDate}
                      onChange={(e) => handleBorDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label>Funding Strategy <HelpfulDot /></Label>
                    <Input value={data.funding_strategy || ""} onChange={(e) => updateData({ funding_strategy: e.target.value })} className="mt-1" placeholder="e.g. Fully Insured" />
                  </div>
                  <div>
                    <Label>Company Size <HelpfulDot /></Label>
                    <Input value={data.company_size || ""} onChange={(e) => updateData({ company_size: e.target.value })} className="mt-1" placeholder="e.g. 50-99" />
                  </div>
                  <div>
                    <Label>Segment <HelpfulDot /></Label>
                    <Input value={data.segment || ""} onChange={(e) => updateData({ segment: e.target.value })} className="mt-1" placeholder="e.g. Middle Market" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Medical Carrier / TPA <HelpfulDot /></Label>
                    <Input value={data.medical_carrier || ""} onChange={(e) => updateData({ medical_carrier: e.target.value })} className="mt-1" placeholder="e.g. Blue Cross, Aetna" />
                  </div>
                  <div>
                    <Label>Ancillary Carrier <HelpfulDot /></Label>
                    <Input value={data.ancillary_carrier || ""} onChange={(e) => updateData({ ancillary_carrier: e.target.value })} className="mt-1" placeholder="e.g. Guardian, MetLife" />
                  </div>
                </div>
                {(data.funding_strategy === "Self Funded") && (
                  <div className="border border-violet-100 bg-violet-50/50 rounded-xl p-3 space-y-3">
                    <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide">Self Funded Details</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label>Arrangement</Label>
                        <Input value={data.sf_arrangement || ""} onChange={(e) => updateData({ sf_arrangement: e.target.value })} className="mt-1" placeholder="e.g. Captive, Bundled" />
                      </div>
                      <div>
                        <Label>TPA Name</Label>
                        <Input value={data.tpa_name || ""} onChange={(e) => updateData({ tpa_name: e.target.value })} className="mt-1" />
                      </div>
                      <div>
                        <Label>PBM</Label>
                        <Input value={data.pbm || ""} onChange={(e) => updateData({ pbm: e.target.value })} className="mt-1" />
                      </div>
                      <div>
                        <Label>Stop Loss</Label>
                        <Input value={data.stop_loss || ""} onChange={(e) => updateData({ stop_loss: e.target.value })} className="mt-1" />
                      </div>
                    </div>
                  </div>
                )}
                {(data.funding_strategy === "PEO") && (
                  <div className="border border-sky-100 bg-sky-50/50 rounded-xl p-3">
                    <p className="text-xs font-semibold text-sky-600 uppercase tracking-wide mb-2">PEO Details</p>
                    <Label>PEO Name</Label>
                    <Input value={data.peo_name_onboard || ""} onChange={(e) => updateData({ peo_name_onboard: e.target.value })} className="mt-1" />
                  </div>
                )}
                {data.intake_notes && (
                  <div>
                    <Label>Intake Notes <HelpfulDot /></Label>
                    <Textarea value={data.intake_notes || ""} onChange={(e) => updateData({ intake_notes: e.target.value })} rows={3} className="mt-1" />
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Est. Annual Revenue Effective Date <HelpfulDot /></Label>
                    <Input
                      type="date"
                      value={data.revenue_eff_date || ""}
                      onChange={(e) => updateData({ revenue_eff_date: e.target.value })}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Account Marketing Name <HelpfulDot /></Label>
                    <Input value={data.marketing_name || ""} onChange={(e) => updateData({ marketing_name: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label>Parent Account <HelpfulDot /></Label>
                    <Input value={data.parent_account || ""} onChange={(e) => updateData({ parent_account: e.target.value })} className="mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label>Ownership Type <HelpfulDot /></Label>
                    <Input value={data.ownership_type || ""} onChange={(e) => updateData({ ownership_type: e.target.value })} className="mt-1" placeholder="e.g. Private, Public" />
                  </div>
                  <div>
                    <Label>Business Structure <HelpfulDot /></Label>
                    <Input value={data.business_structure || ""} onChange={(e) => updateData({ business_structure: e.target.value })} className="mt-1" placeholder="e.g. LLC, Corp" />
                  </div>
                  <div>
                    <Label>P&C Client? <HelpfulDot /></Label>
                    <div className="flex items-center gap-2 mt-2">
                      <Switch checked={!!data.pc_client} onCheckedChange={(v) => updateData({ pc_client: v })} />
                      <span className="text-sm text-slate-600">{data.pc_client ? "Yes" : "No"}</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label>Total Employees <HelpfulDot /></Label>
                    <Input type="number" value={data.total_employees || ""} onChange={(e) => updateData({ total_employees: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label>Tax ID Number <HelpfulDot /></Label>
                    <Input value={data.tax_id || ""} onChange={(e) => updateData({ tax_id: e.target.value })} className="mt-1" placeholder="XX-XXXXXXX" />
                  </div>
                  <div>
                    <Label>NAICS Code <HelpfulDot /></Label>
                    <Input value={data.naics || ""} onChange={(e) => updateData({ naics: e.target.value })} className="mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Main Phone <HelpfulDot /></Label>
                    <Input value={data.main_phone || ""} onChange={(e) => updateData({ main_phone: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label>Website <HelpfulDot /></Label>
                    <Input value={data.website || ""} onChange={(e) => updateData({ website: e.target.value })} className="mt-1" placeholder="https://" />
                  </div>
                </div>

                {/* Contacts */}
                <div className="border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-slate-700">Client Contacts <HelpfulDot /></p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateContacts([...contacts, { name: "", email: "", phone: "", title: "", notes: "" }])}
                    >
                      + Add Contact
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {contacts.map((c, i) => (
                      <div key={i} className="border border-slate-100 rounded-xl p-3 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Input placeholder="Name" value={c.name} onChange={(e) => {
                            const n = [...contacts]; n[i] = { ...n[i], name: e.target.value }; updateContacts(n);
                          }} />
                          <Input placeholder="Title" value={c.title} onChange={(e) => {
                            const n = [...contacts]; n[i] = { ...n[i], title: e.target.value }; updateContacts(n);
                          }} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Input placeholder="Email" value={c.email} onChange={(e) => {
                            const n = [...contacts]; n[i] = { ...n[i], email: e.target.value }; updateContacts(n);
                          }} />
                          <Input placeholder="Phone" value={c.phone} onChange={(e) => {
                            const n = [...contacts]; n[i] = { ...n[i], phone: e.target.value }; updateContacts(n);
                          }} />
                        </div>
                        <div className="flex gap-2">
                          <Input placeholder="Notes" value={c.notes} className="flex-1" onChange={(e) => {
                            const n = [...contacts]; n[i] = { ...n[i], notes: e.target.value }; updateContacts(n);
                          }} />
                          {contacts.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-400 hover:text-red-600 px-2"
                              onClick={() => updateContacts(contacts.filter((_, j) => j !== i))}
                            >
                              ✕
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Section>
          )}

          {/* ── OMNI Solutions ── */}
          {activeSection === "omni" && (
            <Section title="OMNI Solutions" icon={Sparkles}>
              <p className="text-sm text-slate-500 mb-4">
                Select which OMNI solutions this client will receive. Changes save instantly to the OMNI Solutions tab. <RequiredDot />
              </p>
              {omniLoading ? (
                <div className="text-sm text-slate-400 py-4 text-center">Loading solutions…</div>
              ) : omniSolutions.length === 0 ? (
                <div className="text-sm text-slate-400 py-4 text-center">No OMNI solutions found.</div>
              ) : (
                <div className="space-y-5">
                  {OMNI_CATEGORIES.map((cat) => {
                    const solutions = omniSolutions.filter((s) => s.fields[cat]);
                    if (solutions.length === 0) return null;
                    return (
                      <div key={cat}>
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                          {cat.replace("OMNI - ", "")}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {solutions.map((sol) => {
                            const isChecked = omniSelectedIds.includes(sol.id);
                            const label = sol.fields[cat] as string;
                            return (
                              <label
                                key={sol.id}
                                className={cn(
                                  "flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors text-sm",
                                  isChecked ? "bg-sky-50 border-sky-200" : "border-slate-100 hover:bg-slate-50"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...omniSelectedIds, sol.id]
                                      : omniSelectedIds.filter((id) => id !== sol.id);
                                    updateOmni(next);
                                  }}
                                  className="mt-0.5 accent-sky-600"
                                />
                                <span className="flex-1 leading-snug">{label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3">
                <span className="text-xs text-slate-500">{omniSelectedIds.length} solution{omniSelectedIds.length !== 1 ? "s" : ""} selected</span>
              </div>
            </Section>
          )}

          {/* ── Eligibility Details ── */}
          {activeSection === "eligibility" && (
            <Section title="Eligibility Details" icon={Users}>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Waiting Period <HelpfulDot /></Label>
                    <Input value={data.waiting_period || ""} onChange={(e) => updateData({ waiting_period: e.target.value })} placeholder="e.g. 30 days, 1st of month after hire" className="mt-1" />
                  </div>
                  <div>
                    <Label>Number of Benefit Classes <HelpfulDot /></Label>
                    <Input type="number" value={data.benefit_classes || ""} onChange={(e) => updateData({ benefit_classes: e.target.value })} className="mt-1" />
                  </div>
                </div>
                <div>
                  <Label>Does Waiting Period Differ by Class? <HelpfulDot /></Label>
                  <Textarea value={data.waiting_period_notes || ""} onChange={(e) => updateData({ waiting_period_notes: e.target.value })} rows={2} placeholder="Explain if applicable…" className="mt-1" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Eligibility Rules Same for All Lines? <HelpfulDot /></Label>
                    <div className="flex items-center gap-2 mt-2">
                      <Switch checked={data.elig_same_all_lines !== false} onCheckedChange={(v) => updateData({ elig_same_all_lines: v })} />
                      <span className="text-sm text-slate-600">{data.elig_same_all_lines !== false ? "Yes" : "No"}</span>
                    </div>
                  </div>
                  <div>
                    <Label>Spouse/Domestic Partner Coverage <HelpfulDot /></Label>
                    <div className="flex items-center gap-2 mt-2">
                      <Switch checked={!!data.spouse_coverage} onCheckedChange={(v) => updateData({ spouse_coverage: v })} />
                      <span className="text-sm text-slate-600">{data.spouse_coverage ? "Yes" : "No"}</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Dependent Eligibility Age Other Than 26? <HelpfulDot /></Label>
                    <Input value={data.dependent_age || ""} onChange={(e) => updateData({ dependent_age: e.target.value })} placeholder="Leave blank if age 26" className="mt-1" />
                  </div>
                  <div>
                    <Label>Number of Pay Periods <HelpfulDot /></Label>
                    <Input type="number" value={data.pay_periods || ""} onChange={(e) => updateData({ pay_periods: e.target.value })} className="mt-1" placeholder="e.g. 24, 26, 52" />
                  </div>
                </div>
                <div>
                  <Label>When Does Coverage End? <HelpfulDot /></Label>
                  <Input value={data.coverage_end || ""} onChange={(e) => updateData({ coverage_end: e.target.value })} placeholder="e.g. Last day of month following termination" className="mt-1" />
                </div>
                <div>
                  <Label>Non-English Speakers? <HelpfulDot /></Label>
                  <Textarea value={data.non_english_notes || ""} onChange={(e) => updateData({ non_english_notes: e.target.value })} rows={2} placeholder="Languages — affects SPD/legal notice requirements…" className="mt-1" />
                </div>
                <div>
                  <Label>Approximate Turnover <HelpfulDot /></Label>
                  <Input value={data.turnover || ""} onChange={(e) => updateData({ turnover: e.target.value })} placeholder="e.g. 15% annual" className="mt-1" />
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={!!data.union_employees} onCheckedChange={(v) => updateData({ union_employees: v })} />
                  <Label>Union / Service Contract Act / Davis-Bacon Employees</Label>
                </div>
              </div>
            </Section>
          )}

          {/* ── Plans & Products ── */}
          {activeSection === "plans" && (
            <Section title="Plans & Products" icon={BarChart3}>
              <p className="text-sm text-slate-500 mb-4">
                Add current plans. Carrier and GA info helps with BenefitPoint setup. <HelpfulDot />
              </p>
              <div className="space-y-3">
                {plans.map((p, i) => (
                  <div key={p.id} className="border border-slate-100 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Plan {i + 1}</span>
                      {plans.length > 1 && (
                        <button
                          onClick={() => updatePlans(plans.filter((_, j) => j !== i))}
                          className="text-xs text-red-400 hover:text-red-600"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <Input placeholder="Plan type (e.g. Medical, Dental)" value={p.plan} onChange={(e) => {
                        const n = [...plans]; n[i] = { ...n[i], plan: e.target.value }; updatePlans(n);
                      }} />
                      <Input placeholder="Carrier" value={p.carrier} onChange={(e) => {
                        const n = [...plans]; n[i] = { ...n[i], carrier: e.target.value }; updatePlans(n);
                      }} />
                      <Input placeholder="Policy Number" value={p.policyNumber} onChange={(e) => {
                        const n = [...plans]; n[i] = { ...n[i], policyNumber: e.target.value }; updatePlans(n);
                      }} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <Input placeholder="Funding Type" value={p.fundingType} onChange={(e) => {
                        const n = [...plans]; n[i] = { ...n[i], fundingType: e.target.value }; updatePlans(n);
                      }} />
                      <Input placeholder="GA / Carrier" value={p.gaCarrier} onChange={(e) => {
                        const n = [...plans]; n[i] = { ...n[i], gaCarrier: e.target.value }; updatePlans(n);
                      }} />
                      <Input placeholder="Carrier Contact" value={p.carrierContact} onChange={(e) => {
                        const n = [...plans]; n[i] = { ...n[i], carrierContact: e.target.value }; updatePlans(n);
                      }} />
                    </div>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => updatePlans([...plans, { id: String(Date.now()), plan: "", carrier: "", policyNumber: "", fundingType: "", gaCarrier: "", carrierContact: "" }])}
              >
                + Add Plan
              </Button>

              {/* Enrollment method */}
              <div className="border-t border-slate-100 pt-4 mt-4">
                <p className="text-sm font-semibold text-slate-700 mb-3">Enrollment Method <HelpfulDot /></p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Enrollment System</Label>
                    <Input value={data.enrollment_system || ""} onChange={(e) => updateData({ enrollment_system: e.target.value })} placeholder="e.g. Ben Admin, Paper Forms, Carrier Direct" className="mt-1" />
                  </div>
                  <div>
                    <Label>Ben Admin Platform (if applicable)</Label>
                    <Input value={data.ben_admin_platform || ""} onChange={(e) => updateData({ ben_admin_platform: e.target.value })} placeholder="e.g. Ease, Employee Navigator" className="mt-1" />
                  </div>
                </div>
              </div>
            </Section>
          )}

          {/* ── Value Adds ── */}
          {activeSection === "valueadds" && (
            <Section title="Value Adds" icon={Zap}>
              <p className="text-sm text-slate-500 mb-4">
                Indicate which value adds this client will receive. Ideal implementation is within 90 days. <HelpfulDot />
              </p>
              <div className="space-y-2">
                {VALUE_ADDS.map((item) => (
                  <div key={item.key} className={cn(
                    "flex items-start gap-3 p-3 rounded-xl border transition-colors",
                    data[`va_${item.key}`] ? "bg-sky-50 border-sky-200" : "border-slate-100"
                  )}>
                    <Switch
                      checked={!!data[`va_${item.key}`]}
                      onCheckedChange={(v) => updateData({ [`va_${item.key}`]: v })}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-800">{item.label}</p>
                      {item.notes && <p className="text-xs text-slate-500 mt-0.5">{item.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── Vendor Info ── */}
          {activeSection === "vendors" && (
            <Section title="Vendor Information" icon={Truck}>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>COBRA Vendor <HelpfulDot /></Label>
                    <Input value={data.cobra_vendor || ""} onChange={(e) => updateData({ cobra_vendor: e.target.value })} className="mt-1" placeholder="Vendor name or N/A" />
                  </div>
                  <div>
                    <Label>SPD / Wrap Vendor <HelpfulDot /></Label>
                    <Input value={data.spd_wrap_vendor || ""} onChange={(e) => updateData({ spd_wrap_vendor: e.target.value })} className="mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>HSA / FSA Vendor <HelpfulDot /></Label>
                    <Input value={data.hsa_fsa_vendor || ""} onChange={(e) => updateData({ hsa_fsa_vendor: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label>5500 Vendor <HelpfulDot /></Label>
                    <Input value={data.vendor_5500 || ""} onChange={(e) => updateData({ vendor_5500: e.target.value })} className="mt-1" placeholder="e.g. Wrangle, or N/A" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>LOA Vendor <HelpfulDot /></Label>
                    <Input value={data.loa_vendor || ""} onChange={(e) => updateData({ loa_vendor: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label>Payroll Company <HelpfulDot /></Label>
                    <Input value={data.payroll_company || ""} onChange={(e) => updateData({ payroll_company: e.target.value })} className="mt-1" />
                  </div>
                </div>
                <div>
                  <Label>Payroll Cycle <HelpfulDot /></Label>
                  <Input value={data.payroll_cycle || ""} onChange={(e) => updateData({ payroll_cycle: e.target.value })} className="mt-1" placeholder="e.g. Bi-weekly, Semi-monthly" />
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={!!data.section_125} onCheckedChange={(v) => updateData({ section_125: v })} />
                  <Label>Section 125 / POP Document in place</Label>
                </div>

                {/* PEO */}
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-sm font-semibold text-slate-700 mb-3">PEO <HelpfulDot /></p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>With a PEO?</Label>
                      <div className="flex items-center gap-2 mt-2">
                        <Switch checked={!!data.with_peo} onCheckedChange={(v) => updateData({ with_peo: v })} />
                        <span className="text-sm text-slate-600">{data.with_peo ? "Yes" : "No"}</span>
                      </div>
                    </div>
                    {data.with_peo && (
                      <div>
                        <Label>PEO Name</Label>
                        <Input value={data.peo_name_onboard || ""} onChange={(e) => updateData({ peo_name_onboard: e.target.value })} className="mt-1" />
                      </div>
                    )}
                  </div>
                  {data.with_peo && (
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label>PEO Benefit Carve-out?</Label>
                        <div className="flex items-center gap-2 mt-2">
                          <Switch checked={!!data.peo_carveout} onCheckedChange={(v) => updateData({ peo_carveout: v })} />
                          <span className="text-sm text-slate-600">{data.peo_carveout ? "Yes" : "No"}</span>
                        </div>
                      </div>
                      <div>
                        <Label>Terminating PEO?</Label>
                        <div className="flex items-center gap-2 mt-2">
                          <Switch checked={!!data.terminating_peo} onCheckedChange={(v) => updateData({ terminating_peo: v })} />
                          <span className="text-sm text-slate-600">{data.terminating_peo ? "Yes" : "No"}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Section>
          )}

          {/* ── Document Checklist ── */}
          {activeSection === "documents" && (
            <Section title="Document Checklist" icon={FileText}>
              <p className="text-sm text-slate-500 mb-1">
                Track which documents have been sent to / received from the client. Items marked <RequiredDot /> are required to complete onboarding.
              </p>
              <p className="text-xs text-slate-400 mb-4">These also appear as Deliverables on the client page.</p>

              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Documents to Send</p>
              <div className="space-y-2 mb-5">
                <CheckRow
                  item={{ key: "baa_sent", label: "BAA and Client Agreement sent", required: true, notes: "Business Associate Agreement" }}
                  checked={!!data.baa_sent}
                  onChange={(v) => updateData({ baa_sent: v })}
                />
                <CheckRow
                  item={{ key: "comp_disclosure_sent", label: "Compensation Disclosure sent", required: true, notes: "Prior to BOR letter; update again 60 days later" }}
                  checked={!!data.comp_disclosure_sent}
                  onChange={(v) => updateData({ comp_disclosure_sent: v })}
                />
                <CheckRow
                  item={{ key: "bor_letter_sent", label: "BOR Letter to Carrier sent", required: false }}
                  checked={!!data.bor_letter_sent}
                  onChange={(v) => updateData({ bor_letter_sent: v })}
                />
                <CheckRow
                  item={{ key: "logo_release_sent", label: "Client Logo Release sent", required: false }}
                  checked={!!data.logo_release_sent}
                  onChange={(v) => updateData({ logo_release_sent: v })}
                />
              </div>

              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Plan Documents to Gather</p>
              <div className="space-y-2 mb-5">
                {DOCUMENT_CHECKLIST.slice(3).map((item) => (
                  <CheckRow
                    key={item.key}
                    item={item}
                    checked={!!data[item.key]}
                    onChange={(v) => updateData({ [item.key]: v })}
                  />
                ))}
              </div>

              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Plan Sponsor Type</p>
              <div className="flex gap-4 mb-4">
                {["Private", "Government", "Church"].map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="plan_sponsor_type"
                      value={t}
                      checked={data.plan_sponsor_type === t}
                      onChange={() => updateData({ plan_sponsor_type: t })}
                      className="accent-sky-600"
                    />
                    <span className="text-sm text-slate-700">{t}</span>
                  </label>
                ))}
              </div>
            </Section>
          )}

          {/* ── Data Request ── */}
          {activeSection === "datarequest" && (
            <Section title="Data Request" icon={Database}>
              <p className="text-sm text-slate-500 mb-4">
                Track status of data items needed from the client. <HelpfulDot />
              </p>
              <div className="space-y-2">
                {DATA_REQUEST_CHECKLIST.map((item) => (
                  <CheckRow
                    key={item.key}
                    item={item}
                    checked={!!data[item.key]}
                    onChange={(v) => updateData({ [item.key]: v })}
                  />
                ))}
              </div>
              <div className="border-t border-slate-100 pt-4 mt-4">
                <Label>Additional Notes <HelpfulDot /></Label>
                <Textarea
                  value={data.data_request_notes || ""}
                  onChange={(e) => updateData({ data_request_notes: e.target.value })}
                  rows={3}
                  placeholder="Any special data requirements, known gaps, or follow-up items…"
                  className="mt-1"
                />
              </div>
            </Section>
          )}

          {/* Bottom Complete bar — desktop only */}
          <div className="hidden md:flex sticky bottom-0 bg-white border-t border-slate-100 rounded-b-xl p-4 items-center justify-between">
            <div className="flex items-center gap-3">
              {canComplete ? (
                <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4" /> All required items complete
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-amber-600 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {total - completed} required item{total - completed !== 1 ? "s" : ""} remaining
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleDownloadPDF}>
                <Download className="w-4 h-4 mr-1.5" /> Download PDF
              </Button>
              <Button variant="outline" onClick={() => setLocation(`/clients/${clientId}`)}>
                Skip to Client View
              </Button>
              <Button
                onClick={handleComplete}
                disabled={!canComplete || completing}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {completing ? "Completing…" : "Complete Onboarding"}
              </Button>
            </div>
          </div>

          {/* Mobile floating complete button */}
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-100 px-4 py-3 flex items-center gap-3">
            <div className="flex-1 text-sm">
              {canComplete ? (
                <span className="text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> Ready to complete
                </span>
              ) : (
                <span className="text-amber-600 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {total - completed} item{total - completed !== 1 ? "s" : ""} left
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPDF}
              className="shrink-0"
            >
              <Download className="w-4 h-4" />
            </Button>
            <Button
              onClick={handleComplete}
              disabled={!canComplete || completing}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
            >
              {completing ? "Completing…" : "Complete"}
            </Button>
          </div>
        </div>
      </div>

      {/* Renewal Timeline Modal */}
      <RenewalTimelineModal
        open={renewalOpen}
        onClose={handleSkipRenewal}
        clientId={clientId ?? ""}
        clientName={clientName}
        renewalDate={client.fields["Renewal Date"]}
        onCreated={handleRenewalDone}
      />
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 md:p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-sky-600" />
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function CheckRow({ item, checked, onChange }: { item: ChecklistItem; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn(
      "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
      checked ? "bg-emerald-50 border-emerald-200" : "border-slate-100 hover:bg-slate-50"
    )}>
      <div className="mt-0.5">
        {checked
          ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          : <Circle className="w-4 h-4 text-slate-300" />
        }
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-slate-800">{item.label}</span>
          {item.required ? <RequiredDot /> : <HelpfulDot />}
        </div>
        {item.notes && <p className="text-xs text-slate-500 mt-0.5">{item.notes}</p>}
      </div>
    </label>
  );
}

function RequiredDot() {
  return (
    <span title="Required to complete onboarding" className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
  );
}

function HelpfulDot() {
  return (
    <span title="Helpful but not required" className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
  );
}
