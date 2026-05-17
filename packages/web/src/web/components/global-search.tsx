import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useClients, useOpenItems, useDeliverables } from "@/hooks/useData";
import { Search, Users, AlertCircle, CheckSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ResultType = "client" | "open-item" | "deliverable";
interface SearchResult {
  id: string;
  type: ResultType;
  title: string;
  sub?: string;
  href: string;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  const { data: clients } = useClients();
  const { data: openItems } = useOpenItems();
  const { data: deliverables } = useDeliverables();

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else setQuery("");
  }, [open]);

  // Build client map for lookups
  const clientMap = useMemo(() => {
    const m: Record<string, string> = {};
    (clients || []).forEach((c) => { m[c.id] = c.fields["Client Name"] || ""; });
    return m;
  }, [clients]);

  const results: SearchResult[] = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const out: SearchResult[] = [];

    // Clients
    (clients || []).forEach((c) => {
      const name = c.fields["Client Name"] || "";
      if (name.toLowerCase().includes(q)) {
        out.push({
          id: c.id,
          type: "client",
          title: name,
          sub: [c.fields["Funding Strategy"], c.fields["Segment"], c.fields["Location"]].filter(Boolean).join(" · "),
          href: `/clients/${c.id}`,
        });
      }
    });

    // Open items
    (openItems || []).forEach((o) => {
      const name = o.fields["Open Item Name"] || "";
      const notes = o.fields["Notes"] || "";
      if (name.toLowerCase().includes(q) || notes.toLowerCase().includes(q)) {
        const cid = o.fields["Client"]?.[0];
        out.push({
          id: o.id,
          type: "open-item",
          title: name,
          sub: [cid ? clientMap[cid] : undefined, o.fields["Status"]].filter(Boolean).join(" · "),
          href: "/open-items",
        });
      }
    });

    // Deliverables
    (deliverables || []).forEach((d) => {
      const name = d.fields["Deliverable Name"] || "";
      if (name.toLowerCase().includes(q)) {
        const cid = d.fields["Client"]?.[0];
        out.push({
          id: d.id,
          type: "deliverable",
          title: name,
          sub: [cid ? clientMap[cid] : undefined, d.fields["Status"]].filter(Boolean).join(" · "),
          href: "/deliverables",
        });
      }
    });

    return out.slice(0, 12);
  }, [query, clients, openItems, deliverables, clientMap]);

  const grouped = useMemo(() => {
    const g: { label: string; icon: React.ReactNode; items: SearchResult[] }[] = [];
    const clientResults = results.filter((r) => r.type === "client");
    const oiResults = results.filter((r) => r.type === "open-item");
    const delResults = results.filter((r) => r.type === "deliverable");
    if (clientResults.length) g.push({ label: "Clients", icon: <Users className="w-3.5 h-3.5" />, items: clientResults });
    if (oiResults.length) g.push({ label: "Open Items", icon: <AlertCircle className="w-3.5 h-3.5" />, items: oiResults });
    if (delResults.length) g.push({ label: "Deliverables", icon: <CheckSquare className="w-3.5 h-3.5" />, items: delResults });
    return g;
  }, [results]);

  const flatResults = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  useEffect(() => { setCursor(0); }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, flatResults.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && flatResults[cursor]) {
      navigate(flatResults[cursor].href);
      setOpen(false);
    }
  };

  const typeIcon = (t: ResultType) => {
    if (t === "client") return <Users className="w-3.5 h-3.5 text-sky-500" />;
    if (t === "open-item") return <AlertCircle className="w-3.5 h-3.5 text-amber-500" />;
    return <CheckSquare className="w-3.5 h-3.5 text-violet-500" />;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4" onClick={() => setOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search clients, open items, deliverables…"
            className="flex-1 text-sm text-slate-800 placeholder:text-slate-400 bg-transparent outline-none"
          />
          {query && (
            <button onClick={() => setQuery("")} className="p-1 rounded hover:bg-slate-100 text-slate-400">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 font-mono shrink-0">
            ESC
          </kbd>
        </div>

        {/* Results */}
        {query.trim() === "" ? (
          <div className="px-4 py-6 text-center text-sm text-slate-400">
            Type to search across all clients, open items, and deliverables
            <div className="mt-2 flex items-center justify-center gap-1 text-xs text-slate-300">
              <kbd className="bg-slate-100 rounded px-1.5 py-0.5 font-mono text-slate-400">⌘K</kbd>
              <span>to open · </span>
              <kbd className="bg-slate-100 rounded px-1.5 py-0.5 font-mono text-slate-400">↑↓</kbd>
              <span>to navigate · </span>
              <kbd className="bg-slate-100 rounded px-1.5 py-0.5 font-mono text-slate-400">↵</kbd>
              <span>to open</span>
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">No results for "{query}"</div>
        ) : (
          <div className="max-h-96 overflow-y-auto py-2">
            {grouped.map((group) => {
              return (
                <div key={group.label}>
                  <div className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    {group.icon} {group.label}
                  </div>
                  {group.items.map((result) => {
                    const idx = flatResults.indexOf(result);
                    return (
                      <button
                        key={result.id}
                        onClick={() => { navigate(result.href); setOpen(false); }}
                        onMouseEnter={() => setCursor(idx)}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                          cursor === idx ? "bg-sky-50" : "hover:bg-slate-50"
                        )}
                      >
                        <span className="shrink-0">{typeIcon(result.type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{result.title}</p>
                          {result.sub && <p className="text-xs text-slate-400 truncate">{result.sub}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Button to trigger search — place in topbar
export function SearchTrigger() {
  return (
    <button
      onClick={() => {
        const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
        window.dispatchEvent(event);
      }}
      className="flex items-center gap-2 h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 transition-colors text-xs"
    >
      <Search className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden sm:inline text-[10px] bg-slate-100 rounded px-1 py-0.5 font-mono text-slate-400">⌘K</kbd>
    </button>
  );
}
