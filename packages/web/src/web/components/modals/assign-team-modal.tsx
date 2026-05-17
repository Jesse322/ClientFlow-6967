import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateClient } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { X, Search } from "lucide-react";
import type { AirtableRecord, Client, TeamMember } from "@/lib/types";

interface Props {
  client: AirtableRecord<Client>;
  teamMembers: AirtableRecord<TeamMember>[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function AssignTeamModal({ client, teamMembers, open, onClose, onSaved }: Props) {
  const [producer, setProducer] = useState<string>("");
  const [serviceLead, setServiceLead] = useState<string>("");
  const [analyst, setAnalyst] = useState<string>("");
  const [assigned, setAssigned] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      const f = client.fields;
      setProducer(f["Producer"]?.[0] || "");
      setServiceLead(f["Service Lead"]?.[0] || "");
      setAnalyst(f["Analyst"]?.[0] || "");
      setAssigned(f["Assigned Team Members"] || []);
      setSearch("");
    }
  }, [open, client]);

  const activeMembers = teamMembers
    .filter((m) => m.fields["Active Status"] !== false && m.fields["Full Name"])
    .sort((a, b) => (a.fields["Full Name"] || "").localeCompare(b.fields["Full Name"] || ""));

  const filtered = activeMembers.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.fields["Full Name"]?.toLowerCase().includes(q) ||
      m.fields["Role"]?.toLowerCase().includes(q)
    );
  });

  const toggleAssigned = (id: string) => {
    setAssigned((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const getName = (id: string) =>
    teamMembers.find((m) => m.id === id)?.fields["Full Name"] || id;

  const handleSave = async () => {
    setSaving(true);
    try {
      const fields: any = {};
      if (producer) fields["Producer"] = [producer];
      else fields["Producer"] = [];
      if (serviceLead) fields["Service Lead"] = [serviceLead];
      else fields["Service Lead"] = [];
      if (analyst) fields["Analyst"] = [analyst];
      else fields["Analyst"] = [];
      if (assigned.length) fields["Assigned Team Members"] = assigned;
      else fields["Assigned Team Members"] = [];

      await updateClient(client.id, fields);
      toast.success("Team assignment updated");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const MemberSelect = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div>
      <Label className="text-xs text-slate-500">{label}</Label>
      <Select value={value || "_none"} onValueChange={(v) => onChange(v === "_none" ? "" : v)}>
        <SelectTrigger className="mt-1 h-9 text-sm">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_none"><span className="text-slate-400">Unassigned</span></SelectItem>
          {activeMembers.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <span>{m.fields["Full Name"]}</span>
              {m.fields["Role"] && <span className="text-slate-400 ml-1.5 text-xs">· {m.fields["Role"]}</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Assign Team — {client.fields["Client Name"]}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 py-1 min-h-0">
          {/* Role assignments */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Primary Roles</p>
            <MemberSelect label="Producer" value={producer} onChange={setProducer} />
            <MemberSelect label="Service Lead" value={serviceLead} onChange={setServiceLead} />
            <MemberSelect label="Analyst" value={analyst} onChange={setAnalyst} />
          </div>

          {/* Assigned team members (multi) */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Additional Team Members</p>
            {assigned.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {assigned.map((id) => (
                  <span key={id} className="flex items-center gap-1 bg-sky-50 border border-sky-200 text-sky-700 text-xs px-2 py-1 rounded-full">
                    {getName(id)}
                    <button onClick={() => toggleAssigned(id)} className="hover:text-sky-900">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search members…" className="pl-8 h-8 text-sm" />
            </div>
            <div className="space-y-0.5 max-h-48 overflow-y-auto border border-slate-100 rounded-lg p-1">
              {filtered.map((m) => {
                const isSelected = assigned.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleAssigned(m.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-sm transition-colors",
                      isSelected ? "bg-sky-50 text-sky-700" : "hover:bg-slate-50 text-slate-700"
                    )}
                  >
                    <div className={cn(
                      "w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0",
                      isSelected ? "bg-sky-500 text-white" : "bg-slate-200 text-slate-600"
                    )}>
                      {m.fields["Full Name"]?.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium truncate block">{m.fields["Full Name"]}</span>
                      {m.fields["Role"] && <span className="text-xs text-slate-400">{m.fields["Role"]}</span>}
                    </div>
                    {isSelected && <div className="w-4 h-4 rounded-full bg-sky-500 flex items-center justify-center shrink-0"><svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-700 text-white">
            {saving ? "Saving…" : "Save Assignment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
