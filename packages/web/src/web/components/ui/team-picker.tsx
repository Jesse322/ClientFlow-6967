import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import type { AirtableRecord, TeamMember } from "@/lib/types";

interface Props {
  teamMembers: AirtableRecord<TeamMember>[];
  selected: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  maxHeight?: string;
}

export function TeamPicker({ teamMembers, selected, onChange, label = "Assign Team Members", maxHeight = "max-h-48" }: Props) {
  const [search, setSearch] = useState("");

  const active = teamMembers.filter((m) => m.fields["Active Status"] !== false && m.fields["Full Name"]);
  const filtered = active.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return m.fields["Full Name"]?.toLowerCase().includes(q) || m.fields["Role"]?.toLowerCase().includes(q);
  });

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const getName = (id: string) => teamMembers.find((m) => m.id === id)?.fields["Full Name"] || id;
  const getRole = (id: string) => teamMembers.find((m) => m.id === id)?.fields["Role"] || "";
  const getInitials = (name: string) => name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div>
      <label className="text-xs font-medium text-slate-600 block mb-1.5">{label}</label>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((id) => (
            <span key={id} className="flex items-center gap-1 bg-sky-50 border border-sky-200 text-sky-700 text-xs px-2 py-1 rounded-full">
              {getName(id)}
              <button type="button" onClick={() => toggle(id)} className="hover:text-sky-900 ml-0.5">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search members…"
          className="pl-8 h-8 text-sm"
        />
      </div>

      {/* List */}
      <div className={cn("overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50", maxHeight)}>
        {filtered.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">No members found</p>
        ) : filtered.map((m) => {
          const isSelected = selected.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => toggle(m.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50",
                isSelected && "bg-sky-50"
              )}
            >
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                isSelected ? "bg-sky-500 text-white" : "bg-slate-200 text-slate-600"
              )}>
                {getInitials(m.fields["Full Name"] || "")}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm truncate", isSelected ? "font-medium text-sky-800" : "text-slate-700")}>
                  {m.fields["Full Name"]}
                </p>
                {m.fields["Role"] && <p className="text-xs text-slate-400 truncate">{m.fields["Role"]}</p>}
              </div>
              {isSelected && (
                <div className="w-4 h-4 rounded-full bg-sky-500 flex items-center justify-center shrink-0">
                  <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
