import { useState, useMemo } from "react";
import { useRoute, Link } from "wouter";
import { useTeamMembers, useClients, useDeliverables, useOpenItems } from "@/hooks/useData";
import { PageHeader } from "@/components/layout/page-header";
import { EditTeamMemberModal } from "@/components/modals/edit-team-member";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn, formatDate, formatRevenue } from "@/lib/utils";
import { getAvatarUrl } from "@/lib/avatar";
import { ArrowLeft, Mail, Phone, Users, Package, ClipboardList, TrendingUp, Pencil, BarChart2, DollarSign } from "lucide-react";
import type { AirtableRecord, TeamMember, Client, Deliverable, OpenItem } from "@/lib/types";

type ClientRole = "Service Lead" | "Producer" | "Analyst" | "Assigned Team Members";
const ROLE_COLORS: Record<ClientRole, string> = {
  "Service Lead":          "bg-sky-50 text-sky-700 border-sky-200",
  "Producer":              "bg-violet-50 text-violet-700 border-violet-200",
  "Analyst":               "bg-amber-50 text-amber-700 border-amber-200",
  "Assigned Team Members": "bg-slate-100 text-slate-600 border-slate-200",
};
const ROLE_LABELS: Record<ClientRole, string> = {
  "Service Lead":          "Service Lead",
  "Producer":              "Producer",
  "Analyst":               "Analyst",
  "Assigned Team Members": "Team Member",
};

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-slate-100 text-slate-500",
  "In Progress": "bg-blue-50 text-blue-600",
  "Stuck":       "bg-orange-50 text-orange-600",
  "Closed":      "bg-emerald-50 text-emerald-600",
  "Completed":   "bg-emerald-50 text-emerald-600",
  "Overdue":     "bg-red-50 text-red-600",
};

const PRIORITY_COLORS: Record<string, string> = {
  "High":   "bg-red-50 text-red-600",
  "Medium": "bg-amber-50 text-amber-600",
  "Low":    "bg-slate-100 text-slate-500",
};

type Tab = "clients" | "deliverables" | "openitems" | "analytics";

export default function TeamMemberDetailPage() {
  const [, params] = useRoute("/team/:id");
  const memberId = params?.id;

  const { data: allMembers, reload } = useTeamMembers();
  const { data: allClients } = useClients();
  const { data: allDeliverables } = useDeliverables();
  const { data: allOpenItems } = useOpenItems();

  const [tab, setTab] = useState<Tab>("clients");
  const [editOpen, setEditOpen] = useState(false);

  const member = useMemo(
    () => (allMembers || []).find((m) => m.id === memberId) ?? null,
    [allMembers, memberId]
  );

  const assignedClients = useMemo(() => {
    if (!member) return [];
    return (allClients || [])
      .filter((c) => {
        const ids = [
          ...(c.fields["Producer"] || []),
          ...(c.fields["Service Lead"] || []),
          ...(c.fields["Analyst"] || []),
          ...(c.fields["Assigned Team Members"] || []),
        ];
        return ids.includes(member.id);
      })
      .map((c) => {
        const roles: ClientRole[] = [];
        if ((c.fields["Service Lead"] || []).includes(member.id)) roles.push("Service Lead");
        if ((c.fields["Producer"] || []).includes(member.id)) roles.push("Producer");
        if ((c.fields["Analyst"] || []).includes(member.id)) roles.push("Analyst");
        if ((c.fields["Assigned Team Members"] || []).includes(member.id)) roles.push("Assigned Team Members");
        return { client: c, roles };
      })
      .sort((a, b) => (a.client.fields["Client Name"] || "").localeCompare(b.client.fields["Client Name"] || ""));
  }, [member, allClients]);

  const myDeliverables = useMemo(() => {
    if (!member) return [];
    return (allDeliverables || []).filter((d) =>
      (d.fields["Assigned Team Members"] || []).includes(member.id)
    );
  }, [member, allDeliverables]);

  const myOpenItems = useMemo(() => {
    if (!member) return [];
    return (allOpenItems || []).filter((o) =>
      (o.fields["Assigned To"] || []).includes(member.id)
    );
  }, [member, allOpenItems]);

  // Client lookup map
  const clientMap = useMemo(() => {
    const m: Record<string, AirtableRecord<Client>> = {};
    (allClients || []).forEach((c) => { m[c.id] = c; });
    return m;
  }, [allClients]);

  // Analytics: open items count + revenue per client
  const analyticsData = useMemo(() => {
    const byClient: Record<string, { name: string; revenue: number; openCount: number }> = {};
    myOpenItems.forEach((o) => {
      const clientId = (o.fields["Client"] || [])[0];
      if (!clientId) return;
      const c = clientMap[clientId];
      if (!c) return;
      if (!byClient[clientId]) {
        byClient[clientId] = {
          name: c.fields["Client Name"] || "Unknown",
          revenue: Number(c.fields["Revenue"]) || 0,
          openCount: 0,
        };
      }
      if (o.fields["Status"] !== "Closed" && o.fields["Status"] !== "Completed") {
        byClient[clientId].openCount++;
      }
    });
    return Object.values(byClient)
      .filter((d) => d.openCount > 0)
      .sort((a, b) => b.openCount - a.openCount);
  }, [myOpenItems, clientMap]);

  const maxOpenCount = Math.max(...analyticsData.map((d) => d.openCount), 1);

  const stats = useMemo(() => ({
    clients: assignedClients.length,
    deliverables: myDeliverables.length,
    openDeliverables: myDeliverables.filter((d) => d.fields["Status"] !== "Completed" && d.fields["Status"] !== "Closed").length,
    openItems: myOpenItems.filter((o) => o.fields["Status"] !== "Closed" && o.fields["Status"] !== "Completed").length,
    completedDeliverables: myDeliverables.filter((d) => d.fields["Status"] === "Completed").length,
    bookSize: assignedClients.reduce((sum, { client }) => sum + (Number(client.fields["Revenue"]) || 0), 0),
  }), [assignedClients, myDeliverables, myOpenItems]);

  const completionRate = myDeliverables.length > 0
    ? Math.round((stats.completedDeliverables / myDeliverables.length) * 100)
    : 0;

  // Group deliverables/open items by client — MUST be before any early return
  const delByClient = useMemo(() => {
    const groups: Record<string, AirtableRecord<Deliverable>[]> = {};
    myDeliverables.forEach((d) => {
      const cid = (d.fields["Client"] || [])[0] || "__none__";
      if (!groups[cid]) groups[cid] = [];
      groups[cid].push(d);
    });
    return groups;
  }, [myDeliverables]);

  const oiByClient = useMemo(() => {
    const groups: Record<string, AirtableRecord<OpenItem>[]> = {};
    myOpenItems.forEach((o) => {
      const cid = (o.fields["Client"] || [])[0] || "__none__";
      if (!groups[cid]) groups[cid] = [];
      groups[cid].push(o);
    });
    return groups;
  }, [myOpenItems]);

  if (!member) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        {allMembers === undefined ? (
          <div className="animate-spin w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full" />
        ) : "Team member not found"}
      </div>
    );
  }

  const isActive = member.fields["Active Status"] !== false;
  const initials = (member.fields["Full Name"] || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const rawEmail = (member.fields as any)["_email"] || member.fields["Email Address"];
  const email = (typeof rawEmail === "object" ? rawEmail?.value : rawEmail) || "";

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: "clients",      label: "Clients",      count: stats.clients },
    { id: "deliverables", label: "Deliverables",  count: myDeliverables.length },
    { id: "openitems",    label: "Open Items",    count: myOpenItems.length },
    { id: "analytics",    label: "Analytics" },
  ];

  return (
    <div>
      <PageHeader
        title=""
        subtitle=""
        actions={
          <Link href="/team">
            <a className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Team Members
            </a>
          </Link>
        }
      />

      <div className="px-4 sm:px-6 pb-8 max-w-5xl mx-auto overflow-hidden">
        {/* Profile header */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 mb-5 flex items-start gap-4 sm:gap-5">
          <img
            src={getAvatarUrl(member.fields["Full Name"] || "?", member.fields["Avatar Seed"], 128)}
            alt={initials}
            className={cn(
              "w-16 h-16 rounded-full shrink-0 object-cover bg-slate-50",
              !isActive && "opacity-40 grayscale"
            )}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-slate-800">{member.fields["Full Name"]}</h1>
                {member.fields["Role"] && (
                  <p className="text-sm text-slate-500 mt-0.5">{member.fields["Role"]}</p>
                )}
                {!isActive && (
                  <span className="inline-block mt-1 text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full font-medium">Inactive</span>
                )}
              </div>
              <button onClick={() => setEditOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              {email && (
                <a href={`mailto:${email}`} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-sky-600 transition-colors">
                  <Mail className="w-3.5 h-3.5" /> {email}
                </a>
              )}
              {member.fields["Phone Number"] && (
                <span className="flex items-center gap-1.5 text-sm text-slate-500">
                  <Phone className="w-3.5 h-3.5" /> {member.fields["Phone Number"]}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {[
            { label: "Clients",            value: stats.clients,          icon: Users,         color: "text-sky-600" },
            { label: "Open Deliverables",  value: stats.openDeliverables, icon: Package,       color: "text-violet-600" },
            { label: "Open Items",         value: stats.openItems,        icon: ClipboardList, color: "text-amber-600" },
            { label: "Completion Rate",    value: `${completionRate}%`,   icon: TrendingUp,    color: "text-emerald-600" },
            ...(stats.bookSize > 0 ? [{ label: "Book Size", value: formatRevenue(stats.bookSize), icon: DollarSign, color: "text-emerald-600" }] : []),
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={cn("w-4 h-4", color)} />
                <span className="text-xs text-slate-500">{label}</span>
              </div>
              <p className="text-2xl font-bold text-slate-800">{value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b border-slate-200 overflow-x-auto scrollbar-hide">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                tab === t.id
                  ? "border-sky-500 text-sky-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              )}>
              {t.label}
              {t.count !== undefined && (
                <span className={cn("ml-1.5 text-xs px-1.5 py-0.5 rounded-full",
                  tab === t.id ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500"
                )}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── CLIENTS TAB ── */}
        {tab === "clients" && (
          <div>
            {assignedClients.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm">Not assigned to any clients</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {assignedClients.map(({ client, roles }) => {
                  const cDel = myDeliverables.filter((d) => (d.fields["Client"] || [])[0] === client.id);
                  const cOI = myOpenItems.filter((o) => (o.fields["Client"] || [])[0] === client.id);
                  const openOI = cOI.filter((o) => o.fields["Status"] !== "Closed" && o.fields["Status"] !== "Completed");
                  const revenue = Number(client.fields["Revenue"]) || 0;
                  return (
                    <div key={client.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:shadow-sm transition-all">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <Link href={`/clients/${client.id}`}>
                          <a className="text-sm font-semibold text-slate-800 hover:text-sky-600 transition-colors">
                            {client.fields["Client Name"]}
                          </a>
                        </Link>
                        <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                          {roles.map((r) => (
                            <span key={r} className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", ROLE_COLORS[r])}>
                              {ROLE_LABELS[r]}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">{revenue ? formatRevenue(revenue) : "—"}</span>
                        {client.fields["Renewal Date"] && (
                          <span>Renews {formatDate(client.fields["Renewal Date"] as string)}</span>
                        )}
                      </div>
                      <div className="mt-3 pt-2 border-t border-slate-100 flex gap-4 text-xs text-slate-500">
                        <span><strong className="text-slate-700">{cDel.length}</strong> deliverable{cDel.length !== 1 ? "s" : ""}</span>
                        <span><strong className={openOI.length > 0 ? "text-amber-600" : "text-slate-700"}>{openOI.length}</strong> open item{openOI.length !== 1 ? "s" : ""}</span>
                        {client.fields["Funding Strategy"] && (
                          <span className="ml-auto text-slate-400">{client.fields["Funding Strategy"]}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── DELIVERABLES TAB ── */}
        {tab === "deliverables" && (
          <div className="space-y-5">
            {Object.keys(delByClient).length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm">No deliverables assigned</div>
            ) : (
              Object.entries(delByClient).map(([cid, dels]) => {
                const c = clientMap[cid];
                return (
                  <div key={cid} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      {c ? (
                        <Link href={`/clients/${c.id}`}>
                          <a className="text-sm font-semibold text-slate-700 hover:text-sky-600 transition-colors">
                            {c.fields["Client Name"]}
                          </a>
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold text-slate-500">No client</span>
                      )}
                      {c && Number(c.fields["Revenue"]) > 0 && (
                        <span className="text-xs text-slate-400">{formatRevenue(Number(c.fields["Revenue"]))}</span>
                      )}
                    </div>
                    <div className="divide-y divide-slate-100">
                      {dels.map((d) => (
                        <div key={d.id} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-slate-700 truncate">{d.fields["Deliverable Name"]}</p>
                            {d.fields["Deadline"] && (
                              <p className="text-xs text-slate-400 mt-0.5">Due {formatDate(d.fields["Deadline"] as string)}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {d.fields["Renewal Timeline Phase"] && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{d.fields["Renewal Timeline Phase"]}</span>
                            )}
                            <span className={cn("text-xs px-2 py-0.5 rounded font-medium", STATUS_COLORS[d.fields["Status"] || "Not Started"] || "bg-slate-100 text-slate-500")}>
                              {d.fields["Status"] || "—"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── OPEN ITEMS TAB ── */}
        {tab === "openitems" && (
          <div className="space-y-5">
            {Object.keys(oiByClient).length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm">No open items assigned</div>
            ) : (
              Object.entries(oiByClient).map(([cid, items]) => {
                const c = clientMap[cid];
                return (
                  <div key={cid} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      {c ? (
                        <Link href={`/clients/${c.id}`}>
                          <a className="text-sm font-semibold text-slate-700 hover:text-sky-600 transition-colors">
                            {c.fields["Client Name"]}
                          </a>
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold text-slate-500">No client</span>
                      )}
                      {c && Number(c.fields["Revenue"]) > 0 && (
                        <span className="text-xs text-slate-400">{formatRevenue(Number(c.fields["Revenue"]))}</span>
                      )}
                    </div>
                    <div className="divide-y divide-slate-100">
                      {items.map((o) => (
                        <div key={o.id} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-slate-700 truncate">{o.fields["Open Item Name"]}</p>
                            {o.fields["Due Date"] && (
                              <p className="text-xs text-slate-400 mt-0.5">Due {formatDate(o.fields["Due Date"] as string)}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {o.fields["Priority"] && (
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", PRIORITY_COLORS[o.fields["Priority"]] || "bg-slate-100 text-slate-500")}>
                                {o.fields["Priority"]}
                              </span>
                            )}
                            <span className={cn("text-xs px-2 py-0.5 rounded font-medium", STATUS_COLORS[o.fields["Status"] || "Not Started"] || "bg-slate-100 text-slate-500")}>
                              {o.fields["Status"] || "—"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── ANALYTICS TAB ── */}
        {tab === "analytics" && (
          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-5 flex-wrap">
                <BarChart2 className="w-4 h-4 text-sky-500" />
                <h2 className="text-sm font-semibold text-slate-800">Open Items by Client</h2>
                <span className="text-xs text-slate-400">— active (non-closed) items only</span>
              </div>

              {analyticsData.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">No open items to analyze</div>
              ) : (
                <div className="space-y-3">
                  {analyticsData.map((d) => {
                    const pct = Math.round((d.openCount / maxOpenCount) * 100);
                    // Revenue tier drives bar color intensity
                    const barColor = d.revenue > 500000
                      ? "bg-sky-600"
                      : d.revenue > 200000
                        ? "bg-sky-500"
                        : d.revenue > 50000
                          ? "bg-sky-400"
                          : "bg-sky-300";
                    return (
                      <div key={d.name}>
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <div className="min-w-0 flex-1">
                            <span className="text-sm text-slate-700 font-medium truncate block">{d.name}</span>
                            {d.revenue > 0 && (
                              <span className="text-xs text-slate-400">{formatRevenue(d.revenue)}</span>
                            )}
                          </div>
                          <span className="text-sm font-bold text-slate-700 shrink-0">
                            {d.openCount} item{d.openCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="h-5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all", barColor)}
                            style={{ width: `${Math.max(pct, 4)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {/* Revenue legend */}
                  <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap gap-3">
                    <span className="text-xs text-slate-400 mr-1">Revenue tiers:</span>
                    {[
                      { color: "bg-sky-600", label: "> $500k" },
                      { color: "bg-sky-500", label: "$200k–$500k" },
                      { color: "bg-sky-400", label: "$50k–$200k" },
                      { color: "bg-sky-300", label: "< $50k" },
                    ].map((t) => (
                      <div key={t.label} className="flex items-center gap-1.5">
                        <div className={cn("w-3 h-3 rounded-sm", t.color)} />
                        <span className="text-xs text-slate-500">{t.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Summary table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-700">Workload by Client</h2>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Client</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Revenue</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Deliverables</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Open Items</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assignedClients.map(({ client }) => {
                    const cDel = myDeliverables.filter((d) => (d.fields["Client"] || [])[0] === client.id);
                    const cOI = myOpenItems.filter((o) => (o.fields["Client"] || [])[0] === client.id);
                    const openOI = cOI.filter((o) => o.fields["Status"] !== "Closed" && o.fields["Status"] !== "Completed");
                    return (
                      <tr key={client.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <Link href={`/clients/${client.id}`}>
                            <a className="text-slate-700 hover:text-sky-600 font-medium transition-colors">
                              {client.fields["Client Name"]}
                            </a>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500">
                          {Number(client.fields["Revenue"]) ? formatRevenue(Number(client.fields["Revenue"])) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700 font-medium">{cDel.length}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={cn("font-medium", openOI.length > 0 ? "text-amber-600" : "text-slate-400")}>
                            {openOI.length}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <EditTeamMemberModal
        item={member}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={reload}
      />
    </div>
  );
}
