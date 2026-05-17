import { useState, useMemo, useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { getClient } from "@/lib/api";
import { useDeliverables, useOpenItems, useTeamMembers } from "@/hooks/useData";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EditClientModal } from "@/components/modals/edit-client";
import { EditDeliverableModal } from "@/components/modals/edit-deliverable";
import { EditOpenItemModal } from "@/components/modals/edit-open-item";
import { CompanyIntelCard } from "@/components/company-intel-card";
import { RenewalTimelineModal } from "@/components/renewal-timeline-modal";
import { ComplianceDeadlinesModal } from "@/components/compliance-deadlines-modal";
import { AssignTeamModal } from "@/components/modals/assign-team-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SwipeableRow } from "@/components/swipeable-row";
import { Button } from "@/components/ui/button";
import { formatDate, daysUntil, urgencyColor, urgencyLabel, cn } from "@/lib/utils";
import { deleteDeliverable, deleteOpenItem, updateOpenItem } from "@/lib/api";
import { NotesLog, appendNote } from "@/components/notes-log";
import { toast } from "sonner";
import type { AirtableRecord, Client, Deliverable, OpenItem } from "@/lib/types";
import { ArrowLeft, Pencil, Plus, Calendar, Building2, Users, Sparkles, UserCog, ShieldCheck, FileDown, Mail, Palette, Trash2, CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useSession } from "@/lib/session";
import { CustomizeClientModal } from "@/components/modals/customize-client-modal";


export default function ClientDetailPage() {
  const [, params] = useRoute("/clients/:id");
  const clientId = params?.id;
  const { user } = useSession();
  const [, setLocation] = useLocation();

  const [client, setClient] = useState<AirtableRecord<Client> | null>(null);
  const [clientLoading, setClientLoading] = useState(true);

  const { data: allDeliverables, reload: reloadDel } = useDeliverables();
  const { data: allOpenItems, reload: reloadOI } = useOpenItems();
  const { data: teamMembers } = useTeamMembers();

  const [editClient, setEditClient] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [assignTeamOpen, setAssignTeamOpen] = useState(false);
  const [editDel, setEditDel] = useState<AirtableRecord<Deliverable> | null | undefined>(undefined);
  const [editOI, setEditOI] = useState<AirtableRecord<OpenItem> | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<"deliverables" | "compliance" | "openitems">("deliverables");
  const [renewalTimelineOpen, setRenewalTimelineOpen] = useState(false);
  const [complianceOpen, setComplianceOpen] = useState(false);
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [confirmOIId, setConfirmOIId] = useState<string | null>(null);
  const [expandedOIId, setExpandedOIId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pdfIncludeNotes, setPdfIncludeNotes] = useState(true);

  const loadClient = () => {
    if (!clientId) return;
    setClientLoading(true);
    getClient(clientId).then(setClient).finally(() => setClientLoading(false));
  };

  useEffect(() => { loadClient(); }, [clientId]);

  const clientDeliverables = useMemo(
    () => (allDeliverables || []).filter((d) => d.fields["Client"]?.[0] === clientId && d.fields["Renewal Timeline Phase"] !== "Compliance" && d.fields["Renewal Timeline Phase"] !== "Onboarding"),
    [allDeliverables, clientId]
  );
  const clientComplianceItems = useMemo(
    () => (allDeliverables || []).filter((d) => d.fields["Client"]?.[0] === clientId && d.fields["Renewal Timeline Phase"] === "Compliance"),
    [allDeliverables, clientId]
  );
  const clientOpenItems = useMemo(
    () => (allOpenItems || []).filter((o) => o.fields["Client"]?.[0] === clientId),
    [allOpenItems, clientId]
  );

  // Onboarding deliverables split into phase groups
  const onboardingDeliverables = useMemo(
    () => (allDeliverables || []).filter(
      (d) => d.fields["Client"]?.[0] === clientId && d.fields["Renewal Timeline Phase"] === "Onboarding"
    ),
    [allDeliverables, clientId]
  );

  const ONBOARDING_PHASES = [
    {
      key: "setup",
      label: "Setup Tasks",
      items: [
        "Internal Huddle with Producer",
        "New Client BP Entry Support Request",
        "Analyst Assignment Request",
        "BenefitPoint Client Setup",
        "Distribute New Client Welcome Kit",
        "CED Annual Setup",
        "Post-Onboarding Huddle",
        "Confirmed producer setup for USI newsletters",
      ],
    },
    {
      key: "documents",
      label: "Documents",
      items: [
        "Gather: BAA and Client Agreement",
        "Gather: Compensation Disclosure",
        "Gather: BOR Letter to Carrier",
        "Gather: Plan Booklets / Certificates",
        "Gather: SBC (Summary of Benefits and Coverage)",
        "Gather: Wrap SPD",
        "Gather: Wrap Plan Document",
        "Gather: Cafeteria Plan Document",
        "Gather: HIPAA Policies and Procedures",
        "Gather: Copy of Most Recent Form 5500",
        "Gather: Current Employee Census",
        "Gather: Carrier Contact Sheet",
        "Gather: Current Premium Rates and Experience Data",
      ],
    },
    {
      key: "valueadds",
      label: "Value Adds",
      items: [
        "Value Add Setup: BRC (Benefit Resource Center)",
        "Value Add Setup: USI Mobile App",
        "Value Add Setup: Zywave Client Cloud",
      ],
    },
  ];
  const teamMemberMap = useMemo(() => {
    const map: Record<string, string> = {};
    (teamMembers || []).forEach((t) => { map[t.id] = t.fields["Full Name"]; });
    return map;
  }, [teamMembers]);

  const teamEmailMap = useMemo(() => {
    const map: Record<string, string> = {};
    (teamMembers || []).forEach((t) => {
      const raw = t.fields["_email"] || t.fields["Email Address"];
      const email = typeof raw === "object" ? raw?.value : raw;
      if (email) map[t.id] = email;
    });
    return map;
  }, [teamMembers]);

  // Build a mailto: link — first assigned member is "to", rest are "cc"
  function buildMailto(
    assignedIds: string[],
    subject: string,
    dueDate?: string
  ): string {
    const emails = assignedIds.map((id) => teamEmailMap[id]).filter(Boolean);
    if (emails.length === 0) return "";
    const [to, ...cc] = emails;
    const dateStr = dueDate ? ` — Due ${formatDate(dueDate)}` : "";
    const subjectLine = `${subject}${dateStr}`;
    
    const qs = [
      cc.length ? `cc=${encodeURIComponent(cc.join(","))}` : "",
      `subject=${encodeURIComponent(subjectLine)}`,
    ].filter(Boolean).join("&");
    return `mailto:${to}?${qs}`;
  }

  const handleDeleteDel = (id: string) => setConfirmDelId(id);
  const doDeleteDel = async () => {
    if (!confirmDelId) return;
    setDeleting(true);
    try { await deleteDeliverable(confirmDelId); toast.success("Deleted"); reloadDel(); }
    catch { toast.error("Delete failed"); }
    finally { setDeleting(false); setConfirmDelId(null); }
  };

  const handleDeleteOI = (id: string) => setConfirmOIId(id);
  const doDeleteOI = async () => {
    if (!confirmOIId) return;
    setDeleting(true);
    try { await deleteOpenItem(confirmOIId); toast.success("Deleted"); reloadOI(); }
    catch { toast.error("Delete failed"); }
    finally { setDeleting(false); setConfirmOIId(null); }
  };

  if (clientLoading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full" />
    </div>
  );
  if (!client) return <div className="text-slate-500 text-sm">Client not found.</div>;

  const f = client.fields;
  const renewalDays = daysUntil(f["Renewal Date"]);
  const teamIds = [
    ...(f["Producer"] || []),
    ...(f["Service Lead"] || []),
    ...(f["Analyst"] || []),
    ...(f["Assigned Team Members"] || []),
  ].filter((id, i, arr) => arr.indexOf(id) === i);

  // ── Banner derived values ────────────────────────────────────────────────
  const themeColor = f["Theme Color"] || null;
  const headerPhotoUrl = f["Header Photo URL"] || null;
  const headerPhotoSource = f["Header Photo Source"] || null;
  const headerCredit = f["Header Photo Credit"] || null;
  const hasBanner = !!(headerPhotoUrl || themeColor);
  const resolvedPhotoUrl = headerPhotoUrl
    ? (headerPhotoSource === "upload" ? `/api/clients/${client.id}/header-photo` : headerPhotoUrl)
    : null;

  const isOnboarding = !!(f["Is Onboarding"]);

  return (
    <div>
      {/* ── Onboarding Progress Timeline ── */}
      {isOnboarding && (
        <OnboardingTimeline
          deliverables={onboardingDeliverables}
          phases={ONBOARDING_PHASES}
          onboardingData={f["Onboarding Data"] || {}}
          onContinue={() => setLocation(`/clients/${client.id}/onboard`)}
          onReloadDel={reloadDel}
        />
      )}

      {/* ── Back nav ── */}
      <div className="flex items-center gap-2 mb-4">
        <Link href="/clients">
          <a className={cn(
            "flex items-center gap-1 text-sm transition-colors",
            hasBanner ? "text-slate-500 hover:text-slate-700" : "text-slate-500 hover:text-slate-700"
          )}>
            <ArrowLeft className="w-4 h-4" /> Clients
          </a>
        </Link>
      </div>

      {/* ── Header banner ── */}
      <div
        className={cn(
          "relative rounded-2xl mb-6 overflow-hidden",
          hasBanner ? "min-h-[140px]" : ""
        )}
        style={!resolvedPhotoUrl && themeColor ? { backgroundColor: themeColor } : undefined}
      >
        {/* Background photo */}
        {resolvedPhotoUrl && (
          <img
            src={resolvedPhotoUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* Gradient overlay when photo is set */}
        {resolvedPhotoUrl && (
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/60" />
        )}

        {/* Content */}
        <div className={cn(
          "relative flex items-start justify-between flex-wrap gap-4",
          hasBanner ? "p-5" : "pb-2"
        )}>
          <div>
            <div className="flex items-center gap-3">
              <h1 className={cn(
                "text-2xl font-bold",
                hasBanner ? "text-white drop-shadow" : "text-slate-900"
              )}>{f["Client Name"]}</h1>
              {f["Active"] ? (
                <span className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium border",
                  hasBanner
                    ? "bg-white/20 text-white border-white/30 backdrop-blur-sm"
                    : "bg-emerald-50 text-emerald-600 border-emerald-200"
                )}>Active</span>
              ) : (
                <span className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium border",
                  hasBanner
                    ? "bg-white/20 text-white border-white/30 backdrop-blur-sm"
                    : "bg-slate-100 text-slate-500 border-slate-200"
                )}>Inactive</span>
              )}
            </div>
            <div className={cn(
              "flex items-center gap-3 mt-1 text-sm flex-wrap",
              hasBanner ? "text-white/80" : "text-slate-500"
            )}>
              {f["Funding Strategy"] && (
                hasBanner
                  ? <span className="bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded-full text-xs border border-white/20">{f["Funding Strategy"]}</span>
                  : <StatusBadge label={f["Funding Strategy"]} />
              )}
              {f["Segment"] && (
                hasBanner
                  ? <span className="bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded-full text-xs border border-white/20">{f["Segment"]}</span>
                  : <StatusBadge label={f["Segment"]} />
              )}
              {f["Company Size"] && <span>{f["Company Size"]} employees</span>}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" title="Renewal Timeline" onClick={() => setRenewalTimelineOpen(true)}
              className={cn(hasBanner ? "bg-white/10 text-white border-white/30 hover:bg-white/20 backdrop-blur-sm" : "text-sky-600 border-sky-200 hover:bg-sky-50")}>
              <Sparkles className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1.5">Timeline</span>
            </Button>
            <Button size="sm" variant="outline" title="Compliance" onClick={() => setComplianceOpen(true)}
              className={cn(hasBanner ? "bg-white/10 text-white border-white/30 hover:bg-white/20 backdrop-blur-sm" : "text-violet-600 border-violet-200 hover:bg-violet-50")}>
              <ShieldCheck className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1.5">Compliance</span>
            </Button>
            <Button size="sm" variant="outline" title="Assign Team" onClick={() => setAssignTeamOpen(true)}
              className={cn(hasBanner ? "bg-white/10 text-white border-white/30 hover:bg-white/20 backdrop-blur-sm" : "text-slate-600 border-slate-200 hover:bg-slate-50")}>
              <UserCog className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1.5">Team</span>
            </Button>
            <Button size="sm" variant="outline" title="Edit Client" onClick={() => setEditClient(true)}
              className={cn(hasBanner ? "bg-white/10 text-white border-white/30 hover:bg-white/20 backdrop-blur-sm" : "")}>
              <Pencil className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1.5">Edit</span>
            </Button>
            <Button size="sm" variant="outline" title="Customize" onClick={() => setCustomizeOpen(true)}
              className={cn(hasBanner ? "bg-white/10 text-white border-white/30 hover:bg-white/20 backdrop-blur-sm" : "text-violet-600 border-violet-200 hover:bg-violet-50")}>
              <Palette className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1.5">Customize</span>
            </Button>
            <div className="flex items-center gap-2">
              <label className={cn("hidden sm:flex items-center gap-1.5 text-xs cursor-pointer select-none", hasBanner ? "text-white/70" : "text-slate-500")}>
                <input
                  type="checkbox"
                  checked={pdfIncludeNotes}
                  onChange={(e) => setPdfIncludeNotes(e.target.checked)}
                  className="rounded border-slate-300 text-sky-500 focus:ring-sky-500/20 w-3.5 h-3.5"
                />
                Notes in PDF
              </label>
              <Button
                size="sm"
                variant="outline"
                title="Download PDF"
                className={cn(hasBanner ? "bg-white/10 text-white border-white/30 hover:bg-white/20 backdrop-blur-sm" : "text-emerald-600 border-emerald-200 hover:bg-emerald-50")}
                onClick={async () => {
                  const { downloadOpenItemsPDF } = await import("@/lib/pdf");
                  await downloadOpenItemsPDF(client, clientOpenItems, teamMemberMap, { includeNotes: pdfIncludeNotes });
                }}
              >
                <FileDown className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1.5">PDF</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Unsplash attribution */}
        {resolvedPhotoUrl && headerCredit && (
          <div className="relative px-5 pb-2 flex justify-end">
            <a href={headerCredit.link} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-white/50 hover:text-white/80 transition-colors">
              Photo by {headerCredit.name} on Unsplash
            </a>
          </div>
        )}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { icon: <Calendar className="w-4 h-4 text-sky-500" />, label: "Renewal Date", value: formatDate(f["Renewal Date"]),
            sub: renewalDays !== null ? <span className={cn("text-xs", urgencyColor(renewalDays))}>{renewalDays > 0 ? `${renewalDays} days away` : "Past renewal"}</span> : null },
          { icon: <Building2 className="w-4 h-4 text-violet-500" />, label: "Medical Carrier", value: (f["Medical Carrier/TPA"] as string[] | undefined)?.join(", ") || "—" },
          { icon: <Building2 className="w-4 h-4 text-amber-500" />, label: "Ancillary Carrier", value: (f["Ancillary Carrier"] as string[] | undefined)?.join(", ") || "—" },
        ].map((card, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1">{card.icon}<span className="text-xs text-slate-400 font-medium">{card.label}</span></div>
            <p className="text-sm font-semibold text-slate-800 truncate">{card.value}</p>
            {card.sub && <div className="mt-0.5">{card.sub}</div>}
          </div>
        ))}
      </div>

      {/* PEO details */}
      {f["Funding Strategy"] === "PEO" && f["PEO Name"] && (
        <div className="mb-6 bg-sky-50/50 border border-sky-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-sky-600 uppercase tracking-wide mb-2">PEO Details</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">PEO Name</span>
            <span className="text-sm font-medium text-slate-800">{f["PEO Name"]}</span>
          </div>
        </div>
      )}

      {/* Self Funded details */}
      {f["Funding Strategy"] === "Self Funded" && (f["SF Arrangement"] || f["TPA Name"] || f["PBM"] || f["Stop Loss"]) && (
        <div className="mb-6 bg-violet-50/50 border border-violet-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-2">Self Funded Details</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {f["SF Arrangement"] && (
              <div>
                <span className="text-xs text-slate-500 block">Arrangement</span>
                <span className="text-sm font-medium text-slate-800">{f["SF Arrangement"]}</span>
              </div>
            )}
            {f["TPA Name"] && (
              <div>
                <span className="text-xs text-slate-500 block">TPA</span>
                <span className="text-sm font-medium text-slate-800">{f["TPA Name"]}</span>
              </div>
            )}
            {f["PBM"] && (
              <div>
                <span className="text-xs text-slate-500 block">PBM</span>
                <span className="text-sm font-medium text-slate-800">{f["PBM"]}</span>
              </div>
            )}
            {f["Stop Loss"] && (
              <div>
                <span className="text-xs text-slate-500 block">Stop Loss</span>
                <span className="text-sm font-medium text-slate-800">{f["Stop Loss"]}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Team */}
      <div className="mb-6 bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Assigned Team</h3>
          <button onClick={() => setAssignTeamOpen(true)}
            className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium">
            <UserCog className="w-3.5 h-3.5" /> Edit Team
          </button>
        </div>
        {teamIds.length === 0 ? (
          <button onClick={() => setAssignTeamOpen(true)} className="text-sm text-slate-400 hover:text-sky-600 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Assign team members
          </button>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {teamIds.map((id) => {
              const name = teamMemberMap[id];
              if (!name) return null;
              return (
                <div key={id} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5">
                  <div className="w-5 h-5 rounded-full bg-sky-100 text-sky-600 text-[10px] font-bold flex items-center justify-center">
                    {name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  <span className="text-xs text-slate-700">{name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Company Intel */}
      <div className="mb-6">
        <CompanyIntelCard
          companyName={f["Client Name"]}
          industry={typeof f["Industry"] === "object" ? (f["Industry"] as any)?.value : f["Industry"] as string | undefined}
          location={f["Location"]}
        />
      </div>

      {/* Tabs */}
      <div className="flex items-end gap-0 border-b border-slate-200 mb-5 overflow-x-auto no-scrollbar">
        {([
          { key: "deliverables", label: "Deliverables", count: clientDeliverables.length },
          { key: "compliance", label: "Compliance", count: clientComplianceItems.length },
          { key: "openitems", label: "Open Items", count: clientOpenItems.length },
        ] as const).map(({ key, label, count }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={cn("px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0",
              activeTab === key ? "border-sky-500 text-sky-600" : "border-transparent text-slate-500 hover:text-slate-700"
            )}>
            {label}
            <span className={cn("text-xs px-1.5 py-0.5 rounded-full",
              activeTab === key ? "bg-sky-100 text-sky-600" : "bg-slate-100 text-slate-500"
            )}>{count}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center shrink-0">
          <Button size="sm" variant="outline"
            onClick={() => activeTab === "openitems" ? setEditOI(null) : setEditDel(null)}
            className="mb-1 ml-2">
            <Plus className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1">Add</span>
          </Button>
        </div>
      </div>

      {/* Content */}
      {activeTab === "compliance" ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {clientComplianceItems.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              No compliance items — use the "Compliance" button above to generate them
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {clientComplianceItems
                .sort((a, b) => (daysUntil(a.fields["Deadline"]) ?? 9999) - (daysUntil(b.fields["Deadline"]) ?? 9999))
                .map((d) => {
                  const days = daysUntil(d.fields["Deadline"]);
                  const assignedIds = d.fields["Assigned Team Members"] || [];
                  const mailto = buildMailto(assignedIds, d.fields["Deliverable Name"], d.fields["Deadline"]);
                  return (
                    <SwipeableRow key={d.id} onEdit={() => setEditDel(d)} onDelete={() => handleDeleteDel(d.id)}>
                      <div className="px-4 py-3 hover:bg-slate-50/50">
                        {/* Row 1: title + action icons */}
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-slate-800 leading-snug flex-1">{d.fields["Deliverable Name"]}</p>
                          <div className="flex gap-0.5 shrink-0">
                            {mailto
                              ? <a href={mailto} className="p-1.5 rounded hover:bg-sky-50 text-slate-400 hover:text-sky-600"><Mail className="w-3.5 h-3.5" /></a>
                              : <span className="p-1.5 rounded text-slate-200 cursor-not-allowed"><Mail className="w-3.5 h-3.5" /></span>}
                            <button onClick={() => setEditDel(d)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteDel(d.id)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        {/* Row 2: badges + date */}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {d.fields["Type"] && <StatusBadge label={d.fields["Type"]} variant="type" />}
                          {(assignedIds).slice(0, 3).map((id: string) => {
                            const name = teamMemberMap[id];
                            if (!name) return null;
                            return (
                              <span key={id} title={name} className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-[9px] font-bold flex items-center justify-center">
                                {name.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                              </span>
                            );
                          })}
                          {d.fields["Status"] === "Completed" ? (
                            <span className="text-xs font-medium text-emerald-600 ml-auto flex items-center gap-1">
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                              {d.fields["Completion Date"] ? formatDate(d.fields["Completion Date"]) : "Done"}
                            </span>
                          ) : (
                            <span className="ml-auto flex items-center gap-2">
                              <StatusBadge label={d.fields["Status"]} variant="status" />
                              {d.fields["Deadline"] && (
                                <span className={cn("text-xs font-medium", urgencyColor(days))}>{formatDate(d.fields["Deadline"])}</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </SwipeableRow>
                  );
                })}
            </div>
          )}
        </div>
      ) : activeTab === "deliverables" ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {clientDeliverables.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              No deliverables — use "Timeline" to generate them automatically
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {clientDeliverables
                .sort((a, b) => (daysUntil(a.fields["Deadline"]) ?? 9999) - (daysUntil(b.fields["Deadline"]) ?? 9999))
                .map((d) => {
                  const days = daysUntil(d.fields["Deadline"]);
                  const assignedIds = d.fields["Assigned Team Members"] || [];
                  const mailto = buildMailto(assignedIds, d.fields["Deliverable Name"], d.fields["Deadline"]);
                  return (
                    <SwipeableRow key={d.id} onEdit={() => setEditDel(d)} onDelete={() => handleDeleteDel(d.id)}>
                      <div className="px-4 py-3 hover:bg-slate-50/50">
                        {/* Row 1: title + action icons */}
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-slate-800 leading-snug flex-1">{d.fields["Deliverable Name"]}</p>
                          <div className="flex gap-0.5 shrink-0">
                            {mailto
                              ? <a href={mailto} className="p-1.5 rounded hover:bg-sky-50 text-slate-400 hover:text-sky-600"><Mail className="w-3.5 h-3.5" /></a>
                              : <span className="p-1.5 rounded text-slate-200 cursor-not-allowed"><Mail className="w-3.5 h-3.5" /></span>}
                            <button onClick={() => setEditDel(d)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteDel(d.id)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        {/* Row 2: badges + date */}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {d.fields["Type"] && <StatusBadge label={d.fields["Type"]} variant="type" />}
                          {d.fields["Renewal Timeline Phase"] && <span className="text-xs text-slate-400">{d.fields["Renewal Timeline Phase"]}</span>}
                          {(assignedIds).slice(0, 3).map((id: string) => {
                            const name = teamMemberMap[id];
                            if (!name) return null;
                            return (
                              <span key={id} title={name} className="w-5 h-5 rounded-full bg-sky-100 text-sky-700 text-[9px] font-bold flex items-center justify-center">
                                {name.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                              </span>
                            );
                          })}
                          {d.fields["Status"] === "Completed" ? (
                            <span className="text-xs font-medium text-emerald-600 ml-auto flex items-center gap-1">
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                              {d.fields["Completion Date"] ? formatDate(d.fields["Completion Date"]) : "Done"}
                            </span>
                          ) : (
                            <span className="ml-auto flex items-center gap-2">
                              <StatusBadge label={d.fields["Status"]} variant="status" />
                              {d.fields["Deadline"] && (
                                <span className={cn("text-xs font-medium", urgencyColor(days))}>{formatDate(d.fields["Deadline"])}</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </SwipeableRow>
                  );
                })}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {clientOpenItems.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">No open items for this client</div>

          ) : (
            <div className="divide-y divide-slate-50">
              {clientOpenItems
                .sort((a, b) => (daysUntil(a.fields["Due Date"]) ?? 9999) - (daysUntil(b.fields["Due Date"]) ?? 9999))
                .map((o) => {
                  const days = daysUntil(o.fields["Due Date"]);
                  const isExpanded = expandedOIId === o.id;
                  return (
                    <div key={o.id}>
                      {/* Row */}
                      <div className="px-4 py-3.5">
                        {/* Top line: name + action buttons */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <button
                            onClick={() => setExpandedOIId(isExpanded ? null : o.id)}
                            className="text-sm font-medium text-slate-800 hover:text-sky-600 text-left leading-snug flex-1"
                          >
                            {o.fields["Open Item Name"]}
                          </button>
                          <div className="flex gap-1 shrink-0">
                            {(() => {
                              const assignedIds = o.fields["Assigned To"] || [];
                              const mailto = buildMailto(assignedIds, o.fields["Open Item Name"], o.fields["Due Date"]);
                              return mailto ? (
                                <a href={mailto} title="Email assigned member" className="p-1.5 rounded hover:bg-sky-50 text-slate-400 hover:text-sky-600">
                                  <Mail className="w-3.5 h-3.5" />
                                </a>
                              ) : (
                                <span title="No email — assign a team member first" className="p-1.5 rounded text-slate-200 cursor-not-allowed">
                                  <Mail className="w-3.5 h-3.5" />
                                </span>
                              );
                            })()}
                            <button onClick={() => setEditOI(o)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-sky-600">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDeleteOI(o.id)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
                          </div>
                        </div>
                        {/* Bottom line: badges + date */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge label={o.fields["Status"]} variant="status" />
                          {o.fields["Open Item Type"] && <StatusBadge label={o.fields["Open Item Type"]} />}
                          {days !== null ? (
                            <span className={cn("text-xs font-medium ml-auto", urgencyColor(days))}>
                              {urgencyLabel(days)} · {formatDate(o.fields["Due Date"])}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300 ml-auto">No due date</span>
                          )}
                        </div>
                      </div>

                      {/* Expandable notes log */}
                      {isExpanded && (
                        <div className="px-4 pb-4 bg-slate-50/60 border-t border-slate-100">
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-3 mb-2">Notes & Updates</p>
                          <NotesLog
                            notes={o.fields["Notes"]}
                            authorName={user?.name}
                            onAdd={async (updatedNotes) => {
                              await updateOpenItem(o.id, { "Notes": updatedNotes });
                              toast.success("Note added");
                              reloadOI();
                            }}
                            onUpdate={async (updatedNotes) => {
                              await updateOpenItem(o.id, { "Notes": updatedNotes });
                              toast.success("Note updated");
                              reloadOI();
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <EditClientModal item={client} open={editClient} onClose={() => setEditClient(false)}
        onSaved={() => { setEditClient(false); loadClient(); }} />
      <CustomizeClientModal client={client} open={customizeOpen}
        onClose={() => setCustomizeOpen(false)} onSaved={() => { setCustomizeOpen(false); loadClient(); }} />
      <AssignTeamModal client={client} teamMembers={teamMembers || []} open={assignTeamOpen}
        onClose={() => setAssignTeamOpen(false)} onSaved={() => { setAssignTeamOpen(false); loadClient(); }} />
      <EditDeliverableModal item={editDel === undefined ? null : editDel} open={editDel !== undefined}
        onClose={() => setEditDel(undefined)} onSaved={() => { reloadDel(); }} clients={client ? [client] : []}
        teamMembers={teamMembers || []}
        defaultPhase={activeTab === "compliance" ? "Compliance" : undefined} />
      <EditOpenItemModal item={editOI === undefined ? null : editOI} open={editOI !== undefined}
        onClose={() => setEditOI(undefined)} onSaved={() => { reloadOI(); }} clients={client ? [client] : []}
        teamMembers={teamMembers || []} defaultClientId={clientId} currentUserId={user?.airtableId} />
      <RenewalTimelineModal open={renewalTimelineOpen} onClose={() => setRenewalTimelineOpen(false)}
        clientId={clientId!} clientName={f["Client Name"]} renewalDate={f["Renewal Date"]}
        onCreated={() => { reloadDel(); setRenewalTimelineOpen(false); toast.success("Renewal timeline created!"); }} />
      <ComplianceDeadlinesModal open={complianceOpen} onClose={() => setComplianceOpen(false)}
        clientId={clientId!} clientName={f["Client Name"]} renewalDate={f["Renewal Date"]}
        fundingStrategy={f["Funding Strategy"]}
        companySize={f["Company Size"]}
        onCreated={() => { reloadDel(); toast.success("Compliance deadlines created!"); }} />
      <ConfirmDialog open={!!confirmDelId} title="Delete deliverable?"
        description="This will permanently delete this deliverable."
        onConfirm={doDeleteDel} onCancel={() => setConfirmDelId(null)} loading={deleting} />
      <ConfirmDialog open={!!confirmOIId} title="Delete open item?"
        description="This will permanently delete this open item."
        onConfirm={doDeleteOI} onCancel={() => setConfirmOIId(null)} loading={deleting} />
    </div>
  );
}

// ─── Onboarding Timeline Component ────────────────────────────────────────────

interface OnboardingPhase {
  key: string;
  label: string;
  items: string[];
}

interface OnboardingTimelineProps {
  deliverables: AirtableRecord<Deliverable>[];
  phases: OnboardingPhase[];
  onboardingData: Record<string, any>;
  onContinue: () => void;
  onReloadDel: () => void;
}

function OnboardingTimeline({ deliverables, phases, onboardingData, onContinue, onReloadDel }: OnboardingTimelineProps) {
  const [expanded, setExpanded] = useState(false);

  // Build lookup: deliverable name → record
  const byName = useMemo(() => {
    const map: Record<string, AirtableRecord<Deliverable>> = {};
    deliverables.forEach((d) => { map[d.fields["Deliverable Name"]] = d; });
    return map;
  }, [deliverables]);

  // Overall stats
  const totalItems = deliverables.length;
  const completedItems = deliverables.filter((d) => d.fields["Status"] === "Completed").length;
  const inProgressItems = deliverables.filter((d) => d.fields["Status"] === "In Progress").length;
  const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  // Per-phase stats
  const phaseStats = phases.map((phase) => {
    const phaseDelivs = phase.items.map((name) => byName[name]).filter(Boolean);
    const done = phaseDelivs.filter((d) => d.fields["Status"] === "Completed").length;
    const inProg = phaseDelivs.filter((d) => d.fields["Status"] === "In Progress").length;
    const total = phaseDelivs.length;
    const allDone = total > 0 && done === total;
    return { ...phase, total, done, inProg, allDone, delivs: phaseDelivs };
  });

  // Which phase is "current" — first non-complete phase
  const currentPhaseIdx = phaseStats.findIndex((p) => !p.allDone);

  const statusIcon = (status: string | undefined) => {
    if (status === "Completed") return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
    if (status === "In Progress") return <div className="w-4 h-4 rounded-full border-2 border-sky-500 bg-sky-100 shrink-0" />;
    return <Circle className="w-4 h-4 text-slate-300 shrink-0" />;
  };

  const statusColor = (status: string | undefined) => {
    if (status === "Completed") return "text-emerald-700";
    if (status === "In Progress") return "text-sky-700 font-medium";
    return "text-slate-500";
  };

  return (
    <div className="bg-white border border-amber-200 rounded-xl mb-5 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-4 px-4 py-3 bg-amber-50 border-b border-amber-100">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-semibold text-amber-800">Onboarding in Progress</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium">
              {completedItems} / {totalItems} complete
            </span>
            {inProgressItems > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 font-medium">
                {inProgressItems} in progress
              </span>
            )}
          </div>
          <Progress value={pct} className="h-2 bg-amber-100 [&>div]:bg-amber-500" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onContinue}
            className="text-sm font-medium text-amber-700 hover:text-amber-900 underline underline-offset-2"
          >
            Continue Setup →
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 ml-2"
          >
            {expanded ? "Hide" : "Details"}
            <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
        </div>
      </div>

      {/* Phase swimlane — always visible */}
      <div className="flex divide-x divide-slate-100">
        {phaseStats.map((phase, idx) => {
          const isCurrent = idx === currentPhaseIdx;
          return (
            <div
              key={phase.key}
              className={cn(
                "flex-1 px-4 py-3 min-w-0",
                phase.allDone ? "bg-emerald-50/40" : isCurrent ? "bg-sky-50/40" : "bg-white"
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                {phase.allDone
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  : isCurrent
                    ? <div className="w-3.5 h-3.5 rounded-full border-2 border-sky-500 bg-sky-100" />
                    : <Circle className="w-3.5 h-3.5 text-slate-300" />
                }
                <span className={cn(
                  "text-xs font-semibold truncate",
                  phase.allDone ? "text-emerald-700" : isCurrent ? "text-sky-700" : "text-slate-400"
                )}>
                  {phase.label}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {phase.done} / {phase.total}
                {isCurrent && phase.inProg > 0 && <span className="text-sky-600 ml-1">· {phase.inProg} active</span>}
              </p>
            </div>
          );
        })}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-100 divide-y divide-slate-50">
          {phaseStats.map((phase, idx) => {
            const isCurrent = idx === currentPhaseIdx;
            return (
              <div key={phase.key} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  {phase.allDone
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    : isCurrent
                      ? <div className="w-3.5 h-3.5 rounded-full border-2 border-sky-500 bg-sky-100" />
                      : <Circle className="w-3.5 h-3.5 text-slate-300" />
                  }
                  <span className={cn(
                    "text-xs font-bold uppercase tracking-wide",
                    phase.allDone ? "text-emerald-700" : isCurrent ? "text-sky-700" : "text-slate-400"
                  )}>
                    {phase.label}
                  </span>
                  <span className="text-xs text-slate-400">{phase.done}/{phase.total}</span>
                </div>
                <div className="space-y-1 pl-5">
                  {phase.items.map((name) => {
                    const d = byName[name];
                    const status = d?.fields["Status"];
                    return (
                      <div key={name} className="flex items-center gap-2">
                        {statusIcon(status)}
                        <span className={cn("text-xs leading-snug", statusColor(status))}>
                          {name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
