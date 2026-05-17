import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useOffice } from "@/lib/office-context";
import { parseISO, isWithinInterval, startOfDay, subDays, startOfMonth, endOfMonth, subMonths, startOfQuarter, endOfQuarter } from "date-fns";
import { useTeamMembers, useClients, useDeliverables, useOpenItems } from "@/hooks/useData";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";
import { getAvatarUrl } from "@/lib/avatar";
import { suggestReassignments } from "@/lib/api";
import type { ReassignmentSuggestion } from "@/lib/api";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { AlertTriangle, TrendingUp, Flame, Shield, Minus, Sparkles, ArrowRight, X, Loader2 } from "lucide-react";
import type { AirtableRecord, TeamMember, Deliverable, OpenItem } from "@/lib/types";
import { PRIORITIES, PRIORITY_COLORS, PRIORITY_ORDER, effectivePriority } from "@/lib/priority";

// ─── Palette ─────────────────────────────────────────────────────────────────
const STATUS_PIE_COLORS: Record<string, string> = {
  "Not Started": "#94a3b8",
  "In Progress":  "#38bdf8",
  "Completed":    "#34d399",
  "Closed":       "#34d399",
  "Stuck":        "#fb923c",
  "Overdue":      "#f87171",
};
const CHART_COLORS = ["#38bdf8","#818cf8","#34d399","#fb923c","#f472b6","#a78bfa","#facc15","#f87171"];

// ─── Health scoring ───────────────────────────────────────────────────────────
const OVERLOAD_THRESHOLD  = 10; // tasks total → "overwhelmed"
const WARN_THRESHOLD      = 7;  // tasks total → "busy"
const URGENT_DAYS         = 7;  // due within N days counts as urgent

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr + "T12:00:00Z").getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

interface MemberHealth {
  id: string;
  name: string;
  role: string;
  deliverableCount: number;
  openItemCount: number;
  total: number;
  urgentCount: number; // due within URGENT_DAYS
  overdueCount: number;
  stuckCount: number;
  score: number; // 0–100 load score
  status: "overwhelmed" | "busy" | "ok" | "light";
}

function computeHealth(
  members: AirtableRecord<TeamMember>[],
  deliverables: AirtableRecord<Deliverable>[],
  openItems: AirtableRecord<OpenItem>[]
): MemberHealth[] {
  return members
    .filter((m) => m.fields["Active Status"] !== false)
    .map((m) => {
      const myDel = deliverables.filter(
        (d) => (d.fields["Assigned Team Members"] || []).includes(m.id)
          && d.fields["Status"] !== "Completed"
      );
      const myOI = openItems.filter(
        (o) => (o.fields["Assigned To"] || []).includes(m.id)
          && o.fields["Status"] !== "Closed"
      );

      const urgentCount = [
        ...myDel.filter((d) => { const n = daysUntil(d.fields["Deadline"]); return n !== null && n >= 0 && n <= URGENT_DAYS; }),
        ...myOI.filter((o) => { const n = daysUntil(o.fields["Due Date"]); return n !== null && n >= 0 && n <= URGENT_DAYS; }),
      ].length;

      const overdueCount = [
        ...myDel.filter((d) => d.fields["Status"] === "Overdue"),
        ...myOI.filter((o) => { const n = daysUntil(o.fields["Due Date"]); return n !== null && n < 0; }),
      ].length;

      const stuckCount = myOI.filter((o) => o.fields["Status"] === "Stuck").length;

      const total = myDel.length + myOI.length;
      // Score: weighted sum capped at 100
      const score = Math.min(100, Math.round(
        (total / OVERLOAD_THRESHOLD) * 50 +
        (urgentCount * 5) +
        (overdueCount * 8) +
        (stuckCount * 4)
      ));

      const status: MemberHealth["status"] =
        score >= 80 ? "overwhelmed" :
        score >= 55 ? "busy" :
        score >= 20 ? "ok" : "light";

      return {
        id: m.id,
        name: m.fields["Full Name"] || "—",
        role: m.fields["Role"] || "—",
        deliverableCount: myDel.length,
        openItemCount: myOI.length,
        total,
        urgentCount,
        overdueCount,
        stuckCount,
        score,
        status,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── Small stat card ─────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-xs text-slate-500 font-medium mb-1">{label}</p>
      <p className={cn("text-3xl font-bold", color || "text-slate-800")}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Health badge ─────────────────────────────────────────────────────────────
const HEALTH_CONFIG = {
  overwhelmed: { label: "Overwhelmed", color: "bg-red-50 text-red-600 border-red-200",   icon: Flame,         bar: "bg-red-400" },
  busy:        { label: "Busy",        color: "bg-orange-50 text-orange-600 border-orange-200", icon: TrendingUp,  bar: "bg-orange-400" },
  ok:          { label: "OK",          color: "bg-emerald-50 text-emerald-600 border-emerald-200", icon: Shield,  bar: "bg-emerald-400" },
  light:       { label: "Light",       color: "bg-slate-50 text-slate-500 border-slate-200", icon: Minus,       bar: "bg-slate-300" },
};

function HealthBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-red-400" : score >= 55 ? "bg-orange-400" : score >= 20 ? "bg-emerald-400" : "bg-slate-300";
  return (
    <div className="h-1.5 bg-slate-100 rounded-full w-full overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
    </div>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.fill || p.color }}>{p.name}: <strong>{p.value}</strong></p>
      ))}
    </div>
  );
}

// ─── Chart card with source tag ──────────────────────────────────────────────
function ChartCard({ title, source, sub, children }: { title: string; source: string; sub?: string; children: React.ReactNode }) {
  const sourceColors: Record<string, string> = {
    "Deliverables": "bg-sky-50 text-sky-600 border-sky-200",
    "Open Items":   "bg-violet-50 text-violet-600 border-violet-200",
    "Team":         "bg-emerald-50 text-emerald-600 border-emerald-200",
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0", sourceColors[source] || "bg-slate-100 text-slate-500 border-slate-200")}>
          {source}
        </span>
      </div>
      {sub && <p className="text-xs text-slate-400 mb-3">{sub}</p>}
      {!sub && <div className="mb-3" />}
      {children}
    </div>
  );
}

// ─── Section heading ─────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h2>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
type DatePreset = "all" | "this-month" | "last-month" | "this-quarter" | "last-30" | "last-90";
const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-quarter", label: "This quarter" },
  { value: "last-30", label: "Last 30 days" },
  { value: "last-90", label: "Last 90 days" },
];

function getDateRange(preset: DatePreset): { start: Date; end: Date } | null {
  const now = new Date();
  if (preset === "all") return null;
  if (preset === "this-month") return { start: startOfMonth(now), end: endOfMonth(now) };
  if (preset === "last-month") { const lm = subMonths(now, 1); return { start: startOfMonth(lm), end: endOfMonth(lm) }; }
  if (preset === "this-quarter") return { start: startOfQuarter(now), end: endOfQuarter(now) };
  if (preset === "last-30") return { start: subDays(now, 30), end: now };
  if (preset === "last-90") return { start: subDays(now, 90), end: now };
  return null;
}

export default function AnalyticsPage() {
  const { data: members } = useTeamMembers();
  const { data: clients } = useClients();
  const { data: deliverables } = useDeliverables();
  const { data: openItems } = useOpenItems();
  const { selectedOffice } = useOffice();
  const officeClientIds = useMemo(() => new Set((clients || []).filter((c) => (c.fields["Office"] ?? "Irvine") === selectedOffice).map((c) => c.id)), [clients, selectedOffice]);
  const officeDeliverables = useMemo(() => (deliverables || []).filter((d) => officeClientIds.has(d.fields["Client"]?.[0] ?? "")), [deliverables, officeClientIds]);
  const officeOpenItems = useMemo(() => (openItems || []).filter((o) => officeClientIds.has(o.fields["Client"]?.[0] ?? "")), [openItems, officeClientIds]);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [aiPanel, setAiPanel] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<ReassignmentSuggestion[]>([]);
  const [aiSummary, setAiSummary] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);

  const loading = !members || !clients || !deliverables || !openItems;

  const dateRange = useMemo(() => getDateRange(datePreset), [datePreset]);

  // Helper: is a date string within the selected range (using Completion Date / Created At)
  const inRange = (dateStr?: string): boolean => {
    if (!dateRange || !dateStr) return true;
    try {
      const d = parseISO(dateStr);
      return isWithinInterval(d, { start: startOfDay(dateRange.start), end: dateRange.end });
    } catch { return false; }
  };

  // ── Deliverable breakdowns ──────────────────────────────────────────────────
  const deliverableStats = useMemo(() => {
    // When a date range is set, filter by completion date for completions, otherwise show all status
    const all = officeDeliverables.filter((d) => {
      if (!dateRange) return true;
      // Show completed items completed in range + all non-completed
      if (d.fields["Status"] === "Completed") return inRange(d.fields["Completion Date"] || d.fields["Deadline"]);
      return true; // include non-completed always for current state
    });
    const byStatus = Object.entries(
      all.reduce((acc, d) => {
        const s = d.fields["Status"] || "Not Started";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).map(([name, value]) => ({ name, value }));

    const byType = Object.entries(
      all.reduce((acc, d) => {
        const t = d.fields["Type"] || "Unspecified";
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }));

    return { byStatus, byType, total: all.length };
  }, [officeDeliverables, dateRange]);

  // ── Open item breakdowns ────────────────────────────────────────────────────
  const openItemStats = useMemo(() => {
    const all = officeOpenItems.filter((o) => {
      if (!dateRange) return true;
      if (o.fields["Status"] === "Closed") return inRange(o.fields["Completion Date"] || o.fields["Due Date"]);
      return true;
    });
    const active = all.filter((o) => o.fields["Status"] !== "Closed");

    const byStatus = Object.entries(
      all.reduce((acc, o) => {
        const s = o.fields["Status"] || "Not Started";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).map(([name, value]) => ({ name, value }));

    const byType = Object.entries(
      active.reduce((acc, o) => {
        const t = o.fields["Open Item Type"] || "Unspecified";
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }));

    const byPriority = PRIORITIES.map((p) => ({
      name: p,
      value: active.filter((o) => effectivePriority(o.fields["Priority"], o.fields["Due Date"]) === p).length,
    })).filter((d) => d.value > 0);

    const overdue = active.filter((o) => { const n = daysUntil(o.fields["Due Date"]); return n !== null && n < 0; }).length;
    const dueThisWeek = active.filter((o) => { const n = daysUntil(o.fields["Due Date"]); return n !== null && n >= 0 && n <= 7; }).length;

    return { byStatus, byType, byPriority, total: all.length, active: active.length, overdue, dueThisWeek };
  }, [officeOpenItems, dateRange]);

  // ── Team assignment breakdown ───────────────────────────────────────────────
  const teamStats = useMemo(() => {
    const ms = members || [];
    const active = ms.filter((m) => m.fields["Active Status"] !== false);

    const byMember = active.map((m) => {
      const delCount = officeDeliverables.filter(
        (d) => (d.fields["Assigned Team Members"] || []).includes(m.id) && d.fields["Status"] !== "Completed"
      ).length;
      const oiCount = officeOpenItems.filter(
        (o) => (o.fields["Assigned To"] || []).includes(m.id) && o.fields["Status"] !== "Closed"
      ).length;
      return {
        name: (m.fields["Full Name"] || "").split(" ").map((n, i) => i === 0 ? n : n[0] + ".").join(" "),
        deliverables: delCount,
        openItems: oiCount,
        total: delCount + oiCount,
      };
    }).sort((a, b) => b.total - a.total).slice(0, 15);

    const clientsPerMember = active.map((m) => {
      const count = (clients || []).filter((c) => officeClientIds.has(c.id) && [
        ...(c.fields["Producer"] || []),
        ...(c.fields["Service Lead"] || []),
        ...(c.fields["Analyst"] || []),
        ...(c.fields["Assigned Team Members"] || []),
      ].includes(m.id)).length;
      return {
        name: (m.fields["Full Name"] || "").split(" ").map((n, i) => i === 0 ? n : n[0] + ".").join(" "),
        clients: count,
      };
    }).sort((a, b) => b.clients - a.clients).slice(0, 15);

    return { byMember, clientsPerMember };
  }, [members, officeDeliverables, officeOpenItems, clients, officeClientIds]);

  // ── Health ──────────────────────────────────────────────────────────────────
  const health = useMemo(() => {
    if (!members || !officeDeliverables || !officeOpenItems) return [];
    return computeHealth(members, officeDeliverables, officeOpenItems);
  }, [members, officeDeliverables, officeOpenItems]);

  const overwhelmed = health.filter((h) => h.status === "overwhelmed");
  const lightload   = health.filter((h) => h.status === "light" || h.status === "ok").slice(0, 5);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      <PageHeader
        title="Analytics"
        subtitle="Visual breakdown of workload, assignments, and team health"
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 hidden sm:inline">Date range:</span>
            {/* Mobile: dropdown */}
            <select
              className="sm:hidden text-xs font-medium border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            >
              {DATE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            {/* Desktop: pill toggle group */}
            <div className="hidden sm:flex rounded-lg border border-slate-200 overflow-hidden">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setDatePreset(p.value)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                    datePreset === p.value ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* ── Top stats ─────────────────────────────────────────────────────── */}
      <Section title="Overview">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Clients" value={(clients || []).length} sub="active accounts" />
          <StatCard label="Active Deliverables" value={deliverableStats.total} sub="across all clients" />
          <StatCard label="Open Items" value={openItemStats.active} color="text-orange-600" sub={`${openItemStats.overdue} overdue`} />
          <StatCard label="Due This Week" value={openItemStats.dueThisWeek} color={openItemStats.dueThisWeek > 5 ? "text-red-600" : "text-sky-600"} sub="open items" />
        </div>
      </Section>

      {/* ── Deliverables ──────────────────────────────────────────────────── */}
      <Section title="Deliverables">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* By status — pie */}
          <ChartCard title="By Status" source="Deliverables">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={deliverableStats.byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}>
                  {deliverableStats.byStatus.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_PIE_COLORS[entry.name] || "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
          {/* By type — bar */}
          <ChartCard title="By Type" source="Deliverables">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={deliverableStats.byType} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]}>
                  {deliverableStats.byType.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </Section>

      {/* ── Open Items ────────────────────────────────────────────────────── */}
      <Section title="Open Items">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* By status */}
          <ChartCard title="By Status" source="Open Items">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={openItemStats.byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65}>
                  {openItemStats.byStatus.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_PIE_COLORS[entry.name] || "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
          {/* By priority */}
          <ChartCard title="By Priority" source="Open Items">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={openItemStats.byPriority} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65}>
                  {openItemStats.byPriority.map((entry) => {
                    const colors: Record<string, string> = { Urgent: "#f87171", High: "#fb923c", Medium: "#facc15", Low: "#94a3b8" };
                    return <Cell key={entry.name} fill={colors[entry.name] || "#94a3b8"} />;
                  })}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
          {/* By type */}
          <ChartCard title="By Type (Active)" source="Open Items">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={openItemStats.byType} layout="vertical" margin={{ left: 4, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]}>
                  {openItemStats.byType.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </Section>

      {/* ── Team Assignments ──────────────────────────────────────────────── */}
      <Section title="Team Assignments">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Tasks per member */}
          <ChartCard title="Active Tasks per Member" source="Team" sub="Excludes completed/closed items">
            <ResponsiveContainer width="100%" height={Math.max(200, teamStats.byMember.length * 28)}>
              <BarChart data={teamStats.byMember} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="deliverables" name="Deliverables" stackId="a" fill="#38bdf8" radius={[0, 0, 0, 0]} />
                <Bar dataKey="openItems" name="Open Items" stackId="a" fill="#818cf8" radius={[0, 4, 4, 0]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          {/* Clients per member */}
          <ChartCard title="Clients per Member" source="Team" sub="Any role assignment counts">
            <ResponsiveContainer width="100%" height={Math.max(200, teamStats.clientsPerMember.length * 28)}>
              <BarChart data={teamStats.clientsPerMember} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="clients" name="Clients" radius={[0, 4, 4, 0]}>
                  {teamStats.clientsPerMember.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </Section>

      {/* ── Team Health ───────────────────────────────────────────────────── */}
      <Section title="Team Health">
        {/* Alert banner + AI suggest button */}
        <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          {overwhelmed.length > 0 && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 flex-1">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700">
                  {overwhelmed.length} team member{overwhelmed.length !== 1 ? "s" : ""} may need support
                </p>
                <p className="text-xs text-red-500 mt-0.5">
                  {overwhelmed.map((h) => h.name).join(", ")} — consider redistributing tasks
                </p>
              </div>
            </div>
          )}
          <button
            onClick={async () => {
              setAiLoading(true);
              setAiError(null);
              setAiPanel(true);
              try {
                const res = await suggestReassignments();
                setAiSuggestions(res.suggestions || []);
                setAiSummary(res.summary || "");
              } catch (e: any) {
                setAiError(e.message || "Failed to get suggestions");
              } finally {
                setAiLoading(false);
              }
            }}
            disabled={aiLoading}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shrink-0",
              "bg-gradient-to-r from-violet-600 to-sky-600 text-white hover:from-violet-700 hover:to-sky-700 shadow-md hover:shadow-lg",
              aiLoading && "opacity-70 cursor-wait"
            )}
          >
            {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            AI Suggest Reassignments
          </button>
        </div>

        {/* AI Suggestions Panel */}
        {aiPanel && (
          <div className="mb-5 bg-gradient-to-br from-violet-50 to-sky-50 border border-violet-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-violet-200/50">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-600" />
                <span className="text-sm font-semibold text-violet-800">AI Reassignment Suggestions</span>
              </div>
              <button onClick={() => setAiPanel(false)} className="p-1 rounded hover:bg-white/50 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              {aiLoading && (
                <div className="flex items-center justify-center py-8 gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
                  <span className="text-sm text-violet-600">Analyzing team workload...</span>
                </div>
              )}
              {aiError && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{aiError}</div>
              )}
              {!aiLoading && !aiError && (
                <>
                  {aiSummary && !aiSummary.trim().startsWith("{") && !aiSummary.includes('"suggestions"') && (
                    <p className="text-sm text-slate-600 mb-4 leading-relaxed">{aiSummary}</p>
                  )}
                  {aiSuggestions.length === 0 && !aiSummary && (
                    <p className="text-sm text-slate-500 text-center py-4">No reassignment suggestions needed — workload looks balanced.</p>
                  )}
                  {aiSuggestions.length === 0 && aiSummary && (aiSummary.trim().startsWith("{") || aiSummary.includes('"suggestions"')) && (
                    <p className="text-sm text-red-500 text-center py-4">Could not parse AI response. Please try again.</p>
                  )}
                  <div className="space-y-3">
                    {aiSuggestions.map((s, i) => {
                      const priorityColors = {
                        high: "bg-red-100 text-red-700 border-red-200",
                        medium: "bg-amber-100 text-amber-700 border-amber-200",
                        low: "bg-slate-100 text-slate-600 border-slate-200",
                      };
                      const fromMember = (members || []).find((m) => m.id === s.fromMemberId);
                      const toMember = (members || []).find((m) => m.id === s.toMemberId);
                      return (
                        <div key={i} className="bg-white rounded-lg border border-slate-200 p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-slate-800 truncate">{s.taskName}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                                  {s.taskType === "deliverable" ? "Deliverable" : "Open Item"}
                                </span>
                                <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", priorityColors[s.priority])}>
                                  {s.priority}
                                </span>
                                {s.sameClient && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200">
                                    Same client
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-3">
                            <Link href={`/team/${s.fromMemberId}`}>
                              <a className="flex items-center gap-1.5 group">
                                <img
                                  src={getAvatarUrl(s.fromMemberName, fromMember?.fields["Avatar Seed"])}
                                  className="w-6 h-6 rounded-full"
                                  alt=""
                                />
                                <span className="text-xs font-medium text-slate-700 group-hover:text-sky-600 transition-colors">{s.fromMemberName}</span>
                              </a>
                            </Link>
                            <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <Link href={`/team/${s.toMemberId}`}>
                              <a className="flex items-center gap-1.5 group">
                                <img
                                  src={getAvatarUrl(s.toMemberName, toMember?.fields["Avatar Seed"])}
                                  className="w-6 h-6 rounded-full"
                                  alt=""
                                />
                                <span className="text-xs font-medium text-slate-700 group-hover:text-sky-600 transition-colors">{s.toMemberName}</span>
                              </a>
                            </Link>
                          </div>
                          <p className="text-xs text-slate-500 mt-2 leading-relaxed">{s.reason}</p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {health.map((h) => {
            const cfg = HEALTH_CONFIG[h.status];
            const Icon = cfg.icon;
            const member = (members || []).find((m) => m.id === h.id);
            return (
              <Link key={h.id} href={`/team/${h.id}`}>
                <a className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={getAvatarUrl(h.name, member?.fields["Avatar Seed"])}
                        alt={h.name}
                        className="w-8 h-8 rounded-full shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 text-sm truncate">{h.name}</p>
                        <p className="text-xs text-slate-400 truncate">{h.role}</p>
                      </div>
                    </div>
                    <span className={cn("flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border shrink-0", cfg.color)}>
                      <Icon className="w-3 h-3" />
                      {cfg.label}
                    </span>
                  </div>

                  <HealthBar score={h.score} />

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-base font-bold text-slate-700">{h.deliverableCount}</p>
                      <p className="text-[10px] text-slate-400">deliverables</p>
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-700">{h.openItemCount}</p>
                      <p className="text-[10px] text-slate-400">open items</p>
                    </div>
                    <div>
                      <p className={cn("text-base font-bold", h.urgentCount > 0 ? "text-orange-500" : "text-slate-700")}>{h.urgentCount}</p>
                      <p className="text-[10px] text-slate-400">due 7 days</p>
                    </div>
                  </div>

                  {(h.overdueCount > 0 || h.stuckCount > 0) && (
                    <div className="mt-2 pt-2 border-t border-slate-100 flex gap-3 text-xs">
                      {h.overdueCount > 0 && (
                        <span className="text-red-500 font-medium">⚠ {h.overdueCount} overdue</span>
                      )}
                      {h.stuckCount > 0 && (
                        <span className="text-orange-500 font-medium">↯ {h.stuckCount} stuck</span>
                      )}
                    </div>
                  )}
                </a>
              </Link>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
