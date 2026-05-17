import { useState, useMemo, useRef } from "react";
import { useDeliverables, useClients, useOpenItems } from "@/hooks/useData";
import { useOffice } from "@/lib/office-context";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, daysUntil, urgencyColor, cn } from "@/lib/utils";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay,
  parseISO, isValid, startOfWeek, endOfWeek, addMonths, subMonths,
} from "date-fns";
import {
  ChevronLeft, ChevronRight, CalendarDays, List, Download,
  Search, X, ChevronDown, Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
type ViewMode = "calendar" | "list";
type Filter = "all" | "compliance" | "deliverables" | "open-items";

const COMPLIANCE_TYPES = ["IRS", "ERISA", "CMS", "Compliance"];

// ── Client combobox ──────────────────────────────────────────────────────────
function ClientPicker({
  clients,
  value,
  onChange,
}: {
  clients: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!q) return clients;
    const lq = q.toLowerCase();
    return clients.filter((c) => c.name.toLowerCase().includes(lq));
  }, [clients, q]);

  const selected = clients.find((c) => c.id === value);

  // Close on outside click
  useState(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  });

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 h-9 px-3 rounded-lg border text-sm transition-colors min-w-[180px] max-w-[240px]",
          value
            ? "border-sky-300 bg-sky-50 text-sky-800"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
        )}
      >
        <span className="flex-1 text-left truncate text-xs font-medium">
          {selected ? selected.name : "All clients"}
        </span>
        {value ? (
          <X
            className="w-3.5 h-3.5 shrink-0 text-sky-400 hover:text-sky-600"
            onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }}
          />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-white border border-slate-200 rounded-xl shadow-lg w-64">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search clients…"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-sky-300"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              onClick={() => { onChange(null); setOpen(false); setQ(""); }}
              className={cn(
                "w-full text-left px-3 py-2 text-xs hover:bg-slate-50 transition-colors",
                !value ? "font-semibold text-slate-800" : "text-slate-600"
              )}
            >
              All clients
            </button>
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => { onChange(c.id); setOpen(false); setQ(""); }}
                className={cn(
                  "w-full text-left px-3 py-2 text-xs hover:bg-slate-50 transition-colors truncate",
                  value === c.id ? "font-semibold text-sky-700 bg-sky-50" : "text-slate-600"
                )}
              >
                {c.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">No clients found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── PDF export ───────────────────────────────────────────────────────────────
// ── Main page ────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const { data: deliverables } = useDeliverables();
  const { data: openItems } = useOpenItems();
  const { data: clients } = useClients();
  const { selectedOffice } = useOffice();
  const officeClientIds = useMemo(() => new Set((clients || []).filter((c) => (c.fields["Office"] ?? "Irvine") === selectedOffice).map((c) => c.id)), [clients, selectedOffice]);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const clientMap = useMemo(() => {
    const map: Record<string, string> = {};
    (clients || []).filter((c) => officeClientIds.has(c.id)).forEach((c) => { map[c.id] = c.fields["Client Name"]; });
    return map;
  }, [clients, officeClientIds]);

  const clientList = useMemo(
    () =>
      (clients || [])
        .filter((c) => c.fields["Active"] && officeClientIds.has(c.id))
        .map((c) => ({ id: c.id, name: c.fields["Client Name"] }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clients, officeClientIds]
  );

  const selectedClientName = selectedClientId ? clientMap[selectedClientId] ?? null : null;

  // Build event list
  const events = useMemo(() => {
    const list: {
      id: string;
      date: string;
      title: string;
      client?: string;
      clientId?: string;
      type: "deliverable" | "open-item";
      category?: string;
      status?: string;
    }[] = [];

    (deliverables || []).filter((d) => officeClientIds.has(d.fields["Client"]?.[0] ?? "")).forEach((d) => {
      if (!d.fields["Deadline"]) return;
      if (d.fields["Status"] === "Completed") return;
      const cid = d.fields["Client"]?.[0];
      list.push({
        id: d.id,
        date: d.fields["Deadline"],
        title: d.fields["Deliverable Name"],
        client: cid ? clientMap[cid] : undefined,
        clientId: cid,
        type: "deliverable",
        category: d.fields["Type"],
        status: d.fields["Status"],
      });
    });

    (openItems || []).filter((o) => officeClientIds.has(o.fields["Client"]?.[0] ?? "")).forEach((o) => {
      if (!o.fields["Due Date"]) return;
      if (o.fields["Status"] === "Closed") return;
      const cid = o.fields["Client"]?.[0];
      list.push({
        id: o.id,
        date: o.fields["Due Date"],
        title: o.fields["Open Item Name"],
        client: cid ? clientMap[cid] : undefined,
        clientId: cid,
        type: "open-item",
        category: o.fields["Open Item Type"],
        status: o.fields["Status"],
      });
    });

    return list;
  }, [deliverables, openItems, clientMap, officeClientIds]);

  // Apply client filter first, then type filter
  const filteredEvents = useMemo(() => {
    let list = events;

    // Client filter
    if (selectedClientId) {
      list = list.filter((e) => e.clientId === selectedClientId);
    }

    // Type filter
    if (filter === "compliance") return list.filter((e) => e.type === "deliverable" && COMPLIANCE_TYPES.includes(e.category || ""));
    if (filter === "deliverables") return list.filter((e) => e.type === "deliverable");
    if (filter === "open-items") return list.filter((e) => e.type === "open-item");
    return list;
  }, [events, filter, selectedClientId]);

  // Calendar grid
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const getEventsForDay = (day: Date) =>
    filteredEvents.filter((e) => {
      try {
        const d = parseISO(e.date);
        return isValid(d) && isSameDay(d, day);
      } catch { return false; }
    });

  const selectedDayEvents = selectedDay ? getEventsForDay(selectedDay) : [];

  // List view
  const listEvents = useMemo(() => {
    return filteredEvents
      .filter((e) => { try { return isValid(parseISO(e.date)); } catch { return false; } })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredEvents]);

  const upcomingList = useMemo(() => {
    return listEvents.filter((e) => {
      const days = daysUntil(e.date);
      return days !== null && days >= -7 && days <= 90;
    });
  }, [listEvents]);

  const totalCompliance = useMemo(
    () => filteredEvents.filter((e) => e.type === "deliverable" && COMPLIANCE_TYPES.includes(e.category || "")).length,
    [filteredEvents]
  );
  const totalUpcoming30 = useMemo(
    () => filteredEvents.filter((e) => { const d = daysUntil(e.date); return d !== null && d >= 0 && d <= 30; }).length,
    [filteredEvents]
  );

  async function handleExport() {
    setExporting(true);
    try {
      const { exportCalendarPDF } = await import("@/lib/calendar-pdf");
      const selectedClient = selectedClientId ? (clients || []).find(c => c.id === selectedClientId) : null;
      const theme = selectedClient ? {
        themeColor: selectedClient.fields["Theme Color"],
        headerPhotoUrl: selectedClient.fields["Header Photo URL"],
        headerPhotoSource: selectedClient.fields["Header Photo Source"],
        clientId: selectedClient.id,
      } : undefined;
      await exportCalendarPDF(filteredEvents, selectedClientName, theme);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Compliance Calendar"
        subtitle={
          selectedClientId
            ? `${selectedClientName} · ${totalCompliance} compliance deadlines · ${totalUpcoming30} in next 30 days`
            : `${totalCompliance} compliance deadlines · ${totalUpcoming30} events in the next 30 days`
        }
      />

      {/* Controls row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-5">
        {/* Row 1 on mobile: type filter + view toggle */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Type filter — scrollable on mobile */}
          <div className="flex rounded-lg border border-slate-200 overflow-x-auto no-scrollbar">
            {([["all", "All"], ["compliance", "Compliance"], ["deliverables", "Deliveries"], ["open-items", "Open Items"]] as [Filter, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFilter(val)}
                className={cn(
                  "px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0",
                  filter === val ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* View toggle — pushed right on mobile */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden ml-auto sm:hidden">
            <button
              onClick={() => setViewMode("calendar")}
              className={cn("px-2.5 py-1.5 text-xs font-medium flex items-center gap-1", viewMode === "calendar" ? "bg-slate-900 text-white" : "bg-white text-slate-600")}
            >
              <CalendarDays className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn("px-2.5 py-1.5 text-xs font-medium flex items-center gap-1", viewMode === "list" ? "bg-slate-900 text-white" : "bg-white text-slate-600")}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Row 2 on mobile: client picker + export */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Client filter */}
          <ClientPicker
            clients={clientList}
            value={selectedClientId}
            onChange={setSelectedClientId}
          />

          {/* Export PDF */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors shrink-0",
              exporting
                ? "border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300"
            )}
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">Export PDF</span>
          </button>

          {/* View toggle — desktop only */}
          <div className="hidden sm:flex rounded-lg border border-slate-200 overflow-hidden ml-auto">
            <button
              onClick={() => setViewMode("calendar")}
              className={cn("px-3 py-1.5 text-xs font-medium flex items-center gap-1.5", viewMode === "calendar" ? "bg-slate-900 text-white" : "bg-white text-slate-600")}
            >
              <CalendarDays className="w-3.5 h-3.5" /> Calendar
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn("px-3 py-1.5 text-xs font-medium flex items-center gap-1.5", viewMode === "list" ? "bg-slate-900 text-white" : "bg-white text-slate-600")}
            >
              <List className="w-3.5 h-3.5" /> List
            </button>
          </div>
        </div>
      </div>

      {/* Client filter active banner */}
      {selectedClientId && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-700">
          <div className="w-1.5 h-1.5 rounded-full bg-sky-400" />
          Showing events for <span className="font-semibold">{selectedClientName}</span>
          <button
            onClick={() => setSelectedClientId(null)}
            className="ml-auto text-sky-400 hover:text-sky-600 font-medium"
          >
            Clear filter
          </button>
        </div>
      )}

      {viewMode === "calendar" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Calendar */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* Month nav */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1.5 rounded hover:bg-slate-100">
                <ChevronLeft className="w-4 h-4 text-slate-600" />
              </button>
              <h2 className="text-base font-semibold text-slate-800">
                {format(currentMonth, "MMMM yyyy")}
              </h2>
              <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1.5 rounded hover:bg-slate-100">
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-slate-100">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-slate-400">{d}</div>
              ))}
            </div>

            {/* Days */}
            <div className="grid grid-cols-7">
              {calendarDays.map((day, i) => {
                const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
                const dayEvents = getEventsForDay(day);
                const isToday = isSameDay(day, new Date());
                const isSelected = selectedDay && isSameDay(day, selectedDay);

                return (
                  <div
                    key={i}
                    onClick={() => setSelectedDay(isSelected ? null : day)}
                    className={cn(
                      "min-h-[72px] p-1.5 border-b border-r border-slate-50 cursor-pointer transition-colors",
                      !isCurrentMonth && "bg-slate-50/50 opacity-40",
                      isSelected && "bg-sky-50",
                      isToday && !isSelected && "bg-amber-50/40"
                    )}
                  >
                    <div className={cn(
                      "w-6 h-6 flex items-center justify-center rounded-full text-xs mb-1 font-medium",
                      isToday ? "bg-sky-500 text-white" : "text-slate-700"
                    )}>
                      {format(day, "d")}
                    </div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((e) => (
                        <div
                          key={e.id}
                          className={cn(
                            "text-[9px] leading-tight px-1 py-0.5 rounded truncate font-medium",
                            e.type === "deliverable"
                              ? COMPLIANCE_TYPES.includes(e.category || "")
                                ? "bg-violet-100 text-violet-700"
                                : "bg-sky-100 text-sky-700"
                              : "bg-amber-100 text-amber-700"
                          )}
                        >
                          {e.title}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="text-[9px] text-slate-400 font-medium pl-1">+{dayEvents.length - 3} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Side panel */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800 text-sm">
                {selectedDay ? format(selectedDay, "MMMM d, yyyy") : "Select a date"}
              </h3>
              {selectedDay && <p className="text-xs text-slate-400">{selectedDayEvents.length} event{selectedDayEvents.length !== 1 ? "s" : ""}</p>}
            </div>
            {!selectedDay ? (
              <div className="px-5 py-8 text-center text-slate-400 text-sm">Click a date to see events</div>
            ) : selectedDayEvents.length === 0 ? (
              <div className="px-5 py-8 text-center text-slate-400 text-sm">No events on this day</div>
            ) : (
              <div className="divide-y divide-slate-50 flex-1 overflow-y-auto">
                {selectedDayEvents.map((e) => (
                  <div key={e.id} className="px-5 py-3">
                    <div className="flex items-start gap-2">
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                        e.type === "deliverable"
                          ? COMPLIANCE_TYPES.includes(e.category || "") ? "bg-violet-500" : "bg-sky-500"
                          : "bg-amber-500"
                      )} />
                      <div>
                        <p className="text-sm font-medium text-slate-800">{e.title}</p>
                        {e.client && <p className="text-xs text-slate-400">{e.client}</p>}
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {e.category && <StatusBadge label={e.category} variant={e.type === "deliverable" ? "type" : "default"} />}
                          {e.status && <StatusBadge label={e.status} variant="status" />}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Legend */}
            <div className="px-5 py-4 border-t border-slate-100 mt-auto">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Legend</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2"><div className="w-3 h-2 rounded bg-violet-100 border border-violet-300" /><span className="text-xs text-slate-600">Compliance Deadline</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-2 rounded bg-sky-100 border border-sky-300" /><span className="text-xs text-slate-600">Deliverable</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-2 rounded bg-amber-100 border border-amber-300" /><span className="text-xs text-slate-600">Open Item</span></div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        // List view
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Next 90 days · {upcomingList.length} events
          </div>
          {upcomingList.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">No upcoming events</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {upcomingList.map((e) => {
                const days = daysUntil(e.date);
                return (
                  <div key={e.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/50">
                    <div className="w-16 shrink-0 text-center">
                      <p className="text-lg font-bold text-slate-800">{format(parseISO(e.date), "d")}</p>
                      <p className="text-xs text-slate-400">{format(parseISO(e.date), "MMM")}</p>
                    </div>
                    <div className={cn("w-1 h-10 rounded-full shrink-0", e.type === "deliverable" ? COMPLIANCE_TYPES.includes(e.category || "") ? "bg-violet-400" : "bg-sky-400" : "bg-amber-400")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{e.title}</p>
                      <p className="text-xs text-slate-400 truncate">{e.client || "No client"}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {e.category && <StatusBadge label={e.category} variant={e.type === "deliverable" ? "type" : "default"} />}
                      <span className={cn("text-xs font-medium", urgencyColor(days))}>
                        {days === 0 ? "Today" : days === 1 ? "Tomorrow" : days !== null ? `${days}d` : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
