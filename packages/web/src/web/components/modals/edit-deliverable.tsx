import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TeamPicker } from "@/components/ui/team-picker";
import { updateDeliverable, createDeliverable } from "@/lib/api";
import { checkAndToastPoints, snapshotPoints } from "@/hooks/usePointsToast";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";
import { NotesLog, appendNote } from "@/components/notes-log";
import { useSession } from "@/lib/session";
import type { AirtableRecord, Deliverable, Client, TeamMember } from "@/lib/types";

interface Props {
  item: AirtableRecord<Deliverable> | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  clients: AirtableRecord<Client>[];
  teamMembers?: AirtableRecord<TeamMember>[];
  defaultPhase?: string;
  defaultClientId?: string;
}

const STATUSES = ["Not Started", "In Progress", "Completed", "Overdue"];
const TYPES = ["IRS", "ERISA", "CMS", "USI", "Carrier", "Client"];
const PHASES = ["Pre-Renewal", "Marketing", "Implementation", "Post-Renewal", "Compliance"];

export function EditDeliverableModal({ item, open, onClose, onSaved, clients, teamMembers = [], defaultPhase, defaultClientId }: Props) {
  const { user } = useSession();
  const [fields, setFields] = useState<Partial<Deliverable>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) setFields({ ...item.fields });
    else setFields({
      Status: "Not Started",
      ...(defaultPhase ? { "Renewal Timeline Phase": defaultPhase as any } : {}),
      ...(defaultClientId ? { "Client": [defaultClientId] as any } : {}),
    });
  }, [item, open]);

  const set = (key: keyof Deliverable, value: any) => setFields((f) => ({ ...f, [key]: value }));

  const handleStatusChange = (status: string) => {
    set("Status", status as any);
    if (status === "Completed" && !fields["Completion Date"]) {
      set("Completion Date", new Date().toISOString().split("T")[0]);
    }
    if (status !== "Completed") set("Completion Date", "");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        "Deliverable Name": fields["Deliverable Name"],
        "Type": fields["Type"],
        "Status": fields["Status"],
        "Deadline": fields["Deadline"] || undefined,
        "Notes": fields["Notes"],
        "Renewal Timeline Phase": fields["Renewal Timeline Phase"],
        "Completion Date": fields["Completion Date"] || undefined,
        "Assigned Team Members": fields["Assigned Team Members"]?.length
          ? fields["Assigned Team Members"]
          : [],
      };
      if (fields["Client"]?.length) payload["Client"] = fields["Client"];
      Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

      if (item) {
        const wasCompleted = item.fields["Status"] === "Completed" || item.fields["Status"] === "Closed";
        const nowCompleted = payload["Status"] === "Completed" || payload["Status"] === "Closed";
        const snapshot = (nowCompleted && !wasCompleted) ? await snapshotPoints() : null;
        await updateDeliverable(item.id, payload);
        toast.success("Deliverable updated");
        if (snapshot) checkAndToastPoints(snapshot);
      } else {
        await createDeliverable(payload);
        toast.success("Deliverable created");
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const isCompleted = fields["Status"] === "Completed";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Deliverable" : "New Deliverable"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Name *</Label>
            <Input value={fields["Deliverable Name"] || ""} onChange={(e) => set("Deliverable Name", e.target.value)} placeholder="Deliverable name" className="mt-1" />
          </div>

          {/* Status buttons */}
          <div>
            <Label>Status</Label>
            <div className="grid grid-cols-4 gap-1.5 mt-1">
              {STATUSES.map((s) => (
                <button key={s} type="button" onClick={() => handleStatusChange(s)}
                  className={cn(
                    "px-2 py-2 rounded-lg text-xs font-medium border transition-all text-center",
                    fields["Status"] === s
                      ? s === "Completed" ? "bg-emerald-500 text-white border-emerald-500"
                        : s === "Overdue" ? "bg-red-500 text-white border-red-500"
                        : s === "In Progress" ? "bg-sky-500 text-white border-sky-500"
                        : "bg-slate-700 text-white border-slate-700"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  )}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Completion banner */}
          {isCompleted && (
            <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-emerald-800">Marked as Completed</p>
                <div className="flex items-center gap-2 mt-1">
                  <Label className="text-xs text-emerald-600 shrink-0">Date completed:</Label>
                  <Input type="date" value={fields["Completion Date"] || ""} onChange={(e) => set("Completion Date", e.target.value)}
                    className="h-7 text-xs border-emerald-200 bg-white" />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={fields["Type"] || ""} onValueChange={(v) => set("Type", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Phase</Label>
              <Select value={fields["Renewal Timeline Phase"] || ""} onValueChange={(v) => set("Renewal Timeline Phase", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Phase" /></SelectTrigger>
                <SelectContent>{PHASES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Due Date</Label>
              <Input type="date" value={fields["Deadline"] || ""} onChange={(e) => set("Deadline", e.target.value)} className="mt-1" />
            </div>
            {!isCompleted && (
              <div>
                <Label className="text-slate-400">Completion Date</Label>
                <Input type="date" value={fields["Completion Date"] || ""} onChange={(e) => set("Completion Date", e.target.value)} className="mt-1" />
              </div>
            )}
          </div>

          <div>
            <Label>Client</Label>
            <Select value={fields["Client"]?.[0] || ""} onValueChange={(v) => set("Client", v ? [v] : [])}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.fields["Client Name"]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Team assignment */}
          {teamMembers.length > 0 && (
            <TeamPicker
              teamMembers={teamMembers}
              selected={fields["Assigned Team Members"] || []}
              onChange={(ids) => set("Assigned Team Members", ids)}
              label="Assign Team Members"
            />
          )}

          <div>
            <Label>Notes & Updates</Label>
            {item ? (
              <div className="mt-1">
                <NotesLog
                  notes={fields["Notes"]}
                  authorName={user?.name}
                  onAdd={async (updatedNotes) => {
                    set("Notes", updatedNotes);
                  }}
                  onUpdate={async (updatedNotes) => {
                    set("Notes", updatedNotes);
                  }}
                  maxHeight="max-h-36"
                />
              </div>
            ) : (
              <textarea
                value={fields["Notes"] || ""}
                onChange={(e) => set("Notes", e.target.value)}
                placeholder="Initial notes…"
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-400 resize-none"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !fields["Deliverable Name"]}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
