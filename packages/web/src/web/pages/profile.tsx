import { useState, useMemo } from "react";
import { useSession } from "@/lib/session";
import { useTeamMembers, useClients, useDeliverables, useOpenItems } from "@/hooks/useData";
import { PageHeader } from "@/components/layout/page-header";
import { getAvatarUrl } from "@/lib/avatar";
import { cn, formatDate, formatRevenue } from "@/lib/utils";
import { toast } from "sonner";
import { RefreshCw, Mail, Phone, Users, Package, ClipboardList, TrendingUp, Check } from "lucide-react";
import { Link } from "wouter";
import type { AirtableRecord, TeamMember, Client, Deliverable, OpenItem } from "@/lib/types";

// DiceBear toon-head avatar URL for picker
function avatarUrl(seed: string, size = 96) {
  return `https://api.dicebear.com/9.x/toon-head/svg?seed=${encodeURIComponent(seed)}&size=${size}&backgroundColor=eef2ff,e0f2fe,ecfdf5,fef3c7,fce7f3,f3e8ff`;
}

const AVATAR_SEEDS = [
  "Felix", "Aneka", "Whiskers", "Milo", "Zara", "Jasper", "Luna", "Orion",
  "Pepper", "Sage", "Cleo", "Atlas", "Nova", "Ember", "Finn", "Ivy",
  "Storm", "Wren", "Dash", "Remy", "Quinn", "Juno", "Blaze", "Maple",
];

type ClientRole = "Service Lead" | "Producer" | "Analyst" | "Assigned Team Members";
const ROLE_LABELS: Record<ClientRole, string> = {
  "Service Lead": "Service Lead",
  "Producer": "Producer",
  "Analyst": "Analyst",
  "Assigned Team Members": "Team Member",
};
const ROLE_COLORS: Record<ClientRole, string> = {
  "Service Lead": "bg-sky-50 text-sky-700 border-sky-200",
  "Producer": "bg-violet-50 text-violet-700 border-violet-200",
  "Analyst": "bg-amber-50 text-amber-700 border-amber-200",
  "Assigned Team Members": "bg-slate-100 text-slate-600 border-slate-200",
};

export default function ProfilePage() {
  const { user } = useSession();
  const { data: allMembers, reload: reloadMembers } = useTeamMembers();
  const { data: allClients } = useClients();
  const { data: allDeliverables } = useDeliverables();
  const { data: allOpenItems } = useOpenItems();

  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [saving, setSaving] = useState(false);

  // Find linked team member
  const member = useMemo(
    () => (allMembers || []).find((m) => m.id === user?.airtableId) ?? null,
    [allMembers, user?.airtableId]
  );

  // Client assignments
  const assignedClients = useMemo(() => {
    if (!member) return [];
    return (allClients || [])
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
  }, [member, allClients]);

  const myDeliverables = useMemo(() => {
    if (!member) return [];
    return (allDeliverables || []).filter((d) =>
      (d.fields["Assigned Team Members"] || []).includes(member.id)
    );
  }, [member, allDeliverables]);

  const myOpenItems = useMemo(() => {
    if (!member) return [];
    return (allOpenItems || []).filter((o) =>
      (o.fields["Assigned To"] || []).includes(member.id)
    );
  }, [member, allOpenItems]);

  const stats = useMemo(() => ({
    clients: assignedClients.length,
    deliverables: myDeliverables.length,
    openDeliverables: myDeliverables.filter((d) => d.fields["Status"] !== "Completed" && d.fields["Status"] !== "Closed").length,
    openItems: myOpenItems.filter((o) => o.fields["Status"] !== "Closed" && o.fields["Status"] !== "Completed").length,
    completedDeliverables: myDeliverables.filter((d) => d.fields["Status"] === "Completed").length,
  }), [assignedClients, myDeliverables, myOpenItems]);

  const completionRate = myDeliverables.length > 0
    ? Math.round((stats.completedDeliverables / myDeliverables.length) * 100)
    : 0;

  // Visible seeds for picker
  const visibleSeeds = useMemo(() => {
    const extra = Array.from({ length: seedOffset }, (_, i) => `random_${seedOffset}_${i}`);
    return [...AVATAR_SEEDS, ...extra].slice(seedOffset, seedOffset + 12);
  }, [seedOffset]);

  const currentSeed = member?.fields["Avatar Seed"] || member?.fields["Full Name"] || user?.name || "default";

  const handlePickAvatar = async (seed: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/me/avatar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarSeed: seed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      toast.success("Avatar updated!");
      setShowAvatarPicker(false);
      reloadMembers();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetAvatar = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/me/avatar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarSeed: "" }),
      });
      if (!res.ok) throw new Error("Failed to reset");
      toast.success("Avatar reset to default");
      reloadMembers();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  const email = user.email || "";
  const rawEmail = member ? ((member.fields as any)["_email"] || member.fields["Email Address"]) : null;
  const memberEmail = typeof rawEmail === "object" ? rawEmail?.value : rawEmail;

  return (
    <div>
      <PageHeader title="My Profile" subtitle="View your profile and update your avatar" />

      <div className="px-4 sm:px-6 pb-8 max-w-3xl mx-auto">
        {/* Profile card */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 mb-5">
          <div className="flex items-start gap-5">
            {/* Avatar + picker */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative group">
                <img
                  src={member
                    ? getAvatarUrl(member.fields["Full Name"] || "?", member.fields["Avatar Seed"], 128)
                    : getAvatarUrl(user.name || "?", null, 128)
                  }
                  alt="Your avatar"
                  className="w-20 h-20 rounded-full border-2 border-slate-200 bg-slate-50 object-cover"
                />
                <button
                  onClick={() => { setShowAvatarPicker((v) => !v); setSeedOffset(0); }}
                  disabled={!member}
                  className={cn(
                    "absolute inset-0 rounded-full flex items-center justify-center bg-black/40 text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity",
                    !member && "cursor-not-allowed"
                  )}
                >
                  {member ? "Change" : ""}
                </button>
              </div>
              {member && (
                <button
                  onClick={() => setShowAvatarPicker((v) => !v)}
                  className="text-xs text-sky-600 hover:text-sky-700 font-medium transition-colors"
                >
                  {showAvatarPicker ? "Close picker" : "Change avatar"}
                </button>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-slate-800">
                {member?.fields["Full Name"] || user.name}
              </h2>
              {member?.fields["Role"] && (
                <p className="text-sm text-slate-500 mt-0.5">{member.fields["Role"]}</p>
              )}
              {!member && (
                <p className="text-sm text-slate-400 mt-0.5 italic">
                  Your account isn't linked to a team member profile
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-4">
                {(memberEmail || email) && (
                  <a href={`mailto:${memberEmail || email}`}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-sky-600 transition-colors">
                    <Mail className="w-3.5 h-3.5" /> {memberEmail || email}
                  </a>
                )}
                {member?.fields["Phone Number"] && (
                  <span className="flex items-center gap-1.5 text-sm text-slate-500">
                    <Phone className="w-3.5 h-3.5" /> {member.fields["Phone Number"]}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                <span className={cn(
                  "px-2 py-0.5 rounded-full font-medium",
                  user.role === "admin" ? "bg-violet-50 text-violet-600" : "bg-slate-100 text-slate-500"
                )}>
                  {user.role === "admin" ? "Admin" : "Team Member"}
                </span>
              </div>
            </div>
          </div>

          {/* Avatar picker */}
          {showAvatarPicker && member && (
            <div className="mt-5 p-4 border border-slate-200 rounded-xl bg-slate-50">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">Pick an avatar</span>
                <div className="flex items-center gap-3">
                  {member.fields["Avatar Seed"] && (
                    <button
                      onClick={handleResetAvatar}
                      disabled={saving}
                      className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      Reset to default
                    </button>
                  )}
                  <button
                    onClick={() => setSeedOffset((s) => s + 12)}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-sky-600 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" /> More options
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-6 sm:grid-cols-12 gap-2">
                {visibleSeeds.map((seed) => {
                  const isSelected = (member.fields["Avatar Seed"] || "") === seed;
                  return (
                    <button
                      key={seed}
                      onClick={() => handlePickAvatar(seed)}
                      disabled={saving}
                      className={cn(
                        "relative w-full aspect-square rounded-lg border-2 transition-all overflow-hidden bg-white hover:scale-105",
                        isSelected
                          ? "border-sky-500 ring-2 ring-sky-200"
                          : "border-slate-200 hover:border-slate-300",
                        saving && "opacity-50 pointer-events-none"
                      )}
                    >
                      <img
                        src={avatarUrl(seed, 64)}
                        alt={seed}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-sky-500/20 flex items-center justify-center">
                          <Check className="w-4 h-4 text-sky-600" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Stats bar — only when linked */}
        {member && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: "Clients", value: stats.clients, icon: Users, color: "text-sky-600" },
                { label: "Open Deliverables", value: stats.openDeliverables, icon: Package, color: "text-violet-600" },
                { label: "Open Items", value: stats.openItems, icon: ClipboardList, color: "text-amber-600" },
                { label: "Completion Rate", value: `${completionRate}%`, icon: TrendingUp, color: "text-emerald-600" },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={cn("w-4 h-4", color)} />
                    <span className="text-xs text-slate-500">{label}</span>
                  </div>
                  <p className="text-2xl font-bold text-slate-800">{value}</p>
                </div>
              ))}
            </div>

            {/* My clients */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-700">My Clients</h3>
              </div>
              {assignedClients.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-sm">Not assigned to any clients</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {assignedClients.map(({ client, roles }) => {
                    const cDel = myDeliverables.filter((d) => (d.fields["Client"] || [])[0] === client.id);
                    const cOI = myOpenItems.filter((o) => (o.fields["Client"] || [])[0] === client.id);
                    const openOI = cOI.filter((o) => o.fields["Status"] !== "Closed" && o.fields["Status"] !== "Completed");
                    return (
                      <div key={client.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link href={`/clients/${client.id}`}>
                              <a className="text-sm font-medium text-slate-700 hover:text-sky-600 transition-colors">
                                {client.fields["Client Name"]}
                              </a>
                            </Link>
                            {roles.map((r) => (
                              <span key={r} className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", ROLE_COLORS[r])}>
                                {ROLE_LABELS[r]}
                              </span>
                            ))}
                          </div>
                          {Number(client.fields["Revenue"]) > 0 && (
                            <p className="text-xs text-slate-400 mt-0.5">{formatRevenue(Number(client.fields["Revenue"]))}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                          <span><strong className="text-slate-700">{cDel.length}</strong> del.</span>
                          <span>
                            <strong className={openOI.length > 0 ? "text-amber-600" : "text-slate-700"}>
                              {openOI.length}
                            </strong> open
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {!member && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center">
            <p className="text-sm text-amber-700">
              Your account isn't linked to a team member profile. Ask your admin to link it in User Management so you can see your stats and change your avatar.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
