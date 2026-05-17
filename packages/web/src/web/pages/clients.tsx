import { useState, useMemo, lazy, Suspense } from "react";
import { Link } from "wouter";
import { useClients, useDeliverables, useOpenItems, useTeamMembers } from "@/hooks/useData";
import { useOffice } from "@/lib/office-context";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EditClientModal } from "@/components/modals/edit-client";
const ImportModal = lazy(() => import("@/components/modals/import-modal").then(m => ({ default: m.ImportModal })));
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, daysUntil, urgencyColor, formatRevenue, cn } from "@/lib/utils";
import type { AirtableRecord, Client } from "@/lib/types";
import { Plus, Search, Pencil, Trash2, X, ChevronRight, MapPin, Calendar, Download, FileSpreadsheet } from "lucide-react";
import { ExpandCard } from "@/components/ui/expand-card";
import { toast } from "sonner";
import { useSession } from "@/lib/session";

const FUNDING = ["All", "Fully Insured", "Level Funded", "Self Funded", "PEO"];
const SIZES = ["All", "1-49", "50-99", "100-499", "500+"];
const SEGMENTS = ["All", "Select", "Emerging Middle Market", "Middle Market", "Premier", "Public Sector"];

export default function ClientsPage() {
  const { data: clients, loading, reload } = useClients();
  const { data: deliverables } = useDeliverables();
  const { data: openItems } = useOpenItems();
  const { data: teamMembers } = useTeamMembers();
  const { isAdmin } = useSession();
  const { selectedOffice } = useOffice();
  const officeClients = useMemo(() => (clients || []).filter((c) => (c.fields["Office"] ?? "Irvine") === selectedOffice), [clients, selectedOffice]);
  const officeClientIds = useMemo(() => new Set(officeClients.map((c) => c.id)), [officeClients]);

  const [search, setSearch] = useState("");
  const [fundingFilter, setFundingFilter] = useState("All");
  const [sizeFilter, setSizeFilter] = useState("All");
  const [segmentFilter, setSegmentFilter] = useState("All");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("active");
  const [producerFilter, setProducerFilter] = useState("All");
  const [sortBy, setSortBy] = useState<"name" | "renewal" | "producer">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editItem, setEditItem] = useState<AirtableRecord<Client> | null | undefined>(undefined);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Build open items count per client
  const openItemsPerClient = useMemo(() => {
    const map: Record<string, number> = {};
    (openItems || []).forEach((o) => {
      const cid = o.fields["Client"]?.[0];
      if (cid && o.fields["Status"] !== "Closed") {
        map[cid] = (map[cid] || 0) + 1;
      }
    });
    return map;
  }, [openItems]);

  // Risk flags per client: overdue deliverable OR stuck open item
  const riskPerClient = useMemo(() => {
    const map: Record<string, { overdue: boolean; stuck: boolean }> = {};
    (deliverables || []).forEach((d) => {
      const cid = d.fields["Client"]?.[0];
      if (!cid) return;
      const days = daysUntil(d.fields["Deadline"]);
      if (d.fields["Status"] !== "Completed" && days !== null && days < 0) {
        if (!map[cid]) map[cid] = { overdue: false, stuck: false };
        map[cid].overdue = true;
      }
    });
    (openItems || []).forEach((o) => {
      const cid = o.fields["Client"]?.[0];
      if (!cid) return;
      if (o.fields["Status"] === "Stuck") {
        if (!map[cid]) map[cid] = { overdue: false, stuck: false };
        map[cid].stuck = true;
      }
    });
    return map;
  }, [deliverables, openItems]);

  // Build upcoming deliverable per client
  const nextDeliverablePerClient = useMemo(() => {
    const map: Record<string, { name: string; deadline: string; days: number | null }> = {};
    (deliverables || [])
      .filter((d) => d.fields["Status"] !== "Completed" && d.fields["Deadline"])
      .sort((a, b) => {
        const da = daysUntil(a.fields["Deadline"]) ?? 9999;
        const db = daysUntil(b.fields["Deadline"]) ?? 9999;
        return da - db;
      })
      .forEach((d) => {
        const cid = d.fields["Client"]?.[0];
        if (cid && !map[cid]) {
          map[cid] = {
            name: d.fields["Deliverable Name"],
            deadline: d.fields["Deadline"]!,
            days: daysUntil(d.fields["Deadline"]),
          };
        }
      });
    return map;
  }, [deliverables]);

  // Map team member id → name
  const teamMemberMap = useMemo(() => {
    const map: Record<string, string> = {};
    (teamMembers || []).forEach((m) => { map[m.id] = m.fields["Full Name"] || ""; });
    return map;
  }, [teamMembers]);

  // Unique producers for filter dropdown
  const producers = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; name: string }[] = [];
    officeClients.forEach((c) => {
      const pid = c.fields["Producer"]?.[0];
      if (pid && !seen.has(pid) && teamMemberMap[pid]) {
        seen.add(pid);
        list.push({ id: pid, name: teamMemberMap[pid] });
      }
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [officeClients, teamMemberMap]);

  const filtered = useMemo(() => {
    let list = officeClients;
    if (activeFilter === "active") list = list.filter((c) => c.fields["Active"]);
    if (activeFilter === "inactive") list = list.filter((c) => !c.fields["Active"]);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.fields["Client Name"]?.toLowerCase().includes(q) ||
          c.fields["Location"]?.toLowerCase().includes(q) ||
          c.fields["Funding Strategy"]?.toLowerCase().includes(q)
      );
    }
    if (fundingFilter !== "All") list = list.filter((c) => c.fields["Funding Strategy"] === fundingFilter);
    if (sizeFilter !== "All") list = list.filter((c) => c.fields["Company Size"] === sizeFilter);
    if (segmentFilter !== "All") list = list.filter((c) => c.fields["Segment"] === segmentFilter);
    if (producerFilter !== "All") list = list.filter((c) => c.fields["Producer"]?.[0] === producerFilter);
    // Sort
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") {
        cmp = (a.fields["Client Name"] || "").localeCompare(b.fields["Client Name"] || "", undefined, { sensitivity: "base" });
      } else if (sortBy === "renewal") {
        const da = daysUntil(a.fields["Renewal Date"]) ?? 9999;
        const db = daysUntil(b.fields["Renewal Date"]) ?? 9999;
        cmp = da - db;
      } else if (sortBy === "producer") {
        const pa = teamMemberMap[a.fields["Producer"]?.[0] || ""] || "";
        const pb = teamMemberMap[b.fields["Producer"]?.[0] || ""] || "";
        cmp = pa.localeCompare(pb, undefined, { sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [officeClients, search, fundingFilter, sizeFilter, segmentFilter, activeFilter, producerFilter, sortBy, sortDir, teamMemberMap]);

  const handleDelete = (id: string) => setConfirmDeleteId(id);

  const doDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await deleteClient(confirmDeleteId);
      toast.success("Client deleted");
      reload();
    } catch { toast.error("Delete failed"); }
    finally { setDeleting(false); setConfirmDeleteId(null); }
  };

  const counts = useMemo(() => ({
    total: officeClients.length,
    active: officeClients.filter((c) => c.fields["Active"]).length,
  }), [officeClients]);

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle={`${counts.active} active · ${counts.total} total`}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" title="Export CSV" onClick={() => {
              const headers = ["Client Name", "Location", "Funding Strategy", "Segment", "Company Size", "Renewal Date", "Active", "Open Items"];
              const rows = filtered.map((c) => [
                c.fields["Client Name"] || "",
                c.fields["Location"] || "",
                c.fields["Funding Strategy"] || "",
                c.fields["Segment"] || "",
                c.fields["Company Size"] || "",
                c.fields["Renewal Date"] || "",
                c.fields["Active"] ? "Yes" : "No",
                String(openItemsPerClient[c.id] || 0),
              ]);
              const csv = [headers, ...rows].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = "clients.csv"; a.click();
              URL.revokeObjectURL(url);
            }}>
              <Download className="w-4 h-4" /><span className="hidden sm:inline ml-1.5">Export CSV</span>
            </Button>
            {isAdmin && (
              <Button size="sm" variant="outline" title="Import" onClick={() => setShowImport(true)} className="border-slate-600 text-slate-200 hover:bg-slate-800">
                <FileSpreadsheet className="w-4 h-4" /><span className="hidden sm:inline ml-1.5">Import</span>
              </Button>
            )}
            <Button size="sm" title="New Client" onClick={() => setEditItem(null)} className="bg-sky-600 hover:bg-sky-700 text-white">
              <Plus className="w-4 h-4" /><span className="hidden sm:inline ml-1.5">New Client</span>
            </Button>
          </div>
        }
      />

      {/* Filter bar */}
      <div className="mb-5 space-y-2">
        {/* Row 1: active toggle + search + view toggle */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
            {(["active", "all", "inactive"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  activeFilter === f ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                )}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="pl-9 h-9 text-sm w-full"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}
          </div>

          {/* View toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden ml-auto shrink-0">
            <button
              onClick={() => setViewMode("grid")}
              className={cn("px-3 py-1.5 text-xs font-medium", viewMode === "grid" ? "bg-slate-900 text-white" : "bg-white text-slate-600")}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn("px-3 py-1.5 text-xs font-medium", viewMode === "list" ? "bg-slate-900 text-white" : "bg-white text-slate-600")}
            >
              List
            </button>
          </div>
        </div>

        {/* Row 2: dropdowns */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Select value={fundingFilter} onValueChange={setFundingFilter}>
            <SelectTrigger className="h-9 text-sm w-full sm:w-40"><SelectValue placeholder="Funding" /></SelectTrigger>
            <SelectContent>
              {FUNDING.map((f) => <SelectItem key={f} value={f}>{f === "All" ? "All funding" : f}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sizeFilter} onValueChange={setSizeFilter}>
            <SelectTrigger className="h-9 text-sm w-full sm:w-36"><SelectValue placeholder="Size" /></SelectTrigger>
            <SelectContent>
              {SIZES.map((s) => <SelectItem key={s} value={s}>{s === "All" ? "All sizes" : s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={segmentFilter} onValueChange={setSegmentFilter}>
            <SelectTrigger className="h-9 text-sm w-full sm:w-48"><SelectValue placeholder="Segment" /></SelectTrigger>
            <SelectContent>
              {SEGMENTS.map((s) => <SelectItem key={s} value={s}>{s === "All" ? "All segments" : s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={producerFilter} onValueChange={setProducerFilter}>
            <SelectTrigger className="h-9 text-sm w-full sm:w-40"><SelectValue placeholder="Producer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All producers</SelectItem>
              {producers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 col-span-2 sm:col-span-1">
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-9 text-sm flex-1 sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="renewal">Renewal Date</SelectItem>
                <SelectItem value="producer">Producer</SelectItem>
              </SelectContent>
            </Select>
            <button
              onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}
              className="h-9 w-9 flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 shrink-0"
              title={sortDir === "asc" ? "Ascending" : "Descending"}
            >
              {sortDir === "asc"
                ? <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                : <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              }
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">No clients match your filters</div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((client) => {
            const openCount = openItemsPerClient[client.id] || 0;
            const nextDel = nextDeliverablePerClient[client.id];
            const renewalDays = daysUntil(client.fields["Renewal Date"]);
            const risk = riskPerClient[client.id];

            return (
              <ExpandCard
                key={client.id}
                color={risk ? "#ef4444" : "#0ea5e9"}
                className={cn("border", risk ? "border-red-200" : "border-slate-200")}
                expandedContent={
                  <div className="space-y-2 text-xs text-muted-foreground">
                    {client.fields["Renewal Date"] && (
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 shrink-0" />
                        <span>Renews {formatDate(client.fields["Renewal Date"])}</span>
                        {renewalDays !== null && (
                          <span className={cn("font-medium", urgencyColor(renewalDays))}>
                            ({renewalDays > 0 ? `${renewalDays}d` : "Overdue"})
                          </span>
                        )}
                      </div>
                    )}
                    {client.fields["Producer"]?.[0] && teamMemberMap[client.fields["Producer"][0]] && (
                      <div className="flex items-center gap-1.5">
                        <span>Producer: <span className="text-foreground font-medium">{teamMemberMap[client.fields["Producer"][0]]}</span></span>
                      </div>
                    )}
                    <div className="flex gap-3 pt-1">
                      <span><span className="font-medium text-foreground">{client.fields["Total Deliverables"] || 0}</span> deliverables</span>
                      {openCount > 0 && <span className="text-amber-600 font-medium">{openCount} open item{openCount !== 1 ? "s" : ""}</span>}
                    </div>
                    {nextDel && (
                      <div className="bg-muted rounded px-2.5 py-1.5 mt-1">
                        <p className="text-muted-foreground">Next: <span className="text-foreground font-medium truncate">{nextDel.name}</span></p>
                        <p className={cn(urgencyColor(nextDel.days))}>{formatDate(nextDel.deadline)}</p>
                      </div>
                    )}
                    <Link href={`/clients/${client.id}`}>
                      <a className="flex items-center gap-0.5 text-sky-600 hover:text-sky-700 font-medium pt-1">
                        View client <ChevronRight className="w-3 h-3" />
                      </a>
                    </Link>
                  </div>
                }
              >
                <div>
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link href={`/clients/${client.id}`}><h3 className="font-semibold text-foreground truncate hover:text-sky-600 cursor-pointer pr-1">{client.fields["Client Name"]}</h3></Link>
                        {client.fields["Is Onboarding"] && (
                          <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0">Onboarding</span>
                        )}
                      </div>
                      {risk && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 mt-1">
                          ⚠ {[risk.overdue && "Overdue", risk.stuck && "Stuck"].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {client.fields["Funding Strategy"] && <StatusBadge label={client.fields["Funding Strategy"]} />}
                        {client.fields["Segment"] && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200 font-medium">{client.fields["Segment"]}</span>}
                        {client.fields["Company Size"] && <span className="text-xs text-muted-foreground">{client.fields["Company Size"]} ee</span>}
                        {!client.fields["Active"] && <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Inactive</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => setEditItem(client)} className="p-1.5 rounded hover:bg-accent text-muted-foreground">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(client.id)} className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {client.fields["Location"] && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span>{client.fields["Location"]}</span>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-2 italic">Hover to see details</p>
                </div>
              </ExpandCard>
            );
          })}
        </div>
      ) : (
        // List view — hidden on mobile (grid cards handle that)
        <div className="hidden sm:block bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Client</span>
            <span>Funding</span>
            <span>Size</span>
            <span>Renewal</span>
            <span>Open Items</span>
            <span></span>
          </div>
          <div className="divide-y divide-slate-50">
            {filtered.map((client) => {
              const openCount = openItemsPerClient[client.id] || 0;
              const renewalDays = daysUntil(client.fields["Renewal Date"]);
              return (
                <div key={client.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-3 px-5 py-3.5 hover:bg-slate-50/50 items-center">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Link href={`/clients/${client.id}`}><p className="text-sm font-medium text-slate-800 hover:text-blue-600 cursor-pointer">{client.fields["Client Name"]}</p></Link>
                      {client.fields["Is Onboarding"] && (
                        <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0">Onboarding</span>
                      )}
                    </div>
                    {client.fields["Location"] && <p className="text-xs text-slate-400">{client.fields["Location"]}</p>}
                  </div>
                  <StatusBadge label={client.fields["Funding Strategy"]} />
                  <span className="text-sm text-slate-500">{client.fields["Company Size"] || "—"}</span>
                  <div>
                    {client.fields["Renewal Date"] ? (
                      <>
                        <p className={cn("text-xs font-medium", urgencyColor(renewalDays))}>{formatDate(client.fields["Renewal Date"])}</p>
                        {renewalDays !== null && <p className="text-xs text-slate-400">{renewalDays > 0 ? `${renewalDays}d` : "Past"}</p>}
                      </>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </div>
                  <span className={cn("text-sm font-medium", openCount > 0 ? "text-amber-600" : "text-slate-400")}>
                    {openCount || "—"}
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => setEditItem(client)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <Link href={`/clients/${client.id}`}>
                      <a className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-sky-600">
                        <ChevronRight className="w-3.5 h-3.5" />
                      </a>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        <ImportModal
          open={showImport}
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); reload(); }}
        />
      </Suspense>
      <EditClientModal
        item={editItem === undefined ? null : editItem}
        open={editItem !== undefined}
        onClose={() => setEditItem(undefined)}
        onSaved={reload}
      />
      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Delete client?"
        description="This will permanently delete this client. Linked deliverables will not be deleted."
        onConfirm={doDelete}
        onCancel={() => setConfirmDeleteId(null)}
        loading={deleting}
      />
    </div>
  );
}
