import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { createTeamMember, updateTeamMember } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import type { AirtableRecord, TeamMember } from "@/lib/types";

const ROLES = ["Practice Leader", "Account Manager", "Account Executive", "Account Representative", "Compliance Specialist", "Analyst", "Ancillary Analyst", "Onboarding Specialist", "Team Lead", "Producer", "PHM Support", "HR Tech Support", "Regional Operations Director"];

// Generate avatar URL from seed
function avatarUrl(seed: string, size = 96) {
  return `https://api.dicebear.com/9.x/toon-head/svg?seed=${encodeURIComponent(seed)}&size=${size}&backgroundColor=eef2ff,e0f2fe,ecfdf5,fef3c7,fce7f3,f3e8ff`;
}

// Pre-defined fun seeds for the picker grid
const AVATAR_SEEDS = [
  "Felix", "Aneka", "Whiskers", "Milo", "Zara", "Jasper", "Luna", "Orion",
  "Pepper", "Sage", "Cleo", "Atlas", "Nova", "Ember", "Finn", "Ivy",
  "Storm", "Wren", "Dash", "Remy", "Quinn", "Juno", "Blaze", "Maple",
];

interface Props {
  item: AirtableRecord<TeamMember> | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function EditTeamMemberModal({ item, open, onClose, onSaved }: Props) {
  const [fields, setFields] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);

  useEffect(() => {
    if (item) {
      const f = item.fields as any;
      const emailRaw = f["_email"] || f["Email Address"];
      const email = typeof emailRaw === "object" ? emailRaw?.value ?? "" : emailRaw ?? "";
      setFields({
        "Full Name": f["Full Name"] || "",
        "Role": f["Role"] || "",
        "Phone Number": f["Phone Number"] || "",
        "Email": email,
        "Active Status": f["Active Status"] ?? true,
        "Avatar Seed": f["Avatar Seed"] || "",
      });
    } else {
      setFields({ "Full Name": "", "Role": "", "Phone Number": "", "Email": "", "Active Status": true, "Avatar Seed": "" });
    }
    setShowAvatarPicker(false);
    setSeedOffset(0);
  }, [item, open]);

  const set = (key: string, value: any) => setFields((f) => ({ ...f, [key]: value }));

  // Current set of seeds to display (shift by offset for "shuffle")
  const visibleSeeds = useMemo(() => {
    const extra = Array.from({ length: seedOffset }, (_, i) => `random_${seedOffset}_${i}`);
    return [...AVATAR_SEEDS, ...extra].slice(seedOffset, seedOffset + 12);
  }, [seedOffset]);

  const currentSeed = fields["Avatar Seed"] || fields["Full Name"] || "default";

  const handleSave = async () => {
    if (!fields["Full Name"]?.trim()) return;
    setSaving(true);
    try {
      const payload: any = {
        "Full Name": fields["Full Name"].trim(),
        "Active Status": fields["Active Status"] ?? true,
      };
      if (fields["Role"]) payload["Role"] = fields["Role"];
      if (fields["Phone Number"]) payload["Phone Number"] = fields["Phone Number"];
      payload["Email"] = (fields["Email"] || "").trim();
      payload["Avatar Seed"] = fields["Avatar Seed"] || "";

      if (item) {
        await updateTeamMember(item.id, payload);
        toast.success("Team member updated");
      } else {
        await createTeamMember(payload);
        toast.success("Team member added");
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
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Team Member" : "Add Team Member"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {/* Avatar section */}
          <div>
            <Label>Avatar</Label>
            <div className="mt-2 flex items-center gap-3">
              <img
                src={avatarUrl(currentSeed, 96)}
                alt="Avatar"
                className="w-14 h-14 rounded-full border-2 border-slate-200 bg-slate-50"
              />
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setShowAvatarPicker((v) => !v)}
                  className="text-sm text-sky-600 hover:text-sky-700 font-medium transition-colors text-left"
                >
                  {showAvatarPicker ? "Close picker" : "Choose avatar"}
                </button>
                {fields["Avatar Seed"] && (
                  <button
                    type="button"
                    onClick={() => set("Avatar Seed", "")}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors text-left"
                  >
                    Reset to default
                  </button>
                )}
              </div>
            </div>

            {showAvatarPicker && (
              <div className="mt-3 p-3 border border-slate-200 rounded-xl bg-slate-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-500">Pick an avatar</span>
                  <button
                    type="button"
                    onClick={() => setSeedOffset((s) => s + 12)}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-sky-600 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" /> More options
                  </button>
                </div>
                <div className="grid grid-cols-6 gap-2">
                  {visibleSeeds.map((seed) => (
                    <button
                      key={seed}
                      type="button"
                      onClick={() => { set("Avatar Seed", seed); setShowAvatarPicker(false); }}
                      className={cn(
                        "w-full aspect-square rounded-lg border-2 transition-all overflow-hidden bg-white hover:scale-105",
                        currentSeed === seed
                          ? "border-sky-500 ring-2 ring-sky-200"
                          : "border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <img
                        src={avatarUrl(seed, 64)}
                        alt={seed}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>Full Name *</Label>
            <Input value={fields["Full Name"] || ""} onChange={(e) => set("Full Name", e.target.value)} placeholder="First Last" className="mt-1" />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={fields["Role"] || ""} onValueChange={(v) => set("Role", v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select role…" /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Phone Number</Label>
            <Input value={fields["Phone Number"] || ""} onChange={(e) => set("Phone Number", e.target.value)} placeholder="(555) 000-0000" className="mt-1" />
          </div>
          <div>
            <Label>Email Address</Label>
            <Input type="email" value={fields["Email"] || ""} onChange={(e) => set("Email", e.target.value)} placeholder="name@company.com" className="mt-1" />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Switch checked={fields["Active Status"] ?? true} onCheckedChange={(v) => set("Active Status", v)} />
            <Label>Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !fields["Full Name"]?.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
