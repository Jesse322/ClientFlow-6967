import { useState, useMemo } from "react";
import { useSession } from "@/lib/session";
import { useOpenItems, useClients, useTeamMembers } from "@/hooks/useData";
import { useOffice } from "@/lib/office-context";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EditOpenItemModal } from "@/components/modals/edit-open-item";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SwipeableRow } from "@/components/swipeable-row";
import { deleteOpenItem, updateOpenItem } from "@/lib/api";
import { checkAndToastPoints, snapshotPoints } from "@/hooks/usePointsToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, daysUntil, urgencyColor, urgencyLabel, cn } from "@/lib/utils";
import { parseISO, differenceInDays, isValid } from "date-fns";

// ── Completion date display for closed/completed items ────────────────────────
function completionLabel(completionDate: string | undefined, dueDate: string | undefined): { text: string; className: string } | null {
  if (!completionDate) return null;
  const completed = parseISO(completionDate);
  if (!isValid(completed)) return null;
  const label = `Completed · ${formatDate(completionDate)}`;
  if (!dueDate) return { text: label, className: "text-emerald-600 font-medium" };
  const due = parseISO(dueDate);
  if (!isValid(due)) return { text: label, className: "text-emerald-600 font-medium" };
  const daysLate = differenceInDays(completed, due);
  if (daysLate <= 0) return { text: label, className: "text-emerald-600 font-medium" };
  if (daysLate <= 14) return { text: label, className: "text-orange-500 font-medium" };
  return { text: label, className: "text-red-600 font-medium" };
}
import { toast } from "sonner";
import type { AirtableRecord, OpenItem } from "@/lib/types";
import { Plus, Search, X, ChevronDown, ChevronUp, Pencil, Trash2, CheckSquare, Square, XCircle, User, Mail, UserCheck, Repeat } from "lucide-react";
import { ExpandCard } from "@/components/ui/expand-card";
import { PRIORITIES, PRIORITY_COLORS, PRIORITY_DOT, PRIORITY_ORDER, effectivePriority } from "@/lib/priority";
import { NotesLog } from "@/components/notes-log";

const STATUSES = ["All", "Not Started", "In Progress", "Stuck", "Closed"];
const TYPES = ["All", "Compliance", "HR Support", "Population Health", "Miscellaneous", "Other", "Member Support", "Planning Support", "Ancillary", "Technology"];

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

export default function OpenItemsPage() {
  const { data: items, loading, reload } = useOpenItems();
  const { data: clients } = useClients();
  const { user } = useSession();
  const { data: teamMembers } = useTeamMembers();
  const { selectedOffice } = useOffice();
  const officeClientIds = useMemo(() => new Set((clients || []).filter((c) => (c.fields["Office"] ?? "Irvine") === selectedOffice).map((c) => c.id)), [clients, selectedOffice]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [clientFilter, setClientFilter] = useState("All");
  const [memberFilter, setMemberFilter] = useState("All");
  const [showClosed, setShowClosed] = useState(false);
  const [editItem, setEditItem] = useState<AirtableRecord<OpenItem> | null | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"due" | "name" | "status" | "created" | "priority" | "client" | "assigned">("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
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
    let list = (items || []).filter((i) => officeClientIds.has(i.fields["Client"]?.[0] ?? ""));
    if (!showClosed) list = list.filter((i) => i.fields["Status"] !== "Closed");
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((i) =>
        i.fields["Open Item Name"]?.toLowerCase().includes(q) ||
        i.fields["Notes"]?.toLowerCase().includes(q) ||
        (i.fields["Client"]?.[0] && clientMap[i.fields["Client"][0]]?.toLowerCase().includes(q)) ||
        (i.fields["Assigned To"] || []).some((id) => memberMap[id]?.toLowerCase().includes(q))
      );
    }
    if (statusFilter !== "All") list = list.filter((i) => i.fields["Status"] === statusFilter);
    if (typeFilter !== "All") list = list.filter((i) => i.fields["Open Item Type"] === typeFilter);
    if (priorityFilter !== "All") list = list.filter((i) => effectivePriority(i.fields["Priority"], i.fields["Due Date"]) === priorityFilter);
    if (clientFilter !== "All") list = list.filter((i) => i.fields["Client"]?.[0] === clientFilter);
    if (memberFilter !== "All") list = list.filter((i) => (i.fields["Assigned To"] || []).includes(memberFilter));
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "due") {
        const da = daysUntil(a.fields["Due Date"]) ?? 9999;
        const db = daysUntil(b.fields["Due Date"]) ?? 9999;
        cmp = da - db;
      } else if (sortBy === "name") {
        cmp = (a.fields["Open Item Name"] || "").localeCompare(b.fields["Open Item Name"] || "", undefined, { sensitivity: "base" });
      } else if (sortBy === "status") {
        const order: Record<string, number> = { "Stuck": 0, "Not Started": 1, "In Progress": 2, "Closed": 3 };
        cmp = (order[a.fields["Status"] || ""] ?? 9) - (order[b.fields["Status"] || ""] ?? 9);
      } else if (sortBy === "created") {
        const ca = a.fields["Created At"] || "";
        const cb = b.fields["Created At"] || "";
        cmp = ca < cb ? -1 : ca > cb ? 1 : 0;
      } else if (sortBy === "priority") {
        const pa = effectivePriority(a.fields["Priority"], a.fields["Due Date"]);
        const pb = effectivePriority(b.fields["Priority"], b.fields["Due Date"]);
        cmp = (PRIORITY_ORDER[pa] ?? 9) - (PRIORITY_ORDER[pb] ?? 9);
      } else if (sortBy === "client") {
        const ca = (clientMap[a.fields["Client"]?.[0] || ""] || "");
        const cb = (clientMap[b.fields["Client"]?.[0] || ""] || "");
        cmp = ca.localeCompare(cb, undefined, { sensitivity: "base" });
      } else if (sortBy === "assigned") {
        const na = memberMap[a.fields["Assigned To"]?.[0] || ""] || "";
        const nb = memberMap[b.fields["Assigned To"]?.[0] || ""] || "";
        cmp = na.localeCompare(nb, undefined, { sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [items, search, statusFilter, typeFilter, priorityFilter, clientFilter, memberFilter, showClosed, sortBy, sortDir, clientMap, memberMap, officeClientIds]);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  const SORT_OPTIONS: { value: typeof sortBy; label: string }[] = [
    { value: "created", label: "Date Created" },
    { value: "due",     label: "Due Date" },
    { value: "status",  label: "Status" },
    { value: "priority",label: "Priority" },
    { value: "client",  label: "Client" },
    { value: "assigned",label: "Assigned To" },
    { value: "name",    label: "Name" },
  ];

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((i) => i.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const handleDelete = (id: string) => setConfirmDelete(id);

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await deleteOpenItem(confirmDelete);
      toast.success("Deleted");
      setSelected((prev) => { const n = new Set(prev); n.delete(confirmDelete); return n; });
      reload();
    } catch { toast.error("Delete failed"); }
    finally { setDeleting(false); setConfirmDelete(null); }
  };

  const doBulkDelete = async () => {
    setDeleting(true);
    try {
      await Promise.all([...selected].map((id) => deleteOpenItem(id)));
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
      await Promise.all([...selected].map((id) => updateOpenItem(id, { "Status": status as any })));
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
      const fields: any = { "Status": status };
      if (isCompletion) {
        fields["Completion Date"] = new Date().toISOString().split("T")[0];
      } else {
        fields["Completion Date"] = null;
      }
      await updateOpenItem(id, fields);
      toast.success(`Status → ${status}`);
      reload();
      if (snapshot) checkAndToastPoints(snapshot);
    } catch { toast.error("Update failed"); }
  };

  const handleQuickType = async (id: string, type: string) => {
    try { await updateOpenItem(id, { "Open Item Type": type as any }); reload(); }
    catch { toast.error("Update failed"); }
  };

  const handleQuickPriority = async (id: string, priority: string) => {
    try { await updateOpenItem(id, { "Priority": priority as any }); reload(); }
    catch { toast.error("Update failed"); }
  };

  const handleQuickDue = async (id: string, date: string) => {
    try { await updateOpenItem(id, { "Due Date": date }); reload(); }
    catch { toast.error("Update failed"); }
  };

  const handleQuickAssigned = async (id: string, memberId: string) => {
    try {
      await updateOpenItem(id, { "Assigned To": memberId ? [memberId] : [] });
      reload();
    } catch { toast.error("Update failed"); }
  };

  const officeItems = useMemo(() => (items || []).filter((i) => officeClientIds.has(i.fields["Client"]?.[0] ?? "")), [items, officeClientIds]);
  const counts = useMemo(() => ({
    open: officeItems.filter((i) => i.fields["Status"] !== "Closed").length,
    stuck: officeItems.filter((i) => i.fields["Status"] === "Stuck").length,
    total: officeItems.length,
  }), [officeItems]);

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  return (
    <div>
      <PageHeader
        title="Open Items"
        subtitle={`${counts.open} active · ${counts.stuck} stuck · ${counts.total} total`}
        actions={
          <Button size="sm" onClick={() => setEditItem(null)} className="bg-sky-600 hover:bg-sky-700 text-white">
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        }
      />

      {/* Status pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {["Not Started", "In Progress", "Stuck", "Closed"].map((s) => {
          const count = officeItems.filter((i) => i.fields["Status"] === s).length;
          return (
            <button key={s} onClick={() => {
                const next = statusFilter === s ? "All" : s;
                setStatusFilter(next);
                // Clicking Closed must reveal closed items; deselecting hides them again
                if (s === "Closed") setShowClosed(next === "Closed");
              }}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                statusFilter === s
                  ? s === "Stuck" ? "bg-orange-500 text-white border-orange-500"
                    : s === "Closed" ? "bg-emerald-500 text-white border-emerald-500"
                    : "bg-sky-500 text-white border-sky-500"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              )}>
              {s} <span className="bg-white/20 rounded-full px-1.5">{count}</span>
            </button>
          );
        })}
        <button onClick={() => setShowClosed(!showClosed)}
          className={cn("px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
            showClosed ? "bg-slate-700 text-white border-slate-700" : "bg-white text-slate-500 border-slate-200"
          )}>
          {showClosed ? "Hide Closed" : "Show Closed"}
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
            <SelectTrigger className="h-9 text-sm w-full sm:w-36"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-9 text-sm w-full sm:w-32"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All priorities</SelectItem>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
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
          <Select value={memberFilter} onValueChange={setMemberFilter}>
            <SelectTrigger className="h-9 text-sm w-full sm:w-40"><SelectValue placeholder="Team member" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All members</SelectItem>
              {(teamMembers || [])
                .filter((m) => m.fields["Active Status"] !== false)
                .sort((a, b) => (a.fields["Full Name"] || "").localeCompare(b.fields["Full Name"] || ""))
                .map((m) => <SelectItem key={m.id} value={m.id}>{m.fields["Full Name"]}</SelectItem>)
              }
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 col-span-2 sm:col-span-1">
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-9 text-sm flex-1 sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
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
            {["Not Started", "In Progress", "Stuck", "Closed"].map((s) => (
              <button key={s} onClick={() => handleBulkStatus(s)}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-sky-300 text-slate-600 hover:text-sky-700 transition-colors">
                → {s}
              </button>
            ))}
          </div>
          {/* Bulk reassign */}
          <div className="flex items-center gap-1">
            <UserCheck className="w-3.5 h-3.5 text-slate-400" />
            <Select onValueChange={async (memberId) => {
              try {
                await Promise.all([...selected].map((id) => updateOpenItem(id, { "Assigned To": memberId ? [memberId] : [] })));
                toast.success(`Reassigned ${selected.size} item${selected.size !== 1 ? "s" : ""}`);
                setSelected(new Set());
                reload();
              } catch { toast.error("Some reassignments failed"); }
            }}>
              <SelectTrigger className="h-7 text-xs border-slate-200 bg-white w-36">
                <SelectValue placeholder="Reassign to…" />
              </SelectTrigger>
              <SelectContent>
                {(teamMembers || [])
                  .filter((m) => m.fields["Active Status"] !== false)
                  .sort((a, b) => (a.fields["Full Name"] || "").localeCompare(b.fields["Full Name"] || ""))
                  .map((m) => <SelectItem key={m.id} value={m.id}>{m.fields["Full Name"]}</SelectItem>)
                }
              </SelectContent>
            </Select>
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
        <div className="text-center py-16 text-slate-400 text-sm">No open items match your filters</div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {filtered.map((item) => {
              const clientId = item.fields["Client"]?.[0];
              const clientName = clientId ? clientMap[clientId] : undefined;
              const days = daysUntil(item.fields["Due Date"]);
              const isSelected = selected.has(item.id);
              const assignedId = item.fields["Assigned To"]?.[0] || "";
              const isClosed = item.fields["Status"] === "Closed" || item.fields["Status"] === "Completed";
              const completion = isClosed ? completionLabel(item.fields["Completion Date"], item.fields["Due Date"]) : null;
              return (
                <SwipeableRow key={item.id} onEdit={() => setEditItem(item)} onDelete={() => handleDelete(item.id)}>
                  <ExpandCard
                    color={item.fields["Status"] === "Stuck" ? "#f97316" : item.fields["Status"] === "Closed" ? "#10b981" : "#0ea5e9"}
                    className={cn(isSelected ? "border-sky-300 bg-sky-50/50" : "")}
                    expandedContent={
                      <div className="space-y-2">
                        <div className="flex gap-3 flex-wrap text-xs text-muted-foreground">
                          {item.fields["Begin Date"] && <span>Begin: {formatDate(item.fields["Begin Date"])}</span>}
                          {item.fields["Due Date"] && <span>Due: {formatDate(item.fields["Due Date"])}</span>}
                        </div>
                        {item.fields["Notes"] && <p className="text-xs text-muted-foreground line-clamp-3">{item.fields["Notes"]}</p>}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => setEditItem(item)} className="text-xs text-sky-600 hover:text-sky-700 font-medium">Edit</button>
                          <button onClick={() => handleDelete(item.id)} className="text-xs text-red-500 hover:text-red-600 font-medium">Delete</button>
                        </div>
                      </div>
                    }
                  >
                    <div className="flex items-start gap-3">
                      <button onClick={() => toggleSelect(item.id)} className="mt-0.5 shrink-0">
                        {isSelected ? <CheckSquare className="w-4 h-4 text-sky-500" /> : <Square className="w-4 h-4 text-slate-300" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground leading-snug">{item.fields["Open Item Name"]}</p>
                            {item.fields["Recurring"] && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-600 border border-sky-200 font-medium mt-0.5">
                                <Repeat className="w-2.5 h-2.5"/>{item.fields["Recurrence Rate"] || "Recurring"}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); setEditItem(item); }} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        {clientName && <p className="text-xs text-muted-foreground mt-0.5">{clientName}</p>}
                        <div className="flex items-center gap-2 flex-wrap mt-2">
                          <Select value={item.fields["Status"] || "Not Started"} onValueChange={(v) => handleQuickStatus(item.id, v)}>
                            <SelectTrigger className="h-auto text-xs border-0 p-0 shadow-none focus:ring-0 [&>svg]:hidden cursor-pointer">
                              <StatusBadge label={item.fields["Status"]} variant="status" />
                            </SelectTrigger>
                            <SelectContent position="popper" align="start">
                              {STATUSES.slice(1).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Select value={item.fields["Open Item Type"] || ""} onValueChange={(v) => handleQuickType(item.id, v)}>
                            <SelectTrigger className="h-auto text-xs border-0 p-0 shadow-none focus:ring-0 [&>svg]:hidden cursor-pointer">
                              <StatusBadge label={item.fields["Open Item Type"]} variant="default" />
                            </SelectTrigger>
                            <SelectContent position="popper" align="start">
                              {TYPES.slice(1).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Select value={item.fields["Priority"] || ""} onValueChange={(v) => handleQuickPriority(item.id, v)}>
                            <SelectTrigger className="h-auto text-xs border-0 p-0 shadow-none focus:ring-0 [&>svg]:hidden cursor-pointer">
                              {(() => {
                                const p = effectivePriority(item.fields["Priority"], item.fields["Due Date"]);
                                const isDefault = !item.fields["Priority"];
                                return (
                                  <span className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold", PRIORITY_COLORS[p], isDefault && "opacity-60")}>
                                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", PRIORITY_DOT[p])} />
                                    {p}{isDefault ? " *" : ""}
                                  </span>
                                );
                              })()}
                            </SelectTrigger>
                            <SelectContent position="popper" align="start">
                              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {completion
                            ? <span className={cn("text-xs ml-auto", completion.className)}>{completion.text}</span>
                            : days !== null && <span className={cn("text-xs font-medium ml-auto", urgencyColor(days))}>{urgencyLabel(days)}</span>
                          }
                        </div>
                        {assignedId && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <User className="w-3 h-3" />{memberMap[assignedId]}
                          </p>
                        )}
                      </div>
                    </div>
                  </ExpandCard>
                </SwipeableRow>
              );
            })}
          </div>

          {/* Desktop table — cols: checkbox | name | client | status | type | assigned | due | actions */}
          <div className="hidden sm:block bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-[auto_2fr_1.2fr_1fr_1fr_1fr_1fr_1fr_1fr_auto] gap-2 px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide items-center">
              <button onClick={toggleSelectAll} className="p-0.5">
                {allSelected
                  ? <CheckSquare className="w-4 h-4 text-sky-500" />
                  : <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />}
              </button>
              <SortHeader label="Item" col="name" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Client" col="client" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Status" col="status" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <span>Type</span>
              <SortHeader label="Priority" col="priority" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Assigned" col="assigned" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Due" col="due" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Created" col="created" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <span></span>
            </div>
            <div className="divide-y divide-slate-50">
              {filtered.map((item) => {
                const clientId = item.fields["Client"]?.[0];
                const clientName = clientId ? clientMap[clientId] : undefined;
                const days = daysUntil(item.fields["Due Date"]);
                const isExpanded = expandedId === item.id;
                const isSelected = selected.has(item.id);
                const assignedId = item.fields["Assigned To"]?.[0] || "";
                const isClosed = item.fields["Status"] === "Closed" || item.fields["Status"] === "Completed";
                const completion = isClosed ? completionLabel(item.fields["Completion Date"], item.fields["Due Date"]) : null;
                return (
                  <div key={item.id} className={cn(isSelected && "bg-sky-50/50")}>
                    <SwipeableRow onEdit={() => setEditItem(item)} onDelete={() => handleDelete(item.id)}>
                      <div className="grid grid-cols-[auto_2fr_1.2fr_1fr_1fr_1fr_1fr_1fr_1fr_auto] gap-2 px-5 py-3.5 hover:bg-slate-50/50 items-center">
                        <button onClick={() => toggleSelect(item.id)} className="p-0.5">
                          {isSelected
                            ? <CheckSquare className="w-4 h-4 text-sky-500" />
                            : <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />}
                        </button>

                        {/* Name */}
                        <div className="min-w-0">
                          <button onClick={() => setExpandedId(isExpanded ? null : item.id)}
                            className="text-sm font-medium text-slate-800 hover:text-sky-600 text-left truncate w-full block">
                            {item.fields["Open Item Name"]}
                          </button>
                          {item.fields["Recurring"] && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-600 border border-sky-200 font-medium mt-0.5">
                              <Repeat className="w-2.5 h-2.5"/>{item.fields["Recurrence Rate"] || "Recurring"}
                            </span>
                          )}
                          {item.fields["Notes"] && <p className="text-xs text-slate-400 truncate mt-0.5">{item.fields["Notes"]}</p>}
                        </div>

                        {/* Client */}
                        <span className="text-sm text-slate-500 truncate">{clientName || "—"}</span>

                        {/* Status — inline select */}
                        <Select value={item.fields["Status"] || "Not Started"} onValueChange={(v) => handleQuickStatus(item.id, v)}>
                          <SelectTrigger className="h-auto text-xs border-0 p-0 shadow-none focus:ring-0 [&>svg]:hidden cursor-pointer">
                            <StatusBadge label={item.fields["Status"]} variant="status" />
                          </SelectTrigger>
                          <SelectContent position="popper" align="start">
                            {STATUSES.slice(1).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>

                        {/* Type — inline select */}
                        <Select value={item.fields["Open Item Type"] || ""} onValueChange={(v) => handleQuickType(item.id, v)}>
                          <SelectTrigger className="h-auto text-xs border-0 p-0 shadow-none focus:ring-0 [&>svg]:hidden cursor-pointer">
                            {item.fields["Open Item Type"]
                              ? <StatusBadge label={item.fields["Open Item Type"]} variant="default" />
                              : <span className="text-slate-300 text-xs border border-dashed border-slate-200 rounded px-2 py-0.5">Type</span>
                            }
                          </SelectTrigger>
                          <SelectContent position="popper" align="start">
                            {TYPES.slice(1).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>

                        {/* Priority — inline select */}
                        <Select value={item.fields["Priority"] || ""} onValueChange={(v) => handleQuickPriority(item.id, v)}>
                          <SelectTrigger className="h-auto text-xs border-0 p-0 shadow-none focus:ring-0 [&>svg]:hidden cursor-pointer">
                            {(() => {
                              const p = effectivePriority(item.fields["Priority"], item.fields["Due Date"]);
                              const isDefault = !item.fields["Priority"];
                              return (
                                <span className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold", PRIORITY_COLORS[p], isDefault && "opacity-60")}>
                                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", PRIORITY_DOT[p])} />
                                  {p}{isDefault ? " *" : ""}
                                </span>
                              );
                            })()}
                          </SelectTrigger>
                          <SelectContent position="popper" align="start">
                            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          </SelectContent>
                        </Select>

                        {/* Assigned — inline select */}
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

                        {/* Due date — inline date picker, or completion date if closed */}
                        <div>
                          {completion ? (
                            <span className={cn("text-xs", completion.className)}>{completion.text}</span>
                          ) : item.fields["Due Date"] ? (
                            <label className="cursor-pointer group">
                              <p className={cn("text-xs font-medium", urgencyColor(days))}>{urgencyLabel(days)}</p>
                              <input
                                type="date"
                                defaultValue={item.fields["Due Date"]}
                                className="text-xs text-slate-400 bg-transparent border-0 p-0 cursor-pointer w-28 focus:outline-none focus:ring-0 group-hover:text-sky-500"
                                onChange={async (e) => {
                                  if (!e.target.value) return;
                                  await handleQuickDue(item.id, e.target.value);
                                }}
                              />
                            </label>
                          ) : (
                            <input
                              type="date"
                              className="text-xs text-slate-300 bg-transparent border border-dashed border-slate-200 rounded px-1.5 py-0.5 w-28 focus:outline-none focus:ring-0 focus:border-sky-400 hover:border-slate-300"
                              onChange={async (e) => {
                                if (!e.target.value) return;
                                await handleQuickDue(item.id, e.target.value);
                              }}
                            />
                          )}
                        </div>

                        {/* Created date */}
                        <div>
                          {item.fields["Created At"] ? (
                            <span className="text-xs text-slate-400" title={new Date(item.fields["Created At"] as string).toLocaleString()}>
                              {new Date(item.fields["Created At"] as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </span>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1">
                          {(() => {
                            const mailto = buildMailto(item.fields["Assigned To"] || [], item.fields["Open Item Name"], item.fields["Due Date"]);
                            return mailto
                              ? <a href={mailto} title="Email assigned member" className="p-1.5 rounded hover:bg-sky-50 text-slate-400 hover:text-sky-600"><Mail className="w-3.5 h-3.5" /></a>
                              : <span title="No email — assign a team member first" className="p-1.5 rounded text-slate-200 cursor-not-allowed"><Mail className="w-3.5 h-3.5" /></span>;
                          })()}
                          <button onClick={() => setEditItem(item)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleDelete(item.id)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    </SwipeableRow>
                    {isExpanded && (
                      <div className="px-5 pb-4 bg-slate-50/50 border-t border-slate-100 pt-3 space-y-3">
                        <div className="flex gap-4 flex-wrap text-xs text-slate-500">
                          {item.fields["Begin Date"] && <span>Begin: {formatDate(item.fields["Begin Date"])}</span>}
                          {item.fields["Due Date"] && <span>Due: {formatDate(item.fields["Due Date"])}</span>}
                          {item.fields["Full Name (from Assigned To)"]?.length > 0 && (
                            <span>Assigned: {item.fields["Full Name (from Assigned To)"].join(", ")}</span>
                          )}
                          {item.fields["Created At"] && (
                            <span className="text-slate-400">Created: {new Date(item.fields["Created At"] as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Notes & Updates</p>
                          <NotesLog
                            notes={item.fields["Notes"]}
                            authorName={user?.name}
                            onAdd={async (updatedNotes) => {
                              await updateOpenItem(item.id, { "Notes": updatedNotes });
                              toast.success("Note added");
                              reload();
                            }}
                            onUpdate={async (updatedNotes) => {
                              await updateOpenItem(item.id, { "Notes": updatedNotes });
                              toast.success("Note deleted");
                              reload();
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <EditOpenItemModal
        item={editItem === undefined ? null : editItem}
        open={editItem !== undefined}
        onClose={() => setEditItem(undefined)}
        onSaved={reload}
        clients={clients || []}
        teamMembers={teamMembers || []}
        currentUserId={user?.airtableId}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete open item?"
        description="This will permanently delete this open item."
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
        loading={deleting}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${selected.size} item${selected.size !== 1 ? "s" : ""}?`}
        description="This will permanently delete the selected open items."
        confirmLabel={`Delete ${selected.size}`}
        onConfirm={doBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
        loading={deleting}
      />
    </div>
  );
}
