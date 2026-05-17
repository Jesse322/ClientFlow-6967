import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { updateClient, createClient, getTeamMembers } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useOffice } from "@/lib/office-context";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AirtableRecord, Client, TeamMember } from "@/lib/types";
import { OFFICES } from "@/lib/office-context";

interface Props {
  item: AirtableRecord<Client> | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const FUNDING = ["Fully Insured", "Level Funded", "Self Funded", "PEO"];
const SIZES = ["1-49", "50-99", "100-499", "500+"];
const SEGMENTS = ["Select", "Emerging Middle Market", "Middle Market", "Premier", "Public Sector"];
const SF_ARRANGEMENTS = ["Captive", "Bundled", "Unbundled"];
const NONE = "__none__";

export function EditClientModal({ item, open, onClose, onSaved }: Props) {
  const { user } = useSession();
  const { selectedOffice } = useOffice();
  const [, setLocation] = useLocation();
  const [fields, setFields] = useState<Partial<Client>>({});
  const [saving, setSaving] = useState(false);
  const [isNewToUSI, setIsNewToUSI] = useState(false);
  const [teamMembers, setTeamMembers] = useState<AirtableRecord<TeamMember>[]>([]);
  // Raw string state for carrier inputs — only parsed to array on blur
  const [medicalRaw, setMedicalRaw] = useState("");
  const [ancillaryRaw, setAncillaryRaw] = useState("");

  // Load team members once
  useEffect(() => {
    getTeamMembers().then(setTeamMembers).catch(() => {});
  }, []);

  // Init fields — default Service Lead to current user on new client
  useEffect(() => {
    if (!open) return;
    if (item) {
      setFields({ ...item.fields });
      setMedicalRaw((item.fields["Medical Carrier/TPA"] as string[] | undefined)?.join(", ") || "");
      setAncillaryRaw((item.fields["Ancillary Carrier"] as string[] | undefined)?.join(", ") || "");
      setIsNewToUSI(false);
    } else {
      const defaultServiceLead = user?.airtableId ? [user.airtableId] : [];
      setFields({ Active: true, "Service Lead": defaultServiceLead, "Office": selectedOffice });
      setMedicalRaw("");
      setAncillaryRaw("");
      setIsNewToUSI(false);
    }
  }, [item, open, user]);

  const set = (key: keyof Client, value: any) => setFields((f) => ({ ...f, [key]: value }));

  // Single-select helpers for linked record fields (stored as string[])
  const getSingle = (key: keyof Client) => {
    const val = fields[key] as string[] | undefined;
    return val?.[0] || NONE;
  };
  const setSingle = (key: keyof Client, val: string) =>
    set(key, val === NONE ? [] : [val]);

  const funding = fields["Funding Strategy"] || "";
  const isPEO = funding === "PEO";
  const isSelfFunded = funding === "Self Funded";

  const handleFundingChange = (v: string) => {
    set("Funding Strategy", v);
    // Clear irrelevant sub-fields when switching
    if (v !== "PEO") set("PEO Name", "");
    if (v !== "Self Funded") {
      set("SF Arrangement", "");
      set("PBM", "");
      set("Stop Loss", "");
      set("TPA Name", "");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        "Client Name": fields["Client Name"],
        "Renewal Date": fields["Renewal Date"] || undefined,
        "Active": fields["Active"] ?? true,
        "Revenue": fields["Revenue"] ? Number(fields["Revenue"]) : undefined,
        "Funding Strategy": fields["Funding Strategy"],
        "Company Size": fields["Company Size"],
        "Segment": fields["Segment"] || "",
        "Location": fields["Location"],
        "Intake Notes": fields["Intake Notes"],
        "Medical Carrier/TPA": fields["Medical Carrier/TPA"]?.length ? fields["Medical Carrier/TPA"] : undefined,
        "Ancillary Carrier": fields["Ancillary Carrier"]?.length ? fields["Ancillary Carrier"] : undefined,
        "Service Lead": fields["Service Lead"]?.length ? fields["Service Lead"] : undefined,
        "Producer": fields["Producer"]?.length ? fields["Producer"] : undefined,
        "Analyst": fields["Analyst"]?.length ? fields["Analyst"] : undefined,
        // Office
        "Office": fields["Office"] || selectedOffice,
        // PEO
        "PEO Name": isPEO ? (fields["PEO Name"] || "") : "",
        // Self Funded sub-fields
        "SF Arrangement": isSelfFunded ? (fields["SF Arrangement"] || "") : "",
        "PBM": isSelfFunded ? (fields["PBM"] || "") : "",
        "Stop Loss": isSelfFunded ? (fields["Stop Loss"] || "") : "",
        "TPA Name": isSelfFunded ? (fields["TPA Name"] || "") : "",
      };
      Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

      if (item) {
        await updateClient(item.id, payload);
        toast.success("Client updated");
        onSaved();
        onClose();
      } else {
        if (isNewToUSI) payload["Is Onboarding"] = true;
        const result: any = await createClient(payload);
        toast.success("Client created");
        onSaved();
        onClose();
        if (isNewToUSI && result?.id) {
          setLocation(`/clients/${result.id}/onboard`);
        }
      }
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const memberOptions = teamMembers
    .filter((m) => m.fields["Active Status"] !== false)
    .sort((a, b) => a.fields["Full Name"].localeCompare(b.fields["Full Name"]));

  const TeamSelect = ({ label, fieldKey, required }: { label: string; fieldKey: keyof Client; required?: boolean }) => (
    <div>
      <Label>{label}{required && " *"}</Label>
      <Select value={getSingle(fieldKey)} onValueChange={(v) => setSingle(fieldKey, v)}>
        <SelectTrigger className="mt-1">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— Unassigned —</SelectItem>
          {memberOptions.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.fields["Full Name"]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Client" : "New Client"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Client Name *</Label>
            <Input value={fields["Client Name"] || ""} onChange={(e) => set("Client Name", e.target.value)} placeholder="Client name" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Renewal Date</Label>
              <Input type="date" value={fields["Renewal Date"] || ""} onChange={(e) => set("Renewal Date", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Revenue</Label>
              <Input type="number" value={fields["Revenue"] || ""} onChange={(e) => set("Revenue", e.target.value ? Number(e.target.value) : undefined)} placeholder="Annual revenue" className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Funding Strategy</Label>
              <Select value={funding} onValueChange={handleFundingChange}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{FUNDING.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Company Size</Label>
              <Select value={fields["Company Size"] || ""} onValueChange={(v) => set("Company Size", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{SIZES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Segment</Label>
              <Select value={fields["Segment"] || ""} onValueChange={(v) => set("Segment", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{SEGMENTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {/* ── PEO sub-fields ── */}
          {isPEO && (
            <div className="border border-sky-100 bg-sky-50/50 rounded-xl p-3 space-y-3">
              <p className="text-xs font-semibold text-sky-600 uppercase tracking-wide">PEO Details</p>
              <div>
                <Label>PEO Name</Label>
                <Input
                  value={fields["PEO Name"] || ""}
                  onChange={(e) => set("PEO Name", e.target.value)}
                  placeholder="e.g. ADP TotalSource, Insperity"
                  className="mt-1"
                />
              </div>
            </div>
          )}

          {/* ── Self Funded sub-fields ── */}
          {isSelfFunded && (
            <div className="border border-violet-100 bg-violet-50/50 rounded-xl p-3 space-y-3">
              <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide">Self Funded Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Arrangement</Label>
                  <Select value={fields["SF Arrangement"] || ""} onValueChange={(v) => set("SF Arrangement", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {SF_ARRANGEMENTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>TPA Name</Label>
                  <Input
                    value={fields["TPA Name"] || ""}
                    onChange={(e) => set("TPA Name", e.target.value)}
                    placeholder="e.g. Meritain, Allegiance"
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>PBM</Label>
                  <Input
                    value={fields["PBM"] || ""}
                    onChange={(e) => set("PBM", e.target.value)}
                    placeholder="e.g. CVS Caremark, Express Scripts"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Stop Loss</Label>
                  <Input
                    value={fields["Stop Loss"] || ""}
                    onChange={(e) => set("Stop Loss", e.target.value)}
                    placeholder="e.g. Sun Life, Voya"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Team roles */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Team Assignment</p>
            <div className="grid grid-cols-2 gap-3">
              <TeamSelect label="Service Lead" fieldKey="Service Lead" />
              <TeamSelect label="Producer" fieldKey="Producer" />
              <TeamSelect label="Analyst" fieldKey="Analyst" />
            </div>
          </div>

          <div>
            <Label>Office</Label>
            <Select value={fields["Office"] || selectedOffice} onValueChange={(v) => set("Office", v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select office…" /></SelectTrigger>
              <SelectContent>
                {OFFICES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Location</Label>
            <Input value={fields["Location"] || ""} onChange={(e) => set("Location", e.target.value)} placeholder="City, State" className="mt-1" />
          </div>
          <div>
            <Label>Medical Carrier / TPA</Label>
            <Input
              value={medicalRaw}
              onChange={(e) => setMedicalRaw(e.target.value)}
              onBlur={(e) => set("Medical Carrier/TPA", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              placeholder="e.g. Blue Cross, Aetna"
              className="mt-1"
            />
            <p className="text-xs text-slate-400 mt-1">Separate multiple carriers with commas</p>
          </div>
          <div>
            <Label>Ancillary Carrier</Label>
            <Input
              value={ancillaryRaw}
              onChange={(e) => setAncillaryRaw(e.target.value)}
              onBlur={(e) => set("Ancillary Carrier", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              placeholder="e.g. Guardian, MetLife"
              className="mt-1"
            />
            <p className="text-xs text-slate-400 mt-1">Separate multiple carriers with commas</p>
          </div>
          <div>
            <Label>Intake Notes</Label>
            <Textarea value={fields["Intake Notes"] || ""} onChange={(e) => set("Intake Notes", e.target.value)} placeholder="Notes…" className="mt-1" rows={3} />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={fields["Active"] ?? true} onCheckedChange={(v) => set("Active", v)} />
            <Label>Active Client</Label>
          </div>
          {!item && (
            <div className={cn(
              "flex items-start gap-3 rounded-xl border p-3 transition-colors",
              isNewToUSI ? "bg-amber-50 border-amber-200" : "border-slate-100"
            )}>
              <Switch checked={isNewToUSI} onCheckedChange={setIsNewToUSI} className="mt-0.5" />
              <div>
                <Label className="cursor-pointer" onClick={() => setIsNewToUSI(v => !v)}>
                  New to USI
                </Label>
                <p className="text-xs text-slate-500 mt-0.5">
                  Opens the onboarding setup wizard and creates standard onboarding deliverables automatically.
                </p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !fields["Client Name"]}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
