import { useState, useMemo, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useTeamMembers, useClients, useDeliverables, useOpenItems } from "@/hooks/useData";
import { PageHeader } from "@/components/layout/page-header";
import { EditTeamMemberModal } from "@/components/modals/edit-team-member";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteTeamMember, updateClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatRevenue } from "@/lib/utils";
import { getAvatarUrl } from "@/lib/avatar";
import { toast } from "sonner";
import type { AirtableRecord, TeamMember, Client, Deliverable, OpenItem } from "@/lib/types";
import { Plus, Search, Pencil, Trash2, X, Users, Mail, Phone, UserPlus, ClipboardList, Package, DollarSign } from "lucide-react";
import { ExpandCard } from "@/components/ui/expand-card";

const ROLES = ["All", "Practice Leader", "Account Manager", "Account Executive", "Account Representative", "Compliance Specialist", "Analyst", "Producer", "PHM Support", "HR Tech Support", "Regional Operations Director"];
const CLIENT_ROLES = ["Service Lead", "Producer", "Analyst", "Assigned Team Members"] as const;
type ClientRole = typeof CLIENT_ROLES[number];

const ROLE_COLORS: Record<ClientRole, string> = {
  "Service Lead":          "bg-sky-50 text-sky-700 border-sky-200",
  "Producer":              "bg-violet-50 text-violet-700 border-violet-200",
  "Analyst":               "bg-amber-50 text-amber-700 border-amber-200",
  "Assigned Team Members": "bg-slate-100 text-slate-600 border-slate-200",
};
const ROLE_LABELS: Record<ClientRole, string> = {
  "Service Lead":          "Service Lead",
  "Producer":              "Producer",
  "Analyst":               "Analyst",
  "Assigned Team Members": "Team Member",
};

// ─── Add-to-client popover ────────────────────────────────────────────────────
function AddToClientDropdown({
  member,
  clients,
  onAdded,
}: {
  member: AirtableRecord<TeamMember>;
  clients: AirtableRecord<Client>[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<ClientRole>("Service Lead");
  const [saving, setSaving] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const unassignedClients = useMemo(() => {
    return clients.filter((c) => {
      const ids = [
        ...(c.fields["Producer"] || []),
        ...(c.fields["Service Lead"] || []),
        ...(c.fields["Analyst"] || []),
        ...(c.fields["Assigned Team Members"] || []),
      ];
      return !ids.includes(member.id);
    });
  }, [clients, member.id]);

  const filtered = useMemo(() => {
    if (!search) return unassignedClients;
    const q = search.toLowerCase();
    return unassignedClients.filter((c) =>
      c.fields["Client Name"]?.toLowerCase().includes(q)
    );
  }, [unassignedClients, search]);

  const assign = async (client: AirtableRecord<Client>) => {
    setSaving(client.id);
    try {
      const existing = client.fields[role] as string[] | undefined;
      let updated: string[];
      if (role === "Assigned Team Members") {
        updated = [...(existing || []), member.id];
      } else {
        // single-value fields — replace
        updated = [member.id];
      }
      await updateClient(client.id, { [role]: updated } as any);
      toast.success(`Added to ${client.fields["Client Name"]} as ${ROLE_LABELS[role]}`);
      onAdded();
      setOpen(false);
      setSearch("");
    } catch (e: any) {
      toast.error("Failed: " + e.message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-sky-600 px-2 py-1 rounded hover:bg-sky-50 transition-colors"
      >
        <UserPlus className="w-3.5 h-3.5" />
        Add to client
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg w-72">
          <div className="p-3 border-b border-slate-100 space-y-2">
            <p className="text-xs font-semibold text-slate-600">Assign {member.fields["Full Name"]}</p>
            {/* Role selector */}
            <Select value={role} onValueChange={(v) => setRole(v as ClientRole)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Client search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients…"
                className="pl-7 h-8 text-xs"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">
                {unassignedClients.length === 0 ? "Already on all clients" : "No clients match"}
              </p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => assign(c)}
                  disabled={saving === c.id}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 text-left transition-colors"
                >
                  <span className="text-sm text-slate-700 truncate">{c.fields["Client Name"]}</span>
                  {saving === c.id
                    ? <div className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin shrink-0" />
                    : <Plus className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  }
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-slate-100 text-slate-500",
  "In Progress": "bg-blue-50 text-blue-600",
  "Stuck":       "bg-orange-50 text-orange-600",
  "Closed":      "bg-emerald-50 text-emerald-600",
  "Completed":   "bg-emerald-50 text-emerald-600",
  "Overdue":     "bg-red-50 text-red-600",
};

// ─── Member card ─────────────────────────────────────────────────────────────
function MemberCard({
  member,
  clients,
  deliverables,
  openItems,
  deliverableCount,
  openItemCount,
  onEdit,
  onDelete,
  onReload,
}: {
  member: AirtableRecord<TeamMember>;
  clients: AirtableRecord<Client>[];
  deliverables: AirtableRecord<Deliverable>[];
  openItems: AirtableRecord<OpenItem>[];
  deliverableCount: number;
  openItemCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onReload: () => void;
}) {
  const [, navigate] = useLocation();

  const assignedClients = useMemo(() => {
    return clients
      .filter((c) => {
        const ids = [
          ...(c.fields["Producer"] || []),
          ...(c.fields["Service Lead"] || []),
          ...(c.fields["Analyst"] || []),
          ...(c.fields["Assigned Team Members"] || []),
        ];
        return ids.includes(member.id);
      })
      .map((c) => {
        const roles: ClientRole[] = [];
        if ((c.fields["Service Lead"] || []).includes(member.id)) roles.push("Service Lead");
        if ((c.fields["Producer"] || []).includes(member.id)) roles.push("Producer");
        if ((c.fields["Analyst"] || []).includes(member.id)) roles.push("Analyst");
        if ((c.fields["Assigned Team Members"] || []).includes(member.id)) roles.push("Assigned Team Members");
        return { client: c, roles };
      })
      .sort((a, b) => (a.client.fields["Client Name"] || "").localeCompare(b.client.fields["Client Name"] || ""));
  }, [clients, member.id]);

  const isActive = member.fields["Active Status"] !== false;
  const initials = (member.fields["Full Name"] || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const email = (() => { const e = (member.fields as any)["_email"] || member.fields["Email Address"]; return (typeof e === "object" ? (e as any)?.value : e) || ""; })();
  const bookSize = assignedClients.reduce((sum, { client }) => sum + (Number(client.fields["Revenue"]) || 0), 0);

  return (
    <ExpandCard
      color={isActive ? "#0ea5e9" : "#94a3b8"}
      expandedContent={
        <div className="space-y-3">
          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span><strong className="text-foreground">{assignedClients.length}</strong> client{assignedClients.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Package className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span><strong className="text-foreground">{deliverableCount}</strong> deliverable{deliverableCount !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ClipboardList className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span><strong className="text-foreground">{openItemCount}</strong> open item{openItemCount !== 1 ? "s" : ""}</span>
            </div>
            {bookSize > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <DollarSign className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span><strong className="text-foreground">{formatRevenue(bookSize)}</strong> book size</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <button onClick={() => navigate(`/team/${member.id}`)} className="text-xs text-sky-600 hover:text-sky-700 font-medium">
              View profile →
            </button>
            <AddToClientDropdown member={member} clients={clients} onAdded={onReload} />
          </div>
        </div>
      }
    >
      <button className="w-full text-left flex items-start gap-3" onClick={() => navigate(`/team/${member.id}`)}>
        <img
          src={getAvatarUrl(member.fields["Full Name"] || "?", member.fields["Avatar Seed"])}
          alt={initials}
          className={cn("w-10 h-10 rounded-full shrink-0 object-cover bg-slate-50", !isActive && "opacity-40 grayscale")}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate">{member.fields["Full Name"] || "—"}</p>
              {member.fields["Role"] && <p className="text-xs text-muted-foreground mt-0.5">{member.fields["Role"]}</p>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1.5 rounded hover:bg-accent text-muted-foreground">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {email && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5">
              <Mail className="w-3 h-3 shrink-0" /><span className="truncate">{email}</span>
            </div>
          )}
          {!isActive && <span className="inline-block mt-1.5 text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">Inactive</span>}
        </div>
      </button>
    </ExpandCard>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TeamMembersPage() {
  const { data: members, loading, reload } = useTeamMembers();
  const { data: clients, reload: reloadClients } = useClients();
  const { data: deliverables } = useDeliverables();
  const { data: openItems } = useOpenItems();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("active");
  const [editItem, setEditItem] = useState<AirtableRecord<TeamMember> | null | undefined>(undefined);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const taskCounts = useMemo(() => {
    const counts: Record<string, { deliverables: number; openItems: number }> = {};
    (members || []).forEach((m) => { counts[m.id] = { deliverables: 0, openItems: 0 }; });
    (deliverables || []).forEach((d) => {
      (d.fields["Assigned Team Members"] || []).forEach((id: string) => {
        if (counts[id]) counts[id].deliverables++;
      });
    });
    (openItems || []).forEach((o) => {
      (o.fields["Assigned To"] || []).forEach((id: string) => {
        if (counts[id]) counts[id].openItems++;
      });
    });
    return counts;
  }, [members, deliverables, openItems]);

  const filtered = useMemo(() => {
    let list = members || [];
    if (activeFilter === "active") list = list.filter((m) => m.fields["Active Status"] !== false);
    if (activeFilter === "inactive") list = list.filter((m) => m.fields["Active Status"] === false);
    if (roleFilter !== "All") list = list.filter((m) => m.fields["Role"] === roleFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((m) =>
        m.fields["Full Name"]?.toLowerCase().includes(q) ||
        m.fields["Role"]?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [members, search, roleFilter, activeFilter]);

  const doDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await deleteTeamMember(confirmDeleteId);
      toast.success("Team member removed");
      reload();
    } catch { toast.error("Delete failed"); }
    finally { setDeleting(false); setConfirmDeleteId(null); }
  };

  const counts = useMemo(() => ({
    total: (members || []).length,
    active: (members || []).filter((m) => m.fields["Active Status"] !== false).length,
  }), [members]);

  return (
    <div>
      <PageHeader
        title="Team Members"
        subtitle={`${counts.active} active · ${counts.total} total`}
        actions={
          <Button size="sm" onClick={() => setEditItem(null)} className="bg-sky-600 hover:bg-sky-700 text-white">
            <Plus className="w-4 h-4 mr-1" /> Add Member
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex gap-2 mb-5 flex-wrap items-center">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {(["active", "all", "inactive"] as const).map((f) => (
            <button key={f} onClick={() => setActiveFilter(f)}
              className={cn("px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                activeFilter === f ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              )}>
              {f}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search members…" className="pl-9 h-9 text-sm" />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5 text-slate-400" /></button>}
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r === "All" ? "All roles" : r}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">No team members found</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((member) => {
            const tc = taskCounts[member.id] || { deliverables: 0, openItems: 0 };
            return (
              <MemberCard
                key={member.id}
                member={member}
                clients={clients || []}
                deliverables={deliverables || []}
                openItems={openItems || []}
                deliverableCount={tc.deliverables}
                openItemCount={tc.openItems}
                onEdit={() => setEditItem(member)}
                onDelete={() => setConfirmDeleteId(member.id)}
                onReload={() => { reload(); reloadClients(); }}
              />
            );
          })}
        </div>
      )}

      <EditTeamMemberModal
        item={editItem === undefined ? null : editItem}
        open={editItem !== undefined}
        onClose={() => setEditItem(undefined)}
        onSaved={reload}
      />
      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Remove team member?"
        description="This removes them from the team roster. Their existing client and deliverable assignments will remain."
        onConfirm={doDelete}
        onCancel={() => setConfirmDeleteId(null)}
        loading={deleting}
      />
    </div>
  );
}
