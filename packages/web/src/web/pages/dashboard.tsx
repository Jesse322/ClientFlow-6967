import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useDashboardData } from "@/hooks/useData";
import { useSession } from "@/lib/session";
import { useOffice } from "@/lib/office-context";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SetupBanner } from "@/components/setup-banner";
import { getAvatarUrl } from "@/lib/avatar";
import { formatDate, daysUntil, urgencyColor, urgencyLabel, cn } from "@/lib/utils";
import {
  AlertCircle, CalendarClock, Users, CheckSquare, ArrowRight, AlertTriangle, Mail, Copy, Check, RefreshCw, Package, ClipboardList, Plus,
} from "lucide-react";
import { QuickAddOpenItemModal } from "@/components/modals/quick-add-open-item";

const INBOUND_EMAIL = "dff5f69fbe722b8defcf6bf2914d5602@inbound.postmarkapp.com";

export default function Dashboard() {
  const { user, isAdmin } = useSession();
  const { clients, deliverables, openItems, teamMembers, loading, reload } = useDashboardData();
  const { selectedOffice, setSelectedOffice } = useOffice();
  const [, navigate] = useLocation();
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // Office-filtered clients and their IDs
  const officeClients = useMemo(() => (clients.data || []).filter((c) => (c.fields["Office"] ?? "Irvine") === selectedOffice), [clients.data, selectedOffice]);
  const officeClientIds = useMemo(() => new Set(officeClients.map((c) => c.id)), [officeClients]);
  const officeDeliverables = useMemo(() => (deliverables.data || []).filter((d) => officeClientIds.has(d.fields["Client"]?.[0] ?? "")), [deliverables.data, officeClientIds]);
  const officeOpenItems = useMemo(() => (openItems.data || []).filter((o) => officeClientIds.has(o.fields["Client"]?.[0] ?? "")), [openItems.data, officeClientIds]);

  // Find logged-in user's team member record
  const myMember = useMemo(() => {
    if (!user?.airtableId || !teamMembers.data) return null;
    return teamMembers.data.find((m) => m.id === user.airtableId) ?? null;
  }, [user, teamMembers.data]);

  // My assigned items (due within 7 days or overdue)
  const myDigest = useMemo(() => {
    if (!user?.airtableId) return { overdueDel: [], dueSoonDel: [], overdueOI: [], dueSoonOI: [] };
    const myId = user.airtableId;
    const allDel = deliverables.data || [];
    const allOI = openItems.data || [];

    const overdueDel = allDel.filter((d) => {
      if (!((d.fields["Assigned Team Members"] || []) as string[]).includes(myId)) return false;
      if (d.fields["Status"] === "Completed") return false;
      const days = daysUntil(d.fields["Deadline"]);
      return days !== null && days < 0;
    });
    const dueSoonDel = allDel.filter((d) => {
      if (!((d.fields["Assigned Team Members"] || []) as string[]).includes(myId)) return false;
      if (d.fields["Status"] === "Completed") return false;
      const days = daysUntil(d.fields["Deadline"]);
      return days !== null && days >= 0 && days <= 7;
    });
    const overdueOI = allOI.filter((o) => {
      if (!((o.fields["Assigned To"] || []) as string[]).includes(myId)) return false;
      if (o.fields["Status"] === "Closed" || o.fields["Status"] === "Completed") return false;
      const days = daysUntil(o.fields["Due Date"]);
      return days !== null && days < 0;
    });
    const dueSoonOI = allOI.filter((o) => {
      if (!((o.fields["Assigned To"] || []) as string[]).includes(myId)) return false;
      if (o.fields["Status"] === "Closed" || o.fields["Status"] === "Completed") return false;
      const days = daysUntil(o.fields["Due Date"]);
      return days !== null && days >= 0 && days <= 7;
    });

    return { overdueDel, dueSoonDel, overdueOI, dueSoonOI };
  }, [user, deliverables.data, openItems.data]);

  const digestTotal = myDigest.overdueDel.length + myDigest.dueSoonDel.length + myDigest.overdueOI.length + myDigest.dueSoonOI.length;

  const stats = useMemo(() => {
    const c = officeClients;
    const d = officeDeliverables;
    const o = officeOpenItems;
    return {
      activeClients: c.filter((x) => x.fields["Active"]).length,
      totalDeliverables: d.length,
      overdueDeliverables: d.filter((x) => {
        const s = x.fields["Status"];
        if (s === "Completed") return false;
        if (s === "Overdue") return true;
        return (daysUntil(x.fields["Deadline"]) ?? 0) < 0;
      }).length,
      openItemsCount: o.filter((x) => x.fields["Status"] !== "Closed").length,
      stuckItems: o.filter((x) => x.fields["Status"] === "Stuck").length,
    };
  }, [officeClients, officeDeliverables, officeOpenItems]);

  const upcomingDeliverables = useMemo(() => officeDeliverables
    .filter((d) => { const days = daysUntil(d.fields["Deadline"]); return days !== null && days >= -7 && days <= 60 && d.fields["Status"] !== "Completed"; })
    .sort((a, b) => (daysUntil(a.fields["Deadline"]) ?? 999) - (daysUntil(b.fields["Deadline"]) ?? 999))
    .slice(0, 10), [officeDeliverables]);

  const activeOpenItems = useMemo(() => officeOpenItems
    .filter((o) => o.fields["Status"] !== "Closed")
    .sort((a, b) => (daysUntil(a.fields["Due Date"]) ?? 999) - (daysUntil(b.fields["Due Date"]) ?? 999))
    .slice(0, 8), [officeOpenItems]);

  const clientMap = useMemo(() => {
    const map: Record<string, string> = {};
    officeClients.forEach((c) => { map[c.id] = c.fields["Client Name"]; });
    return map;
  }, [officeClients]);

  // Cross-office digest: for non-admins, find other offices where user has assigned tasks
  const otherOfficeData = useMemo(() => {
    if (isAdmin || !user?.airtableId) return [];
    const myId = user.airtableId;
    const allClients = clients.data || [];
    const allDel = deliverables.data || [];
    const allOI = openItems.data || [];

    // Group clients by office (excluding current)
    const officeMap: Record<string, string[]> = {};
    for (const c of allClients) {
      const office = (c.fields["Office"] ?? "Irvine") as string;
      if (office === selectedOffice) continue;
      if (!officeMap[office]) officeMap[office] = [];
      officeMap[office].push(c.id);
    }

    return Object.entries(officeMap).map(([office, clientIds]) => {
      const idSet = new Set(clientIds);
      const myDel = allDel.filter((d) =>
        idSet.has(d.fields["Client"]?.[0] ?? "") &&
        ((d.fields["Assigned Team Members"] || []) as string[]).includes(myId) &&
        d.fields["Status"] !== "Completed"
      );
      const myOI = allOI.filter((o) =>
        idSet.has(o.fields["Client"]?.[0] ?? "") &&
        ((o.fields["Assigned To"] || []) as string[]).includes(myId) &&
        o.fields["Status"] !== "Closed" && o.fields["Status"] !== "Completed"
      );
      const overdueDel = myDel.filter((d) => { const days = daysUntil(d.fields["Deadline"]); return days !== null && days < 0; }).length;
      const overdueDOI = myOI.filter((o) => { const days = daysUntil(o.fields["Due Date"]); return days !== null && days < 0; }).length;
      const dueSoonDel = myDel.filter((d) => { const days = daysUntil(d.fields["Deadline"]); return days !== null && days >= 0 && days <= 7; }).length;
      const dueSoonOI = myOI.filter((o) => { const days = daysUntil(o.fields["Due Date"]); return days !== null && days >= 0 && days <= 7; }).length;
      const total = overdueDel + overdueDOI + dueSoonDel + dueSoonOI;
      return { office, total, overdueDel, overdueDOI, dueSoonDel, dueSoonOI };
    }).filter((x) => x.total > 0);
  }, [isAdmin, user, clients.data, deliverables.data, openItems.data, selectedOffice]);

  // Upcoming renewals — clients renewing in next 90 days
  const upcomingRenewals = useMemo(() => {
    return officeClients
      .filter((c) => {
        if (!c.fields["Active"]) return false;
        const days = daysUntil(c.fields["Renewal Date"]);
        return days !== null && days >= 0 && days <= 90;
      })
      .sort((a, b) => (daysUntil(a.fields["Renewal Date"]) ?? 999) - (daysUntil(b.fields["Renewal Date"]) ?? 999));
  }, [officeClients]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full" />
    </div>
  );

  const anyError = clients.error || deliverables.error || openItems.error;

  return (
    <div>
      {anyError && <SetupBanner error={anyError} />}
      <PageHeader
        title="Dashboard"
        subtitle={new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        actions={
          <button
            onClick={() => setQuickAddOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> Quick Add
          </button>
        }
      />
      <QuickAddOpenItemModal
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onSaved={() => reload()}
        clients={officeClients}
        teamMembers={teamMembers.data || []}
      />

      {/* Personalized Greeting */}
      {user && (
        <div className="mb-5 bg-gradient-to-br from-sky-600 via-sky-700 to-indigo-700 rounded-xl p-5 sm:p-6 text-white relative overflow-hidden">
          {/* Subtle pattern overlay */}
          <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "24px 24px" }} />
          <div className="relative flex flex-col sm:flex-row gap-4 sm:gap-5">
            {/* Avatar */}
            <img
              src={getAvatarUrl(
                myMember?.fields["Full Name"] || user.name || "?",
                myMember?.fields["Avatar Seed"],
                128
              )}
              alt=""
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white/20 shrink-0 ring-2 ring-white/30"
            />
            <div className="flex-1 min-w-0">
              {/* Greeting */}
              <h1 className="text-lg sm:text-xl font-bold">
                {greetingForTime()}, {(myMember?.fields["Full Name"] || user.name || "").split(" ")[0]}!
              </h1>
              {myMember?.fields["Role"] && (
                <p className="text-sm text-sky-200 mt-0.5">{myMember.fields["Role"]}</p>
              )}

              {/* Digest summary */}
              {!loading && (
                <div className="mt-3">
                  {digestTotal === 0 ? (
                    <p className="text-sm text-sky-100">
                      ✅ You're all caught up — no overdue items or upcoming deadlines this week.
                    </p>
                  ) : (
                    <p className="text-sm text-sky-100">
                      Here's what needs your attention this week:
                    </p>
                  )}

                  {digestTotal > 0 && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {myDigest.overdueDel.length > 0 && (
                        <Link href="/deliverables">
                          <a className="flex items-center gap-2.5 bg-white/15 hover:bg-white/20 backdrop-blur-sm rounded-lg px-3 py-2.5 transition-colors">
                            <div className="w-7 h-7 rounded-full bg-red-500/30 flex items-center justify-center shrink-0">
                              <Package className="w-3.5 h-3.5 text-red-200" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">{myDigest.overdueDel.length} overdue deliverable{myDigest.overdueDel.length !== 1 ? "s" : ""}</p>
                              <p className="text-xs text-sky-200 truncate">{myDigest.overdueDel.slice(0, 2).map(d => d.fields["Deliverable Name"]).join(", ")}</p>
                            </div>
                          </a>
                        </Link>
                      )}
                      {myDigest.dueSoonDel.length > 0 && (
                        <Link href="/deliverables">
                          <a className="flex items-center gap-2.5 bg-white/15 hover:bg-white/20 backdrop-blur-sm rounded-lg px-3 py-2.5 transition-colors">
                            <div className="w-7 h-7 rounded-full bg-amber-500/30 flex items-center justify-center shrink-0">
                              <Package className="w-3.5 h-3.5 text-amber-200" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">{myDigest.dueSoonDel.length} deliverable{myDigest.dueSoonDel.length !== 1 ? "s" : ""} due this week</p>
                              <p className="text-xs text-sky-200 truncate">{myDigest.dueSoonDel.slice(0, 2).map(d => d.fields["Deliverable Name"]).join(", ")}</p>
                            </div>
                          </a>
                        </Link>
                      )}
                      {myDigest.overdueOI.length > 0 && (
                        <Link href="/open-items">
                          <a className="flex items-center gap-2.5 bg-white/15 hover:bg-white/20 backdrop-blur-sm rounded-lg px-3 py-2.5 transition-colors">
                            <div className="w-7 h-7 rounded-full bg-red-500/30 flex items-center justify-center shrink-0">
                              <ClipboardList className="w-3.5 h-3.5 text-red-200" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">{myDigest.overdueOI.length} overdue open item{myDigest.overdueOI.length !== 1 ? "s" : ""}</p>
                              <p className="text-xs text-sky-200 truncate">{myDigest.overdueOI.slice(0, 2).map(o => o.fields["Open Item Name"]).join(", ")}</p>
                            </div>
                          </a>
                        </Link>
                      )}
                      {myDigest.dueSoonOI.length > 0 && (
                        <Link href="/open-items">
                          <a className="flex items-center gap-2.5 bg-white/15 hover:bg-white/20 backdrop-blur-sm rounded-lg px-3 py-2.5 transition-colors">
                            <div className="w-7 h-7 rounded-full bg-amber-500/30 flex items-center justify-center shrink-0">
                              <ClipboardList className="w-3.5 h-3.5 text-amber-200" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">{myDigest.dueSoonOI.length} open item{myDigest.dueSoonOI.length !== 1 ? "s" : ""} due this week</p>
                              <p className="text-xs text-sky-200 truncate">{myDigest.dueSoonOI.slice(0, 2).map(o => o.fields["Open Item Name"]).join(", ")}</p>
                            </div>
                          </a>
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cross-office digest (non-admins only) */}
      {!isAdmin && otherOfficeData.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Tasks in other offices</p>
          <div className="flex flex-wrap gap-3">
            {otherOfficeData.map(({ office, total, overdueDel, overdueDOI, dueSoonDel, dueSoonOI }) => (
              <div key={office} className="flex-1 min-w-[220px] bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-700">{office}</p>
                  <span className="text-xs bg-amber-100 text-amber-700 font-medium px-2 py-0.5 rounded-full">{total} task{total !== 1 ? "s" : ""}</span>
                </div>
                <div className="space-y-1 mb-3">
                  {overdueDel > 0 && (
                    <button onClick={() => { setSelectedOffice(office); navigate("/deliverables"); }} className="w-full text-left text-xs flex items-center gap-2 text-red-600 hover:text-red-700">
                      <Package className="w-3 h-3 shrink-0" /> {overdueDel} overdue deliverable{overdueDel !== 1 ? "s" : ""}
                    </button>
                  )}
                  {dueSoonDel > 0 && (
                    <button onClick={() => { setSelectedOffice(office); navigate("/deliverables"); }} className="w-full text-left text-xs flex items-center gap-2 text-amber-600 hover:text-amber-700">
                      <Package className="w-3 h-3 shrink-0" /> {dueSoonDel} deliverable{dueSoonDel !== 1 ? "s" : ""} due this week
                    </button>
                  )}
                  {overdueDOI > 0 && (
                    <button onClick={() => { setSelectedOffice(office); navigate("/open-items"); }} className="w-full text-left text-xs flex items-center gap-2 text-red-600 hover:text-red-700">
                      <ClipboardList className="w-3 h-3 shrink-0" /> {overdueDOI} overdue open item{overdueDOI !== 1 ? "s" : ""}
                    </button>
                  )}
                  {dueSoonOI > 0 && (
                    <button onClick={() => { setSelectedOffice(office); navigate("/open-items"); }} className="w-full text-left text-xs flex items-center gap-2 text-amber-600 hover:text-amber-700">
                      <ClipboardList className="w-3 h-3 shrink-0" /> {dueSoonOI} open item{dueSoonOI !== 1 ? "s" : ""} due this week
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setSelectedOffice(office)}
                  className="w-full text-xs font-medium bg-slate-50 hover:bg-sky-50 hover:text-sky-600 text-slate-500 border border-slate-200 hover:border-sky-200 rounded-lg py-1.5 transition-colors"
                >
                  Jump to {office} →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Active Clients" value={stats.activeClients} icon={<Users className="w-5 h-5 text-sky-500" />} href="/clients" />
        <StatCard label="Open Items" value={stats.openItemsCount} icon={<AlertCircle className="w-5 h-5 text-amber-500" />} href="/open-items"
          sub={stats.stuckItems > 0 ? `${stats.stuckItems} stuck` : undefined} subColor="text-orange-500" />
        <StatCard label="Deliverables" value={stats.totalDeliverables} icon={<CheckSquare className="w-5 h-5 text-violet-500" />} href="/deliverables" />
        <StatCard label="Overdue" value={stats.overdueDeliverables} icon={<AlertTriangle className="w-5 h-5 text-red-500" />} href="/deliverables"
          sub={stats.overdueDeliverables > 0 ? "Need attention" : "All on track"}
          subColor={stats.overdueDeliverables > 0 ? "text-red-500" : "text-emerald-500"} />
      </div>

      {/* Main panels */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Upcoming deadlines */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-slate-400" />
              <h2 className="font-semibold text-slate-800 text-sm">Upcoming Deadlines</h2>
              <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">60 days</span>
            </div>
            <Link href="/deliverables"><a className="text-xs text-sky-600 flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></a></Link>
          </div>
          <div className="divide-y divide-slate-50">
            {upcomingDeliverables.length === 0
              ? <p className="text-slate-400 text-sm text-center py-10">No upcoming deadlines</p>
              : upcomingDeliverables.map((d) => {
                  const days = daysUntil(d.fields["Deadline"]);
                  const clientName = d.fields["Client"]?.[0] ? clientMap[d.fields["Client"][0]] : undefined;
                  return (
                    <div key={d.id} className="px-4 py-3 hover:bg-slate-50/50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{d.fields["Deliverable Name"]}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {clientName && <span className="text-xs text-slate-400 truncate">{clientName}</span>}
                            {d.fields["Type"] && <StatusBadge label={d.fields["Type"]} variant="type" />}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={cn("text-xs font-medium", urgencyColor(days))}>{urgencyLabel(days)}</p>
                          <p className="text-xs text-slate-400">{formatDate(d.fields["Deadline"])}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>

        {/* Open Items */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-slate-400" />
              <h2 className="font-semibold text-slate-800 text-sm">Open Items</h2>
              {stats.openItemsCount > 0 && (
                <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">{stats.openItemsCount}</span>
              )}
            </div>
            <Link href="/open-items"><a className="text-xs text-sky-600 flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></a></Link>
          </div>
          <div className="divide-y divide-slate-50">
            {activeOpenItems.length === 0
              ? <p className="text-slate-400 text-sm text-center py-10">No open items 🎉</p>
              : activeOpenItems.map((o) => {
                  const clientName = o.fields["Client"]?.[0] ? clientMap[o.fields["Client"][0]] : undefined;
                  const days = daysUntil(o.fields["Due Date"]);
                  return (
                    <div key={o.id} className="px-4 py-3 hover:bg-slate-50/50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{o.fields["Open Item Name"]}</p>
                          {clientName && <p className="text-xs text-slate-400 truncate">{clientName}</p>}
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          <StatusBadge label={o.fields["Status"]} variant="status" />
                          {days !== null && <span className={cn("text-xs", urgencyColor(days))}>{urgencyLabel(days)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>
      </div>

      {/* Upcoming Renewals */}
      {upcomingRenewals.length > 0 && (
        <div className="mt-5 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-slate-400" />
              <h2 className="font-semibold text-slate-800 text-sm">Upcoming Renewals</h2>
              <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">90 days</span>
              <span className="text-xs bg-sky-100 text-sky-600 px-1.5 py-0.5 rounded-full font-medium">{upcomingRenewals.length}</span>
            </div>
            <Link href="/clients?sort=renewal"><a className="text-xs text-sky-600 flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></a></Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            {upcomingRenewals.slice(0, 8).map((c) => {
              const days = daysUntil(c.fields["Renewal Date"])!;
              const urgency = days <= 14 ? "bg-red-50 border-red-200" : days <= 30 ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200";
              const textColor = days <= 14 ? "text-red-600" : days <= 30 ? "text-amber-600" : "text-emerald-600";
              return (
                <Link key={c.id} href={`/clients/${c.id}`}>
                  <a className={cn("block px-4 py-3 hover:bg-white transition-colors border-b sm:border-b-0 border-slate-100 last:border-b-0")}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{c.fields["Client Name"]}</p>
                        <p className="text-xs text-slate-400">{formatDate(c.fields["Renewal Date"])}</p>
                      </div>
                      <span className={cn("text-xs font-bold px-2 py-1 rounded-full border shrink-0", urgency, textColor)}>
                        {days === 0 ? "Today" : `${days}d`}
                      </span>
                    </div>
                  </a>
                </Link>
              );
            })}
          </div>
          {upcomingRenewals.length > 8 && (
            <div className="px-4 py-2.5 border-t border-slate-100 text-center">
              <Link href="/clients"><a className="text-xs text-sky-600">+{upcomingRenewals.length - 8} more renewals coming up</a></Link>
            </div>
          )}
        </div>
      )}

      {stats.overdueDeliverables > 0 && (
        <div className="mt-5 bg-red-50 border border-red-200 rounded-xl px-4 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-700">
                {stats.overdueDeliverables} overdue deliverable{stats.overdueDeliverables !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-red-500 hidden sm:block">Review in the Deliverables page</p>
            </div>
          </div>
          <Link href="/deliverables">
            <a className="text-sm font-medium text-red-600 flex items-center gap-1 whitespace-nowrap">
              Review <ArrowRight className="w-4 h-4" />
            </a>
          </Link>
        </div>
      )}

      {/* Email Intake Card */}
      <EmailIntakeCard />
    </div>
  );
}

function EmailIntakeCard() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(INBOUND_EMAIL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mt-5 bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-200 rounded-xl px-5 py-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center shrink-0 mt-0.5">
            <Mail className="w-4 h-4 text-sky-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Email Intake</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Forward emails to automatically create open items. Use subject format:{" "}
              <span className="font-medium text-slate-700">[Client Name] - description</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-white border border-sky-200 rounded-lg px-3 py-2 min-w-0">
          <span className="text-xs text-slate-600 font-mono truncate max-w-[240px] sm:max-w-xs">
            {INBOUND_EMAIL}
          </span>
          <button
            onClick={copy}
            className="shrink-0 p-1 rounded hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-colors"
            title="Copy email address"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function greetingForTime(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function StatCard({ label, value, icon, href, sub, subColor }: {
  label: string; value: number; icon: React.ReactNode; href: string; sub?: string; subColor?: string;
}) {
  return (
    <Link href={href}>
      <a className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:shadow-sm transition-all">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide leading-tight">{label}</p>
            <p className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">{value}</p>
            {sub && <p className={cn("text-xs mt-0.5", subColor || "text-slate-400")}>{sub}</p>}
          </div>
          <div className="mt-0.5 opacity-70">{icon}</div>
        </div>
      </a>
    </Link>
  );
}
