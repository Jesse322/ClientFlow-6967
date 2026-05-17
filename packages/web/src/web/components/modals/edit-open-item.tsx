import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TeamPicker } from "@/components/ui/team-picker";
import { NotesLog, appendNote } from "@/components/notes-log";
import { useSession } from "@/lib/session";
import { updateOpenItem, createOpenItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import { checkAndToastPoints, snapshotPoints } from "@/hooks/usePointsToast";
import { toast } from "sonner";
import type { AirtableRecord, OpenItem, Client, TeamMember } from "@/lib/types";
import { PRIORITIES, PRIORITY_COLORS, derivePriority } from "@/lib/priority";

const RECURRENCE_RATES = ["Daily", "Weekly", "Bi-Weekly", "Monthly", "Quarterly", "Semi-Annual", "Annual"];

interface Props {
  item: AirtableRecord<OpenItem> | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  clients: AirtableRecord<Client>[];
  teamMembers?: AirtableRecord<TeamMember>[];
  defaultClientId?: string;
  currentUserId?: string | null;
}

const STATUSES = ["Not Started", "In Progress", "Stuck", "Closed"];
const TYPES = ["Analytics", "Compliance", "HR Support", "Population Health", "Miscellaneous", "Other", "Member Support", "Planning Support", "Ancillary", "Technology"];

export function EditOpenItemModal({ item, open, onClose, onSaved, clients, teamMembers = [], defaultClientId, currentUserId }: Props) {
  const { user } = useSession();
  const [fields, setFields] = useState<Partial<OpenItem>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) setFields({ ...item.fields });
    else setFields({ Status: "Not Started", ...(defaultClientId ? { "Client": [defaultClientId] } : {}) });
  }, [item, open, defaultClientId]);

  const set = (key: keyof OpenItem, value: any) => setFields((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        "Open Item Name": fields["Open Item Name"],
        "Notes": fields["Notes"],
        "Status": fields["Status"],
        "Begin Date": fields["Begin Date"] || undefined,
        "Due Date": fields["Due Date"] || undefined,
        "Completion Date": fields["Completion Date"] || undefined,
        "Open Item Type": fields["Open Item Type"],
        "Priority": fields["Priority"] || undefined,
        "Assigned To": fields["Assigned To"]?.length ? fields["Assigned To"] : (currentUserId ? [currentUserId] : []),
        "Recurring": fields["Recurring"] ?? false,
        "Recurrence Rate": fields["Recurring"] ? (fields["Recurrence Rate"] || undefined) : undefined,
      };
      if (fields["Client"]?.length) payload["Client"] = fields["Client"];
      Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

      if (item) {
        const wasCompleted = item.fields["Status"] === "Completed" || item.fields["Status"] === "Closed";
        const nowCompleted = payload["Status"] === "Completed" || payload["Status"] === "Closed";
        const snapshot = (nowCompleted && !wasCompleted) ? await snapshotPoints() : null;
        await updateOpenItem(item.id, payload);
        toast.success("Open item updated");
        if (snapshot) checkAndToastPoints(snapshot);
      } else {
        await createOpenItem(payload);
        toast.success("Open item created");
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Open Item" : "New Open Item"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Name *</Label>
            <Input value={fields["Open Item Name"] || ""} onChange={(e) => set("Open Item Name", e.target.value)} placeholder="Open item name" className="mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={fields["Status"] || ""} onValueChange={(v) => set("Status", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={fields["Open Item Type"] || ""} onValueChange={(v) => set("Open Item Type", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {/* Recurring toggle + rate */}
          <div className="flex items-start gap-4">
            <div className="flex items-center gap-2 pt-0.5">
              <Switch
                checked={fields["Recurring"] ?? false}
                onCheckedChange={(v) => {
                  set("Recurring", v);
                  if (!v) set("Recurrence Rate", undefined as any);
                }}
              />
              <Label className="cursor-pointer select-none">Recurring</Label>
            </div>
            {fields["Recurring"] && (
              <div className="flex-1">
                <Select value={fields["Recurrence Rate"] || ""} onValueChange={(v) => set("Recurrence Rate", v)}>
                  <SelectTrigger><SelectValue placeholder="Rate…" /></SelectTrigger>
                  <SelectContent>
                    {RECURRENCE_RATES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div>
            <Label>Priority</Label>
            <div className="mt-1 flex gap-2 flex-wrap">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set("Priority", fields["Priority"] === p ? undefined : p)}
                  className={cn(
                    "px-3 py-1 rounded-full border text-xs font-semibold transition-all",
                    fields["Priority"] === p
                      ? PRIORITY_COLORS[p]
                      : "bg-white text-slate-400 border-slate-200 hover:border-slate-300"
                  )}
                >
                  {p}
                </button>
              ))}
              {!fields["Priority"] && fields["Due Date"] && (
                <span className="text-xs text-slate-400 self-center">
                  → defaults to <strong>{derivePriority(fields["Due Date"])}</strong> based on due date
                </span>
              )}
              {!fields["Priority"] && !fields["Due Date"] && (
                <span className="text-xs text-slate-400 self-center">defaults to Low if no due date</span>
              )}
            </div>
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Begin Date</Label>
              <Input type="date" value={fields["Begin Date"] || ""} onChange={(e) => set("Begin Date", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Due Date</Label>
              <Input type="date" value={fields["Due Date"] || ""} onChange={(e) => set("Due Date", e.target.value)} className="mt-1" />
            </div>
          </div>

          {item && fields["Created At"] && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              <span className="font-medium text-slate-500">Created:</span>
              {new Date(fields["Created At"] as string).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
          )}

          {fields["Status"] === "Closed" && (
            <div>
              <Label>Completion Date</Label>
              <Input type="date" value={fields["Completion Date"] || ""} onChange={(e) => set("Completion Date", e.target.value)} className="mt-1" />
            </div>
          )}

          {/* Team assignment */}
          {teamMembers.length > 0 && (
            <TeamPicker
              teamMembers={teamMembers}
              selected={(fields["Assigned To"] as string[]) || []}
              onChange={(ids) => set("Assigned To", ids)}
              label="Assigned To"
            />
          )}

          {/* Notes log — live updates with timestamps */}
          <div>
            <Label>Notes & Updates</Label>
            <div className="mt-1 border border-slate-200 rounded-lg p-3">
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
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !fields["Open Item Name"]}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
