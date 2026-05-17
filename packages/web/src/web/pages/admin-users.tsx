import { useState, useEffect, useMemo } from "react";
import { useTeamMembers } from "@/hooks/useData";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, KeyRound, ShieldCheck, User, Copy, Check, Mail, Database, Globe, X, ChevronDown } from "lucide-react";

interface AppUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  airtable_id: string | null;
  created_at: number;
  email_verified: boolean;
}

function useUsers() {
  const [data, setData] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      setData(await res.json());
    } catch { toast.error("Failed to load users"); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);
  return { data, loading, reload };
}

// ─── Edit / Create user modal ─────────────────────────────────────────────────
function EditUserModal({
  user, open, onClose, onSaved, teamMembers,
}: {
  user: AppUser | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  teamMembers: any[];
}) {
  const isNew = !user;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [airtableId, setAirtableId] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (user) {
      setName(user.name);
      setEmail(user.email);
      setRole(user.role);
      setAirtableId(user.airtable_id || "");
      setTempPassword("");
    } else {
      setName(""); setEmail(""); setRole("member"); setAirtableId(""); setTempPassword("");
    }
  }, [open, user]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isNew) {
        if (!email || !tempPassword) { toast.error("Email and password required"); setSaving(false); return; }
        const res = await fetch("/api/admin/create-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name, airtableId: airtableId || null, tempPassword }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        // Set role to admin if needed (create-user always creates member)
        if (role === "admin" && data.userId) {
          await fetch(`/api/admin/users/${data.userId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "admin" }),
          });
        }
        toast.success("User created");
      } else {
        const res = await fetch(`/api/admin/users/${user!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, role, airtableId: airtableId || null }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        toast.success("User updated");
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const activeMembers = teamMembers
    .filter((m) => m.fields["Active Status"] !== false)
    .sort((a: any, b: any) => (a.fields["Full Name"] || "").localeCompare(b.fields["Full Name"] || ""));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "Create User" : "Edit User"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Full Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="mt-1" />
          </div>
          {isNew && (
            <div>
              <Label>Email *</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@usi.com" className="mt-1" />
            </div>
          )}
          {!isNew && (
            <div>
              <Label>Email</Label>
              <Input value={email} disabled className="mt-1 bg-slate-50 text-slate-400" />
            </div>
          )}
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as any)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-400 mt-1">Admins see all clients and manage users. Members only see assigned clients.</p>
          </div>
          <div>
            <Label>Linked Team Member</Label>
            <Select value={airtableId || "_none"} onValueChange={(v) => setAirtableId(v === "_none" ? "" : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Not linked" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Not linked —</SelectItem>
                {activeMembers.map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>{m.fields["Full Name"]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-400 mt-1">Links this login to a team member record for client visibility.</p>
          </div>
          {isNew && (
            <div>
              <Label>Temporary Password *</Label>
              <Input type="text" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} placeholder="Min 8 characters" className="mt-1" />
              <p className="text-xs text-slate-400 mt-1">User should change this after first login.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || (isNew && (!email || !tempPassword))}>
            {saving ? "Saving…" : isNew ? "Create User" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reset password result modal ──────────────────────────────────────────────
function ResetLinkModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="w-4 h-4 text-sky-500" /> Reset Link Sent</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-slate-600">A password reset email has been sent. You can also copy the link below to share directly.</p>
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
            <p className="text-xs text-slate-500 break-all flex-1 font-mono">{url}</p>
            <button onClick={copy} className="shrink-0 p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors">
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-slate-400">Link expires in 1 hour.</p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
// ─── OpCo Sites Config ────────────────────────────────────────────────────────

interface OpCoSite { name: string; url: string; apiKey: string; }

function useOpCoSites() {
  const [sites, setSites] = useState<OpCoSite[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = async () => {
    setLoading(true);
    try { const r = await fetch("/api/opco-sites"); setSites(await r.json()); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);
  const save = async (updated: OpCoSite[]) => {
    await fetch("/api/opco-sites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
    setSites(updated);
  };
  return { sites, loading, save, reload };
}

// ─── Per-user OpCo access popover ─────────────────────────────────────────────

function OpCoAccessButton({ user, opcoSites, onResetLink }: {
  user: AppUser;
  opcoSites: OpCoSite[];
  onResetLink: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [granting, setGranting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, "created" | "exists" | "error">>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const grant = async (site: OpCoSite) => {
    setGranting(site.url);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/grant-opco-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrls: [site.url] }),
      });
      const data = await res.json();
      if (data.error) { toast.error(data.error); return; }
      const r = data.results?.[0];
      if (r?.status === "created") {
        setResults(prev => ({ ...prev, [site.url]: "created" }));
        toast.success(`Access granted on ${site.name}`);
      } else if (r?.status === "exists") {
        setResults(prev => ({ ...prev, [site.url]: "exists" }));
        toast.info(`${user.name} already has access on ${site.name}`);
      } else {
        setResults(prev => ({ ...prev, [site.url]: "error" }));
        setErrors(prev => ({ ...prev, [site.url]: r?.error || "Unknown error" }));
        toast.error(`Failed: ${r?.error || "Unknown error"}`);
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setGranting(null); }
  };

  const sendReset = async (site: OpCoSite) => {
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (data.error) { toast.error(data.error); return; }
      onResetLink(data.resetUrl);
    } catch (e: any) { toast.error(e.message); }
  };

  if (!opcoSites.length) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        title="Manage OpCo access"
        className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-sky-600 transition-colors"
      >
        <Globe className="w-3.5 h-3.5" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">OpCo Site Access</p>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
            </div>
            <p className="text-xs text-slate-400 mb-3">Grant <span className="font-medium text-slate-600">{user.name}</span> access to other OpCo sites using the same email.</p>
            <div className="space-y-2">
              {opcoSites.map(site => {
                const status = results[site.url];
                const isGranting = granting === site.url;
                return (
                  <div key={site.url} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 truncate">{site.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">{site.url.replace(/^https?:\/\//, "")}</p>
                    </div>
                    {status === "exists" || status === "created" ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                          <Check className="w-2.5 h-2.5" /> {status === "created" ? "Granted" : "Has access"}
                        </span>
                        {status === "created" && (
                          <button
                            onClick={() => sendReset(site)}
                            className="text-[10px] text-sky-600 hover:underline"
                          >
                            Send reset
                          </button>
                        )}
                      </div>
                    ) : status === "error" ? (
                      <span className="text-[10px] text-red-500" title={errors[site.url]}>Error</span>
                    ) : (
                      <button
                        onClick={() => grant(site)}
                        disabled={isGranting}
                        className="text-xs px-2.5 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-1 shrink-0"
                      >
                        {isGranting ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> : <Plus className="w-3 h-3" />}
                        Grant
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Connected OpCo Sites section ─────────────────────────────────────────────

function ConnectedSitesSection({ sites, loading, save }: { sites: OpCoSite[]; loading: boolean; save: (s: OpCoSite[]) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);

  const addSite = async () => {
    if (!newName.trim() || !newUrl.trim() || !newKey.trim()) { toast.error("All fields required"); return; }
    setSaving(true);
    try {
      const url = newUrl.trim().replace(/\/$/, "");
      await save([...sites, { name: newName.trim(), url, apiKey: newKey.trim() }]);
      setNewName(""); setNewUrl(""); setNewKey(""); setAdding(false);
      toast.success("Site added");
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const removeSite = async (url: string) => {
    await save(sites.filter(s => s.url !== url));
    toast.success("Site removed");
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mt-4">
      <button
        className="flex items-center justify-between w-full"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-sky-500" />
          <h2 className="text-sm font-semibold text-slate-800">Connected OpCo Sites</h2>
          {sites.length > 0 && (
            <span className="text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full font-medium">{sites.length}</span>
          )}
        </div>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="mt-3">
          <p className="text-xs text-slate-500 mb-3">
            Register sibling OpCo sites here. Once added, you can grant users access to those sites from the Globe icon in the user list.
            Each site must have its <code className="bg-slate-100 px-1 rounded">Regional API Key</code> set.
          </p>

          {loading ? (
            <div className="h-8 bg-slate-100 rounded animate-pulse" />
          ) : (
            <>
              {sites.length === 0 && !adding && (
                <p className="text-xs text-slate-400 italic mb-3">No sites configured yet.</p>
              )}
              {sites.map(site => (
                <div key={site.url} className="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700">{site.name}</p>
                    <p className="text-xs text-slate-400 truncate">{site.url}</p>
                  </div>
                  <button onClick={() => removeSite(site.url)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {adding ? (
                <div className="mt-3 space-y-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Site Name</Label>
                      <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="LA" className="mt-1 h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">Site URL</Label>
                      <Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://la.runable.site" className="mt-1 h-8 text-xs" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Regional API Key (from that site)</Label>
                    <Input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Paste the key from that site's User Management" className="mt-1 h-8 text-xs font-mono" />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => setAdding(false)} className="text-xs h-7">Cancel</Button>
                    <Button size="sm" onClick={addSite} disabled={saving} className="text-xs h-7 bg-sky-600 hover:bg-sky-700 text-white">
                      {saving ? "Saving…" : "Add Site"}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="mt-2 text-xs h-7">
                  <Plus className="w-3 h-3 mr-1" /> Add Site
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RegionalKeySection() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/regional-key").then(r => r.json()).then(d => {
      if (d.key) { setKey(d.key); setSaved(d.key); }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!key.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/regional-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const d = await res.json();
      if (d.error) { toast.error(d.error); return; }
      setSaved(key.trim());
      toast.success("Regional API key saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mt-6">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-4 h-4 text-sky-500" />
        <h2 className="text-sm font-semibold text-slate-800">Regional API Key</h2>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Set the shared key used by the Regional Dashboard to pull data from this site.
        Must match the <code className="bg-slate-100 px-1 rounded">REGIONAL_API_KEY</code> on the Regional Dashboard.
      </p>
      {loading ? (
        <div className="h-8 bg-slate-100 rounded animate-pulse w-full" />
      ) : (
        <div className="flex gap-2">
          <Input
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="Paste your Regional API key here"
            className="font-mono text-xs"
          />
          <Button onClick={save} disabled={saving || key.trim() === saved} size="sm" className="bg-sky-600 hover:bg-sky-700 text-white shrink-0">
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
      {saved && <p className="text-xs text-emerald-600 mt-1.5">✓ Key is set</p>}
    </div>
  );
}

export default function AdminUsersPage() {
  const { data: users, loading, reload } = useUsers();
  const { data: teamMembers } = useTeamMembers();
  const { sites: opcoSites, loading: opcoLoading, save: saveOpcoSites } = useOpCoSites();

  const [editUser, setEditUser] = useState<AppUser | null | undefined>(undefined);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);

  const teamMemberMap = useMemo(() => {
    const map: Record<string, string> = {};
    (teamMembers || []).forEach((m) => { map[m.id] = m.fields["Full Name"] || ""; });
    return map;
  }, [teamMembers]);

  const doDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${confirmDeleteId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success("User deleted");
      reload();
    } catch (e: any) { toast.error(e.message); }
    finally { setDeleting(false); setConfirmDeleteId(null); }
  };

  const sendReset = async (user: AppUser) => {
    setResettingId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResetLink(data.resetUrl);
    } catch (e: any) { toast.error(e.message); }
    finally { setResettingId(null); }
  };

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle={`${users.length} user${users.length !== 1 ? "s" : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                const res = await fetch("/api/admin/run-migrations", { method: "POST" });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                toast.success("Migrations ran successfully");
              } catch (e: any) { toast.error("Migration failed: " + e.message); }
            }}>
              <Database className="w-4 h-4 mr-1" /> Run Migrations
            </Button>
            <Button size="sm" onClick={() => setEditUser(null)} className="bg-sky-600 hover:bg-sky-700 text-white">
              <Plus className="w-4 h-4 mr-1" /> Add User
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_2fr_1fr_1.5fr_auto] gap-4 px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>User</span>
            <span>Email</span>
            <span>Role</span>
            <span>Linked Member</span>
            <span />
          </div>

          {users.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm">No users found</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {users.map((u) => (
                <div key={u.id} className="grid grid-cols-[2fr_2fr_1fr_1.5fr_auto] gap-4 px-5 py-4 items-center hover:bg-slate-50 transition-colors">
                  {/* Name + created */}
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{u.name || "—"}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Joined {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>

                  {/* Email */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm text-slate-600 truncate">{u.email}</span>
                    {u.email_verified && <Check className="w-3 h-3 text-emerald-500 shrink-0" title="Email verified" />}
                  </div>

                  {/* Role badge */}
                  <div>
                    <span className={cn(
                      "inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border",
                      u.role === "admin"
                        ? "bg-violet-50 text-violet-700 border-violet-200"
                        : "bg-slate-100 text-slate-600 border-slate-200"
                    )}>
                      {u.role === "admin" ? <ShieldCheck className="w-3 h-3" /> : <User className="w-3 h-3" />}
                      {u.role === "admin" ? "Admin" : "Member"}
                    </span>
                  </div>

                  {/* Linked team member */}
                  <div>
                    {u.airtable_id ? (
                      <span className="text-sm text-slate-700">{teamMemberMap[u.airtable_id] || <span className="text-slate-400 italic">Unknown</span>}</span>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Not linked</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <OpCoAccessButton user={u} opcoSites={opcoSites} onResetLink={setResetLink} />
                    <button
                      onClick={() => sendReset(u)}
                      disabled={resettingId === u.id}
                      title="Send password reset"
                      className="p-1.5 rounded hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-colors"
                    >
                      {resettingId === u.id
                        ? <div className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                        : <KeyRound className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => setEditUser(u)}
                      title="Edit user"
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(u.id)}
                      title="Delete user"
                      className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <EditUserModal
        user={editUser === undefined ? null : editUser}
        open={editUser !== undefined}
        onClose={() => setEditUser(undefined)}
        onSaved={reload}
        teamMembers={teamMembers || []}
      />
      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Delete user?"
        description="This permanently removes their login. Their team member record and client assignments will not be affected."
        onConfirm={doDelete}
        onCancel={() => setConfirmDeleteId(null)}
        loading={deleting}
      />
      {resetLink && <ResetLinkModal url={resetLink} onClose={() => setResetLink(null)} />}
      <RegionalKeySection />
      <ConnectedSitesSection sites={opcoSites} loading={opcoLoading} save={saveOpcoSites} />
    </div>
  );
}
