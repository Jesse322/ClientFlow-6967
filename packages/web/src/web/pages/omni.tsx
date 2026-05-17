import { useState, useMemo, useCallback } from "react";
import { useClients } from "@/hooks/useData";
import { getOmniSolutions, updateClientOmni } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-header";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Search, X, CheckSquare2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import type { AirtableRecord, Client, OmniSolution } from "@/lib/types";
import { OMNI_CATEGORIES, type OmniCategory } from "@/lib/types";
import { useEffect, useRef } from "react";

// Short display labels for tabs
const CATEGORY_LABELS: Record<OmniCategory, string> = {
  "OMNI - Medical": "Medical",
  "OMNI - HR Support": "HR Support",
  "OMNI - Population Health": "Pop. Health",
  "OMNI - Compliance": "Compliance",
  "OMNI - Pharmacy": "Pharmacy",
  "OMNI - Care Intervention": "Care Intervention",
  "OMNI - Ancillary": "Ancillary",
};

// Category accent colors
const CATEGORY_COLORS: Record<OmniCategory, { bg: string; text: string; dot: string }> = {
  "OMNI - Medical":           { bg: "bg-sky-50",      text: "text-sky-700",    dot: "bg-sky-400" },
  "OMNI - HR Support":        { bg: "bg-violet-50",   text: "text-violet-700", dot: "bg-violet-400" },
  "OMNI - Population Health": { bg: "bg-emerald-50",  text: "text-emerald-700",dot: "bg-emerald-400" },
  "OMNI - Compliance":        { bg: "bg-amber-50",    text: "text-amber-700",  dot: "bg-amber-400" },
  "OMNI - Pharmacy":          { bg: "bg-rose-50",     text: "text-rose-700",   dot: "bg-rose-400" },
  "OMNI - Care Intervention": { bg: "bg-orange-50",   text: "text-orange-700", dot: "bg-orange-400" },
  "OMNI - Ancillary":         { bg: "bg-teal-50",     text: "text-teal-700",   dot: "bg-teal-400" },
};

// Fetch OMNI solutions once
function useOmni() {
  const [data, setData] = useState<AirtableRecord<OmniSolution>[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getOmniSolutions()
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);
  return { data, loading };
}

// Build a flat list of {category, name, id} from omni records, for a given category filter
function buildCategoryItems(
  omniItems: AirtableRecord<OmniSolution>[],
  category: OmniCategory | "all"
): { id: string; category: OmniCategory; name: string }[] {
  const items: { id: string; category: OmniCategory; name: string }[] = [];
  const cats = category === "all" ? OMNI_CATEGORIES : [category];
  for (const cat of cats) {
    for (const rec of omniItems) {
      const name = rec.fields[cat];
      if (name) {
        items.push({ id: rec.id, category: cat, name });
      }
    }
  }
  return items;
}

// Individual client OMNI card
function ClientOmniCard({
  client,
  omniItems,
  activeCategory,
  onUpdate,
}: {
  client: AirtableRecord<Client>;
  omniItems: AirtableRecord<OmniSolution>[];
  activeCategory: OmniCategory | "all";
  onUpdate: (clientId: string, newIds: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const selectedIds = useMemo(
    () => new Set<string>(client.fields["OMNI Solutions"] || []),
    [client.fields["OMNI Solutions"]]
  );

  // Build grouped items per category
  const groupedItems = useMemo(() => {
    const cats = activeCategory === "all" ? OMNI_CATEGORIES : [activeCategory];
    return cats
      .map((cat) => ({
        category: cat,
        items: omniItems.filter((rec) => !!rec.fields[cat]),
      }))
      .filter((g) => g.items.length > 0);
  }, [omniItems, activeCategory]);

  // All items currently visible (flattened)
  const visibleItems = useMemo(
    () => groupedItems.flatMap((g) => g.items),
    [groupedItems]
  );

  const visibleChecked = useMemo(
    () => visibleItems.filter((i) => selectedIds.has(i.id)).length,
    [visibleItems, selectedIds]
  );

  const totalChecked = selectedIds.size;
  const f = client.fields;

  const toggle = useCallback(
    async (omniId: string) => {
      const next = new Set(selectedIds);
      if (next.has(omniId)) next.delete(omniId);
      else next.add(omniId);
      const newIds = [...next];
      setSaving(omniId);
      try {
        await updateClientOmni(client.id, newIds);
        onUpdate(client.id, newIds);
      } catch {
        toast.error("Failed to update");
      } finally {
        setSaving(null);
      }
    },
    [client.id, selectedIds, onUpdate]
  );

  return (
    <div
      className={cn(
        "bg-white rounded-xl border transition-all",
        expanded
          ? "border-sky-200 shadow-sm"
          : "border-slate-200 hover:border-slate-300"
      )}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">
            {f["Client Name"]}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {f["Funding Strategy"] && (
              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                {f["Funding Strategy"]}
              </span>
            )}
            {f["Company Size"] && (
              <span className="text-[10px] text-slate-400">
                {f["Company Size"]} ee
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {visibleChecked > 0 && (
            <span className="text-xs font-semibold text-sky-600 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">
              {visibleChecked} / {visibleItems.length}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </div>
      </button>

      {/* Progress bar */}
      {visibleChecked > 0 && (
        <div className="px-4 pb-2">
          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-400 rounded-full transition-all"
              style={{
                width: `${(visibleChecked / Math.max(visibleItems.length, 1)) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* OMNI checklist grouped by category */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-3 max-h-80 overflow-y-auto space-y-4">
          {groupedItems.map(({ category, items }) => {
            const colors = CATEGORY_COLORS[category];
            return (
              <div key={category}>
                {/* Category subheader */}
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className={cn("w-1.5 h-1.5 rounded-full", colors.dot)} />
                  <p className={cn("text-[11px] font-semibold uppercase tracking-wide", colors.text)}>
                    {CATEGORY_LABELS[category]}
                  </p>
                </div>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const isChecked = selectedIds.has(item.id);
                    const isSaving = saving === item.id;
                    const itemName = item.fields[category] || "";
                    return (
                      <button
                        key={item.id}
                        onClick={() => toggle(item.id)}
                        disabled={!!saving}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors text-sm",
                          isChecked
                            ? cn(colors.bg, colors.text)
                            : "hover:bg-slate-50 text-slate-600",
                          saving && saving !== item.id && "opacity-50"
                        )}
                      >
                        <div
                          className={cn(
                            "w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors",
                            isChecked
                              ? cn(colors.dot, "border-transparent")
                              : "border-slate-300 bg-white"
                          )}
                        >
                          {isSaving ? (
                            <Loader2 className="w-3 h-3 text-white animate-spin" />
                          ) : isChecked ? (
                            <svg
                              className="w-2.5 h-2.5 text-white"
                              viewBox="0 0 10 8"
                              fill="none"
                            >
                              <path
                                d="M1 4l3 3 5-6"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : null}
                        </div>
                        <span
                          className={cn(
                            "flex-1 leading-tight",
                            isChecked && "font-medium"
                          )}
                        >
                          {itemName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {groupedItems.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-2">
              No items in this category
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function OmniPage() {
  const { data: clients, loading: clientsLoading } = useClients();
  const { data: omniItems, loading: omniLoading } = useOmni();

  // Local mirror of client OMNI selections
  const [clientOmni, setClientOmni] = useState<Record<string, string[]>>({});
  const initialized = useRef(false);

  useEffect(() => {
    if (clients && !initialized.current) {
      const map: Record<string, string[]> = {};
      clients.forEach((c) => {
        map[c.id] = c.fields["OMNI Solutions"] || [];
      });
      setClientOmni(map);
      initialized.current = true;
    }
  }, [clients]);

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("active");
  const [activeCategory, setActiveCategory] = useState<OmniCategory | "all">("all");

  // Enrich clients with local OMNI state
  const enrichedClients = useMemo(() => {
    if (!clients) return [];
    return clients.map((c) => ({
      ...c,
      fields: {
        ...c.fields,
        "OMNI Solutions": clientOmni[c.id] ?? c.fields["OMNI Solutions"] ?? [],
      },
    }));
  }, [clients, clientOmni]);

  const filtered = useMemo(() => {
    let list = enrichedClients;
    if (activeFilter === "active") list = list.filter((c) => c.fields["Active"]);
    if (activeFilter === "inactive") list = list.filter((c) => !c.fields["Active"]);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.fields["Client Name"]?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [enrichedClients, search, activeFilter]);

  const handleUpdate = useCallback(
    (clientId: string, newIds: string[]) => {
      setClientOmni((prev) => ({ ...prev, [clientId]: newIds }));
      toast.success("OMNI selections updated");
    },
    []
  );

  const loading = clientsLoading || omniLoading;

  // Summary stats
  const totalChecked = useMemo(
    () => Object.values(clientOmni).reduce((sum, ids) => sum + ids.length, 0),
    [clientOmni]
  );
  const clientsWithItems = useMemo(
    () => Object.values(clientOmni).filter((ids) => ids.length > 0).length,
    [clientOmni]
  );

  // Per-category item counts (for tab badges)
  const categoryItemCounts = useMemo(() => {
    if (!omniItems) return {} as Record<OmniCategory, number>;
    const counts = {} as Record<OmniCategory, number>;
    for (const cat of OMNI_CATEGORIES) {
      counts[cat] = omniItems.filter((r) => !!r.fields[cat]).length;
    }
    return counts;
  }, [omniItems]);

  return (
    <div>
      <PageHeader
        title="OMNI Solutions"
        subtitle={`${clientsWithItems} clients with selections · ${totalChecked} total items checked`}
      />

      {/* Client filter + search row */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {(["active", "all", "inactive"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                activeFilter === f
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="relative w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
            className="pl-8 h-9 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="w-3 h-3 text-slate-400" />
            </button>
          )}
        </div>
      </div>

      {/* Category filter tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        <button
          onClick={() => setActiveCategory("all")}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
            activeCategory === "all"
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
          )}
        >
          All Categories
          {omniItems && (
            <span className={cn(
              "ml-1.5 text-[10px] font-normal",
              activeCategory === "all" ? "text-slate-300" : "text-slate-400"
            )}>
              {omniItems.length}
            </span>
          )}
        </button>

        {OMNI_CATEGORIES.map((cat) => {
          const colors = CATEGORY_COLORS[cat];
          const isActive = activeCategory === cat;
          const count = categoryItemCounts[cat] ?? 0;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5",
                isActive
                  ? cn(colors.bg, colors.text, "border-transparent")
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              )}
            >
              {isActive && (
                <div className={cn("w-1.5 h-1.5 rounded-full", colors.dot)} />
              )}
              {CATEGORY_LABELS[cat]}
              <span className={cn(
                "text-[10px] font-normal",
                isActive ? colors.text : "text-slate-400"
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-7 h-7 border-2 border-sky-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <CheckSquare2 className="w-4 h-4 text-slate-400" />
            <p className="text-xs text-slate-500">
              Click a client card to expand, then check/uncheck OMNI items. Changes save instantly.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((client) => (
              <ClientOmniCard
                key={client.id}
                client={client}
                omniItems={omniItems || []}
                activeCategory={activeCategory}
                onUpdate={handleUpdate}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-16 text-slate-400 text-sm">
              No clients match your search
            </div>
          )}
        </>
      )}
    </div>
  );
}
