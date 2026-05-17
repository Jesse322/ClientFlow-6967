import { useState, useEffect } from "react";
import { useSession } from "@/lib/session";
import { useTeamMembers } from "@/hooks/useData";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { Bell, Mail, Clock, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface NotifSettings {
  airtable_member_id: string;
  notify_on_status_change: number;
  notify_on_new_item: number;
  notify_on_note_added: number;
  daily_digest_enabled: number;
  digest_always_send: number;
}

const DEFAULT_SETTINGS: Omit<NotifSettings, "airtable_member_id"> = {
  notify_on_status_change: 1,
  notify_on_new_item: 1,
  notify_on_note_added: 1,
  daily_digest_enabled: 1,
  digest_always_send: 0,
};

function Toggle({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
      <div className="pr-4">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
          checked ? "bg-sky-500" : "bg-slate-200"
        )}
      >
        <span className={cn(
          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200",
          checked ? "translate-x-4" : "translate-x-0"
        )} />
      </button>
    </div>
  );
}

function MemberSettingsPanel({ memberId, memberName, isAdmin }: {
  memberId: string; memberName: string; isAdmin: boolean;
}) {
  const [settings, setSettings] = useState<NotifSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!memberId) return;
    setLoading(true);
    apiFetch<NotifSettings>(`/notification-settings/${memberId}`)
      .then((data) => setSettings(data))
      .catch(() => setSettings({ airtable_member_id: memberId, ...DEFAULT_SETTINGS }))
      .finally(() => setLoading(false));
  }, [memberId]);

  const save = async (updated: NotifSettings) => {
    setSaving(true);
    try {
      await apiFetch(`/notification-settings/${memberId}`, {
        method: "PUT",
        body: JSON.stringify(updated),
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof Omit<NotifSettings, "airtable_member_id">, val: boolean) => {
    if (!settings) return;
    const updated = { ...settings, [key]: val ? 1 : 0 };
    setSettings(updated);
    save(updated);
  };

  if (loading) return (
    <div className="flex items-center gap-2 px-5 py-4 text-sm text-slate-400">
      <div className="animate-spin w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full" />
      Loading…
    </div>
  );

  if (!settings) return null;

  const anyEnabled = settings.notify_on_status_change || settings.notify_on_new_item || settings.notify_on_note_added || settings.daily_digest_enabled;

  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 bg-white hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
            anyEnabled ? "bg-sky-100 text-sky-600" : "bg-slate-100 text-slate-400"
          )}>
            {memberName.charAt(0).toUpperCase()}
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-slate-800">{memberName}</p>
            <p className="text-xs text-slate-400">
              {anyEnabled ? "Notifications active" : "All notifications off"}
              {saving && " · Saving…"}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-2 bg-slate-50/50">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-3 mb-1">Change Alerts</p>
          <Toggle
            label="Status changed"
            description="Email when a deliverable or open item status changes"
            checked={!!settings.notify_on_status_change}
            onChange={(v) => update("notify_on_status_change", v)}
          />
          <Toggle
            label="New item created"
            description="Email when a new deliverable or open item is created"
            checked={!!settings.notify_on_new_item}
            onChange={(v) => update("notify_on_new_item", v)}
          />
          <Toggle
            label="Note added"
            description="Email when a note is added to an assigned item"
            checked={!!settings.notify_on_note_added}
            onChange={(v) => update("notify_on_note_added", v)}
          />

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-1">Daily Digest</p>
          <Toggle
            label="Enable daily digest"
            description="8:00 AM PT · Overdue deliverables, items due this week"
            checked={!!settings.daily_digest_enabled}
            onChange={(v) => update("daily_digest_enabled", v)}
          />
          <Toggle
            label="Send even when nothing is urgent"
            description="Receive the digest daily regardless of pending items"
            checked={!!settings.digest_always_send}
            onChange={(v) => update("digest_always_send", v)}
          />
          <div className="py-2" />
        </div>
      )}
    </div>
  );
}

interface DigestCheck {
  name: string;
  ok: boolean;
  detail: string;
}

interface DigestStatus {
  allOk: boolean;
  checks: DigestCheck[];
}

export default function NotificationSettingsPage() {
  const { user } = useSession();
  const { data: teamMembers } = useTeamMembers();
  const [triggeringDigest, setTriggeringDigest] = useState(false);
  const [digestStatus, setDigestStatus] = useState<DigestStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const isAdmin = user?.role === "admin";
  const userAirtableId = (user as any)?.airtableId;

  const activeMembers = (teamMembers || []).filter(
    (m) => m.fields["Active Status"] !== false
  );

  const triggerDigest = async () => {
    setTriggeringDigest(true);
    try {
      await apiFetch("/admin/trigger-digest", { method: "POST" });
      toast.success("Digest emails sent — check your inbox");
    } catch {
      toast.error("Trigger failed");
    } finally {
      setTriggeringDigest(false);
    }
  };

  const checkDigestStatus = async () => {
    setStatusLoading(true);
    try {
      const data = await apiFetch<DigestStatus>("/admin/digest-status");
      setDigestStatus(data);
    } catch {
      toast.error("Could not load digest status");
    } finally {
      setStatusLoading(false);
    }
  };

  // Auto-load status on mount for admins
  useEffect(() => {
    if (isAdmin) checkDigestStatus();
  }, [isAdmin]);

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Configure email alerts for changes and daily digests"
      />

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
              <Bell className="w-4 h-4 text-sky-600" />
            </div>
            <h3 className="font-semibold text-slate-800">Change Alerts</h3>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed">
            Instant emails when a status changes, a new item is created, or a note is added.
            Sent to the admin and the assigned team member.
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <h3 className="font-semibold text-slate-800">Daily Digest</h3>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed">
            Sent every morning at <strong>8:00 AM PT</strong>. Each team member only sees
            their own assigned items — overdue deliverables and items due within 7 days.
          </p>
        </div>
      </div>

      {/* Per-member settings */}
      {isAdmin ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Team Notification Preferences</h2>
            <p className="text-xs text-slate-400 mt-0.5">Configure notifications for each team member</p>
          </div>
          <div className="divide-y divide-slate-50 px-5 py-3 space-y-2">
            {activeMembers.length === 0 && (
              <p className="text-sm text-slate-400 py-4">No active team members found.</p>
            )}
            {activeMembers.map((m) => (
              <MemberSettingsPanel
                key={m.id}
                memberId={m.id}
                memberName={m.fields["Full Name"] || m.id}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        </div>
      ) : userAirtableId ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Your Notification Preferences</h2>
          </div>
          <div className="px-5 py-3">
            <MemberSettingsPanel
              memberId={userAirtableId}
              memberName={user?.name || "You"}
              isAdmin={false}
            />
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
          <p className="text-sm text-amber-800">
            Your account isn't linked to a team member profile. Ask your admin to link your account to enable personalized notifications.
          </p>
        </div>
      )}

      {/* Admin tools */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Digest Health Check</h2>
              <p className="text-xs text-slate-400 mt-0.5">Diagnose why the scheduled digest may not be sending</p>
            </div>
            <Button
              onClick={checkDigestStatus}
              disabled={statusLoading}
              variant="outline"
              size="sm"
              className="flex items-center gap-1.5 shrink-0"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", statusLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>

          <div className="px-5 py-4 space-y-2.5">
            {statusLoading && !digestStatus && (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                <div className="animate-spin w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full" />
                Checking…
              </div>
            )}

            {digestStatus && (
              <>
                {/* Overall status banner */}
                <div className={cn(
                  "flex items-center gap-3 rounded-lg px-4 py-3 mb-3",
                  digestStatus.allOk
                    ? "bg-green-50 border border-green-200"
                    : "bg-red-50 border border-red-200"
                )}>
                  {digestStatus.allOk
                    ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    : <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  }
                  <p className={cn("text-sm font-medium", digestStatus.allOk ? "text-green-800" : "text-red-700")}>
                    {digestStatus.allOk
                      ? "Everything looks good — digest should be running"
                      : "Issues found — digest may not be sending"}
                  </p>
                </div>

                {/* Individual checks */}
                {digestStatus.checks.map((check) => (
                  <div key={check.name} className="flex items-start gap-3 py-2 border-b border-slate-50 last:border-0">
                    {check.ok
                      ? <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                      : <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    }
                    <div>
                      <p className="text-sm font-medium text-slate-700">{check.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{check.detail}</p>
                    </div>
                  </div>
                ))}

                {/* Cloudflare cron note */}
                <div className="flex items-start gap-3 mt-3 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    <strong>Cloudflare cron:</strong> Even with correct config, verify the trigger is registered in your Cloudflare dashboard under Workers &amp; Pages → your worker → <strong>Triggers</strong> tab. A redeploy may be needed to activate new cron entries.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Send now */}
          <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex items-center gap-3 flex-wrap">
            <Button
              onClick={triggerDigest}
              disabled={triggeringDigest}
              size="sm"
              className="flex items-center gap-2"
            >
              {triggeringDigest
                ? <><div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" /> Sending…</>
                : <><Mail className="w-3.5 h-3.5" /> Send Digest Now</>
              }
            </Button>
            <p className="text-xs text-slate-400">Manually fires the digest to all active members with assigned items</p>
          </div>
        </div>
      )}
    </div>
  );
}
