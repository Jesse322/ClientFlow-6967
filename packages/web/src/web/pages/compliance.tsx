import { useState, useMemo } from "react";
import { useDeliverables, useClients, useTeamMembers } from "@/hooks/useData";
import { useOffice } from "@/lib/office-context";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EditDeliverableModal } from "@/components/modals/edit-deliverable";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SwipeableRow } from "@/components/swipeable-row";
import { deleteDeliverable, updateDeliverable } from "@/lib/api";
import { checkAndToastPoints, snapshotPoints } from "@/hooks/usePointsToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, daysUntil, urgencyColor, urgencyLabel, cn } from "@/lib/utils";
import { parseISO, differenceInDays, isValid } from "date-fns";
import { toast } from "sonner";
import type { AirtableRecord, Deliverable } from "@/lib/types";

function completionLabel(completionDate: string | undefined, deadline: string | undefined): { text: string; className: string } | null {
  if (!completionDate) return null;
  const completed = parseISO(completionDate);
  if (!isValid(completed)) return null;
  const label = `Completed · ${formatDate(completionDate)}`;
  if (!deadline) return { text: label, className: "text-emerald-600 font-medium" };
  const due = parseISO(deadline);
  if (!isValid(due)) return { text: label, className: "text-emerald-600 font-medium" };
  const daysLate = differenceInDays(completed, due);
  if (daysLate <= 0) return { text: label, className: "text-emerald-600 font-medium" };
  if (daysLate <= 14) return { text: label, className: "text-orange-500 font-medium" };
  return { text: label, className: "text-red-600 font-medium" };
}
import {
  Plus, Search, X, ChevronDown, ChevronUp,
  Pencil, Trash2, CheckSquare, Square, XCircle, CheckCircle2, MessageSquare, Mail,
} from "lucide-react";
import { NotesLog } from "@/components/notes-log";
import { useSession } from "@/lib/session";

function getDisplayStatus(item: AirtableRecord<Deliverable>): string {
  const status = item.fields["Status"] || "Not Started";
  if (status === "Completed") return "Completed";
  const days = daysUntil(item.fields["Deadline"]);
  if (days !== null && days < 0) return "Overdue";
  return status;
}

const STATUSES = ["All", "Not Started", "In Progress", "Completed", "Overdue"];
const TYPES = ["All", "IRS", "ERISA", "CMS", "USI", "Carrier", "Client"];

function SortHeader({ label, col, sortBy, sortDir, onToggle }: {
  label: string; col: string; sortBy: string; sortDir: string;
  onToggle: (col: any) => void;
}) {
  const active = sortBy === col;
  return (
    <button className="text-left flex items-center gap-1 hover:text-slate-700 transition-colors" onClick={() => onToggle(col)}>
      {label}
      {active ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronDown className="w-3 h-3 opacity-20" />}
    </button>
  );
}

export default function CompliancePage() {
  const { user } = useSession();
  const { data: allItems, loading, reload } = useDeliverables();
  const { data: clients } = useClients();
  const { data: teamMembers } = useTeamMembers();
  const { selectedOffice } = useOffice();
  const officeClientIds = useMemo(() => new Set((clients || []).filter((c) => (c.fields["Office"] ?? "Irvine") === selectedOffice).map((c) => c.id)), [clients, selectedOffice]);

  // Only compliance-phase deliverables for this office
  const items = useMemo(
    () => (allItems || []).filter((i) => i.fields["Renewal Timeline Phase"] === "Compliance" && officeClientIds.has(i.fields["Client"]?.[0] ?? "")),
    [allItems, officeClientIds]
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [clientFilter, setClientFilter] = useState("All");
  const [showCompleted, setShowCompleted] = useState(false);
  const [editItem, setEditItem] = useState<AirtableRecord<Deliverable> | null | undefined>(undefined);
  const [sortBy, setSortBy] = useState<"deadline" | "name" | "status" | "client" | "assigned">("deadline");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const clientMap = useMemo(() => {
    const map: Record<string, string> = {};
    (clients || []).forEach((c) => { map[c.id] = c.fields["Client Name"] || ""; });
    return map;
  }, [clients]);

  const memberMap = useMemo(() => {
    const map: Record<string, string> = {};
    (teamMembers || []).forEach((m) => { map[m.id] = m.fields["Full Name"] || ""; });
    return map;
  }, [teamMembers]);

  const emailMap = useMemo(() => {
    const map: Record<string, string> = {};
    (teamMembers || []).forEach((m) => {
      const raw = m.fields["_email"] || m.fields["Email Address"];
      const email = typeof raw === "object" ? raw?.value : raw;
      if (email) map[m.id] = email;
    });
    return map;
  }, [teamMembers]);

  function buildMailto(assignedIds: string[], subject: string, dueDate?: string): string {
    const emails = assignedIds.map((id) => emailMap[id]).filter(Boolean);
    if (!emails.length) return "";
    const [to, ...cc] = emails;
    const sub = dueDate ? `${subject} — Due ${formatDate(dueDate)}` : subject;
    const qs = [
      cc.length ? `cc=${encodeURIComponent(cc.join(","))}` : "",
      `subject=${encodeURIComponent(sub)}`,
    ].filter(Boolean).join("&");
    return `mailto:${to}?${qs}`;
  }

  const filtered = useMemo(() => {
    let list = items;
    if (!showCompleted) list = list.filter((i) => i.fields["Status"] !== "Completed");
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((i) =>
        i.fields["Deliverable Name"]?.toLowerCase().includes(q) ||
        (i.fields["Client"]?.[0] && clientMap[i.fields["Client"][0]]?.toLowerCase().includes(q)) ||
        (i.fields["Assigned Team Members"] || []).some((id) => memberMap[id]?.toLowerCase().includes(q))
      );
    }
    if (statusFilter !== "All") list = list.filter((i) => i.fields["Status"] === statusFilter);
    if (typeFilter !== "All") list = list.filter((i) => i.fields["Type"] === typeFilter);
    if (clientFilter !== "All") list = list.filter((i) => i.fields["Client"]?.[0] === clientFilter);
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "deadline") cmp = (daysUntil(a.fields["Deadline"]) ?? 9999) - (daysUntil(b.fields["Deadline"]) ?? 9999);
      else if (sortBy === "name") cmp = (a.fields["Deliverable Name"] || "").localeCompare(b.fields["Deliverable Name"] || "");
      else if (sortBy === "status") {
        const order: Record<string, number> = { "Overdue": 0, "Not Started": 1, "In Progress": 2, "Completed": 3 };
        cmp = (order[a.fields["Status"] || ""] ?? 9) - (order[b.fields["Status"] || ""] ?? 9);
      } else if (sortBy === "client") {
        const ca = clientMap[a.fields["Client"]?.[0] || ""] || "";
        const cb = clientMap[b.fields["Client"]?.[0] || ""] || "";
        cmp = ca.localeCompare(cb, undefined, { sensitivity: "base" });
      } else if (sortBy === "assigned") {
        const na = memberMap[a.fields["Assigned Team Members"]?.[0] || ""] || "";
        const nb = memberMap[b.fields["Assigned Team Members"]?.[0] || ""] || "";
        cmp = na.localeCompare(nb, undefined, { sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [items, search, statusFilter, typeFilter, clientFilter, showCompleted, sortBy, sortDir, clientMap, memberMap, officeClientIds]);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleSelectAll = () => {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((i) => i.id)));
  };
  const clearSelection = () => setSelected(new Set());

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await deleteDeliverable(confirmDelete);
      toast.success("Deleted");
      setSelected((prev) => { const n = new Set(prev); n.delete(confirmDelete); return n; });
      reload();
    } catch { toast.error("Delete failed"); }
    finally { setDeleting(false); setConfirmDelete(null); }
  };

  const doBulkDelete = async () => {
    setDeleting(true);
    try {
      await Promise.all([...selected].map((id) => deleteDeliverable(id)));
      toast.success(`Deleted ${selected.size} item${selected.size !== 1 ? "s" : ""}`);
      setSelected(new Set());
      reload();
    } catch { toast.error("Some deletions failed"); }
    finally { setDeleting(false); setConfirmBulkDelete(false); }
  };

  const handleBulkStatus = async (status: string) => {
    try {
      const isCompletion = status === "Completed" || status === "Closed";
      const snapshot = isCompletion ? await snapshotPoints() : null;
      await Promise.all([...selected].map((id) => updateDeliverable(id, { "Status": status as any })));
      toast.success(`Updated ${selected.size} items → ${status}`);
      setSelected(new Set());
      reload();
      if (snapshot) checkAndToastPoints(snapshot);
    } catch { toast.error("Some updates failed"); }
  };

  const handleQuickStatus = async (id: string, status: string) => {
    try {
      const isCompletion = status === "Completed" || status === "Closed";
      const snapshot = isCompletion ? await snapshotPoints() : null;
      const fields: any = { "Status": status as any };
      if (status === "Completed") fields["Completion Date"] = new Date().toISOString().split("T")[0];
      else fields["Completion Date"] = null;
      await updateDeliverable(id, fields);
      toast.success(status === "Completed"
        ? `✓ Completed — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
        : `Status → ${status}`);
      reload();
      if (snapshot) checkAndToastPoints(snapshot);
    } catch { toast.error("Update failed"); }
  };

  const handleQuickType = async (id: string, type: string) => {
    try { await updateDeliverable(id, { "Type": type as any }); reload(); }
    catch { toast.error("Update failed"); }
  };

  const handleQuickDeadline = async (id: string, date: string) => {
    try { await updateDeliverable(id, { "Deadline": date }); reload(); }
    catch { toast.error("Update failed"); }
  };

  const handleQuickAssigned = async (id: string, memberId: string) => {
    try {
      await updateDeliverable(id, { "Assigned Team Members": memberId ? [memberId] : [] });
      reload();
    } catch { toast.error("Update failed"); }
  };

  const counts = useMemo(() => ({
    overdue: items.filter((i) => (daysUntil(i.fields["Deadline"]) ?? 0) < 0 && i.fields["Status"] !== "Completed").length,
    inProgress: items.filter((i) => i.fields["Status"] === "In Progress").length,
    upcoming: items.filter((i) => { const d = daysUntil(i.fields["Deadline"]); return d !== null && d >= 0 && d <= 30 && i.fields["Status"] !== "Completed"; }).length,
  }), [items]);

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  return (
    <div>
      <PageHeader
        title="Compliance"
        subtitle={`${counts.overdue} overdue · ${counts.inProgress} in progress · ${counts.upcoming} due in 30 days`}
        actions={
          <Button
            size="sm"
            onClick={() => setEditItem(null)}
            className="bg-sky-600 hover:bg-sky-700 text-white"
          >
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        }
      />

      {/* Status pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUSES.slice(1).map((s) => {
          const count = items.filter((i) => i.fields["Status"] === s).length;
          return (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? "All" : s)}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                statusFilter === s
                  ? s === "Overdue" ? "bg-red-500 text-white border-red-500"
                    : s === "Completed" ? "bg-emerald-500 text-white border-emerald-500"
                    : "bg-sky-500 text-white border-sky-500"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              )}>
              {s} <span className="bg-white/20 rounded-full px-1.5">{count}</span>
            </button>
          );
        })}
        <button onClick={() => setShowCompleted(!showCompleted)}
          className={cn("px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
            showCompleted ? "bg-slate-700 text-white border-slate-700" : "bg-white text-slate-500 border-slate-200"
          )}>
          {showCompleted ? "Hide Completed" : "Show Completed"}
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-9 h-9 text-sm w-full" />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5 text-slate-400" /></button>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 text-sm w-full sm:w-28"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="h-9 text-sm w-full sm:w-40"><SelectValue placeholder="Client" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All clients</SelectItem>
              {(clients || []).sort((a, b) => (a.fields["Client Name"] || "").localeCompare(b.fields["Client Name"] || "")).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.fields["Client Name"]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 col-span-2 sm:col-span-1">
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-9 text-sm flex-1 sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[
                  { value: "deadline", label: "Deadline" },
                  { value: "name", label: "Name" },
                  { value: "status", label: "Status" },
                  { value: "client", label: "Client" },
                  { value: "assigned", label: "Assigned To" },
                ].map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <button
              onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}
              className="h-9 w-9 flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-colors shrink-0"
            >
              {sortDir === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-4 py-2.5 bg-sky-50 border border-sky-200 rounded-xl flex-wrap">
          <span className="text-sm font-medium text-sky-700">{selected.size} selected</span>
          <div className="flex gap-2 flex-wrap ml-2">
            {["Not Started", "In Progress", "Completed"].map((s) => (
              <button key={s} onClick={() => handleBulkStatus(s)}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-sky-300 text-slate-600 hover:text-sky-700 transition-colors">
                → {s}
              </button>
            ))}
          </div>
          <button onClick={() => setConfirmBulkDelete(true)}
            className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Delete {selected.size}
          </button>
          <button onClick={clearSelection} className="p-1 text-slate-400 hover:text-slate-600">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">
          {items.length === 0
            ? "No compliance items yet — use the client detail page to generate them."
            : "No compliance items match your filters."}
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {filtered.map((item) => {
              const clientId = item.fields["Client"]?.[0];
              const clientName = clientId ? clientMap[clientId] : undefined;
              const days = daysUntil(item.fields["Deadline"]);
              const isOverdue = days !== null && days < 0 && item.fields["Status"] !== "Completed";
              const isSelected = selected.has(item.id);
              const assignedId = item.fields["Assigned Team Members"]?.[0] || "";
              return (
                <SwipeableRow key={item.id} onEdit={() => setEditItem(item)} onDelete={() => setConfirmDelete(item.id)}>
                  <div className={cn("bg-white rounded-xl border p-4", isOverdue ? "border-red-200 bg-red-50/30" : isSelected ? "border-sky-300 bg-sky-50/50" : "border-slate-200")}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => toggleSelect(item.id)} className="mt-0.5 shrink-0">
                        {isSelected ? <CheckSquare className="w-4 h-4 text-sky-500" /> : <Square className="w-4 h-4 text-slate-300" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-800 leading-snug flex-1 min-w-0">{item.fields["Deliverable Name"]}</p>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => setEditItem(item)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setConfirmDelete(item.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        {clientName && <p className="text-xs text-slate-400 mt-0.5">{clientName}</p>}
                        <div className="flex items-center gap-2 flex-wrap mt-2">
                          <Select value={item.fields["Status"] || "Not Started"} onValueChange={(v) => handleQuickStatus(item.id, v)}>
                            <SelectTrigger className="h-auto text-xs border-0 p-0 shadow-none focus:ring-0 [&>svg]:hidden cursor-pointer">
                              <StatusBadge label={getDisplayStatus(item)} variant="status" />
                            </SelectTrigger>
                            <SelectContent position="popper" align="start">
                              {STATUSES.slice(1).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Select value={item.fields["Type"] || ""} onValueChange={(v) => handleQuickType(item.id, v)}>
                            <SelectTrigger className="h-auto text-xs border-0 p-0 shadow-none focus:ring-0 [&>svg]:hidden cursor-pointer">
                              <StatusBadge label={item.fields["Type"]} variant="type" />
                            </SelectTrigger>
                            <SelectContent position="popper" align="start">
                              {TYPES.slice(1).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {item.fields["Status"] === "Completed" ? (() => {
                            const cl = completionLabel(item.fields["Completion Date"], item.fields["Deadline"]);
                            return cl
                              ? <span className={cn("text-xs ml-auto flex items-center gap-1", cl.className)}><CheckCircle2 className="w-3 h-3" /> {cl.text}</span>
                              : <span className="text-xs text-emerald-600 font-medium ml-auto flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Completed</span>;
                          })() : item.fields["Deadline"] ? (
                            <span className={cn("text-xs font-medium ml-auto", urgencyColor(days))}>{formatDate(item.fields["Deadline"])} · {urgencyLabel(days)}</span>
                          ) : null}
                        </div>
                        {assignedId && (
                          <p className="text-xs text-slate-400 mt-1">{memberMap[assignedId]}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </SwipeableRow>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-[auto_2fr_1.2fr_1fr_0.8fr_1fr_1fr_auto] gap-2 px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide items-center">
              <button onClick={toggleSelectAll} className="p-0.5">
                {allSelected ? <CheckSquare className="w-4 h-4 text-sky-500" /> : <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />}
              </button>
              <SortHeader label="Name" col="name" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Client" col="client" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Status" col="status" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <span>Type</span>
              <SortHeader label="Assigned" col="assigned" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Deadline" col="deadline" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <span></span>
            </div>
            <div className="divide-y divide-slate-50">
              {filtered.map((item) => {
                const clientId = item.fields["Client"]?.[0];
                const clientName = clientId ? clientMap[clientId] : undefined;
                const days = daysUntil(item.fields["Deadline"]);
                const isOverdue = days !== null && days < 0 && item.fields["Status"] !== "Completed";
                const isSelected = selected.has(item.id);
                const assignedId = item.fields["Assigned Team Members"]?.[0] || "";
                const isExpanded = expandedId === item.id;
                return (
                  <div key={item.id} className={cn(isSelected && "bg-sky-50/50", isOverdue && "bg-red-50/20")}>
                    <SwipeableRow onEdit={() => setEditItem(item)} onDelete={() => setConfirmDelete(item.id)}>
                      <div className="grid grid-cols-[auto_2fr_1.2fr_1fr_0.8fr_1fr_1fr_auto] gap-2 px-5 py-3.5 hover:bg-slate-50/50 items-center">
                        <button onClick={() => toggleSelect(item.id)} className="p-0.5">
                          {isSelected ? <CheckSquare className="w-4 h-4 text-sky-500" /> : <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />}
                        </button>

                        {/* Name */}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{item.fields["Deliverable Name"]}</p>
                          {item.fields["Notes"] && (
                            <p className="text-xs text-slate-400 truncate mt-0.5">{(item.fields["Notes"] as string).split("\n")[0]}</p>
                          )}
                        </div>

                        {/* Client */}
                        <span className="text-sm text-slate-500 truncate">{clientName || "—"}</span>

                        {/* Status */}
                        <Select value={item.fields["Status"] || "Not Started"} onValueChange={(v) => handleQuickStatus(item.id, v)}>
                          <SelectTrigger className="h-auto text-xs border-0 p-0 shadow-none focus:ring-0 [&>svg]:hidden cursor-pointer">
                            <StatusBadge label={getDisplayStatus(item)} variant="status" />
                          </SelectTrigger>
                          <SelectContent position="popper" align="start">
                            {STATUSES.slice(1).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>

                        {/* Type */}
                        <Select value={item.fields["Type"] || ""} onValueChange={(v) => handleQuickType(item.id, v)}>
                          <SelectTrigger className="h-auto text-xs border-0 p-0 shadow-none focus:ring-0 [&>svg]:hidden cursor-pointer">
                            {item.fields["Type"]
                              ? <StatusBadge label={item.fields["Type"]} variant="type" />
                              : <span className="text-slate-300 text-xs border border-dashed border-slate-200 rounded px-2 py-0.5">Type</span>
                            }
                          </SelectTrigger>
                          <SelectContent position="popper" align="start">
                            {TYPES.slice(1).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>

                        {/* Assigned */}
                        <Select
                          value={assignedId}
                          onValueChange={(v) => handleQuickAssigned(item.id, v === "__none__" ? "" : v)}
                        >
                          <SelectTrigger className="h-auto text-xs border-0 p-0 shadow-none focus:ring-0 [&>svg]:hidden cursor-pointer min-w-0">
                            {assignedId
                              ? <span className="text-xs text-slate-700 font-medium truncate">{memberMap[assignedId]}</span>
                              : <span className="text-xs text-slate-300 border border-dashed border-slate-200 rounded px-2 py-0.5">Assign</span>
                            }
                          </SelectTrigger>
                          <SelectContent position="popper" align="start">
                            <SelectItem value="__none__"><span className="text-slate-400">— Unassign</span></SelectItem>
                            {(teamMembers || [])
                              .filter((m) => m.fields["Active Status"] !== false)
                              .sort((a, b) => (a.fields["Full Name"] || "").localeCompare(b.fields["Full Name"] || ""))
                              .map((m) => <SelectItem key={m.id} value={m.id}>{m.fields["Full Name"]}</SelectItem>)
                            }
                          </SelectContent>
                        </Select>

                        {/* Deadline */}
                        <div>
                          {item.fields["Status"] === "Completed" ? (() => {
                            const cl = completionLabel(item.fields["Completion Date"], item.fields["Deadline"]);
                            return (
                              <div>
                                <p className={cn("text-xs flex items-center gap-1", cl ? cl.className : "text-emerald-600 font-medium")}>
                                  <CheckCircle2 className="w-3 h-3" /> Completed
                                </p>
                                {cl && <p className={cn("text-xs mt-0.5", cl.className)}>{formatDate(item.fields["Completion Date"]!)}</p>}
                              </div>
                            );
                          })() : item.fields["Deadline"] ? (
                            <label className="cursor-pointer group">
                              <p className={cn("text-xs font-medium", urgencyColor(days))}>{urgencyLabel(days)}</p>
                              <input
                                type="date"
                                defaultValue={item.fields["Deadline"]}
                                className="text-xs text-slate-400 bg-transparent border-0 p-0 cursor-pointer w-28 focus:outline-none focus:ring-0 group-hover:text-sky-500"
                                onChange={async (e) => {
                                  if (!e.target.value) return;
                                  await handleQuickDeadline(item.id, e.target.value);
                                }}
                              />
                            </label>
                          ) : (
                            <input
                              type="date"
                              className="text-xs text-slate-300 bg-transparent border border-dashed border-slate-200 rounded px-1.5 py-0.5 w-28 focus:outline-none focus:ring-0 focus:border-sky-400 hover:border-slate-300"
                              onChange={async (e) => {
                                if (!e.target.value) return;
                                await handleQuickDeadline(item.id, e.target.value);
                              }}
                            />
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1">
                          {(() => {
                            const mailto = buildMailto(item.fields["Assigned Team Members"] || [], item.fields["Deliverable Name"], item.fields["Deadline"]);
                            return mailto
                              ? <a href={mailto} title="Email assigned member" className="p-1.5 rounded hover:bg-sky-50 text-slate-400 hover:text-sky-600"><Mail className="w-3.5 h-3.5" /></a>
                              : <span className="p-1.5 rounded text-slate-200 cursor-not-allowed"><Mail className="w-3.5 h-3.5" /></span>;
                          })()}
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : item.id)}
                            className={cn("p-1.5 rounded hover:bg-slate-100 transition-colors", isExpanded ? "text-sky-500" : "text-slate-400")}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setEditItem(item)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setConfirmDelete(item.id)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    </SwipeableRow>
                    {isExpanded && (
                      <div className="px-5 pb-4 pt-1 bg-slate-50/70 border-t border-slate-100">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Notes & Updates</p>
                        <NotesLog
                          notes={item.fields["Notes"]}
                          authorName={user?.name}
                          onAdd={async (updatedNotes) => {
                            await updateDeliverable(item.id, { "Notes": updatedNotes });
                            toast.success("Note added");
                            reload();
                          }}
                          onUpdate={async (updatedNotes) => {
                            await updateDeliverable(item.id, { "Notes": updatedNotes });
                            toast.success("Note updated");
                            reload();
                          }}
                          maxHeight="max-h-48"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <EditDeliverableModal
        item={editItem === undefined ? null : editItem}
        open={editItem !== undefined}
        onClose={() => setEditItem(undefined)}
        onSaved={reload}
        clients={clients || []}
        teamMembers={teamMembers || []}
        defaultPhase="Compliance"
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete compliance item?"
        description="This will permanently remove this item."
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
        loading={deleting}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${selected.size} item${selected.size !== 1 ? "s" : ""}?`}
        description="This will permanently remove the selected items."
        confirmLabel={`Delete ${selected.size}`}
        onConfirm={doBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
        loading={deleting}
      />
    </div>
  );
}
