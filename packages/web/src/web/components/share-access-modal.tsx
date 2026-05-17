import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Users, Mail, CheckCircle2, XCircle, Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getTeamMembers } from "@/lib/api";
import type { AirtableRecord, TeamMember } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  teamMembers: AirtableRecord<TeamMember>[];
  // Pre-selected IDs (e.g. from a deliverable's assigned members)
  preselectedIds?: string[];
}

interface SendResult {
  name: string;
  email: string;
  sent: boolean;
  error?: string;
}

export function ShareAccessModal({ open, onClose, teamMembers: teamMembersProp, preselectedIds = [] }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(preselectedIds));
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [teamMembers, setTeamMembers] = useState<AirtableRecord<TeamMember>[]>(teamMembersProp);

  useEffect(() => {
    if (open) {
      setSelected(new Set(preselectedIds));
      setResults(null);
      setMessage("");
      setSearch("");
      // Refresh team members each time the modal opens so new members appear
      getTeamMembers().then(setTeamMembers).catch(() => {});
    }
  }, [open, preselectedIds.join(",")]);

  const activeMembers = teamMembers.filter((m) => {
    const active = m.fields["Active Status"];
    const name = m.fields["Full Name"];
    return name && active !== false;
  });

  const filtered = activeMembers.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.fields["Full Name"]?.toLowerCase().includes(q) ||
      m.fields["Role"]?.toLowerCase().includes(q)
    );
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const getEmail = (m: AirtableRecord<TeamMember>) => {
    const e = m.fields["Email Address"];
    return typeof e === "object" ? (e as any)?.value || "" : e || "";
  };

  const handleSend = async () => {
    if (!selected.size) return;
    setSending(true);
    try {
      const siteUrl = window.location.origin;
      const res = await fetch("/api/share-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamMemberIds: [...selected],
          siteUrl,
          message: message.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results || []);
      const sent = (data.results || []).filter((r: SendResult) => r.sent).length;
      const failed = (data.results || []).filter((r: SendResult) => !r.sent).length;
      if (sent > 0 && failed === 0) {
        toast.success(`Invite sent to ${sent} team member${sent !== 1 ? "s" : ""}`);
      } else if (sent > 0 && failed > 0) {
        toast.warning(`Sent ${sent}, failed ${failed} — see details below`);
      } else {
        const firstError = (data.results || [])[0]?.error || "Unknown error";
        toast.error(`Invite failed: ${firstError}`);
      }
    } catch (e: any) {
      toast.error("Failed to send: " + e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-500" />
            Share Dashboard Access
          </DialogTitle>
        </DialogHeader>

        {results ? (
          // Results view
          <div className="flex-1 overflow-y-auto space-y-2 py-2">
            <p className="text-sm text-slate-500 mb-3">Invites sent:</p>
            {results.map((r, i) => (
              <div key={i} className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm",
                r.sent ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
              )}>
                {r.sent
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  : <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 truncate">{r.name}</p>
                  <p className="text-xs text-slate-500 truncate">{r.email}</p>
                  {!r.sent && r.error && <p className="text-xs text-red-500">{r.error}</p>}
                </div>
                <span className={cn("text-xs font-medium", r.sent ? "text-emerald-600" : "text-red-500")}>
                  {r.sent ? "Sent" : "Failed"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search team members…"
                className="pl-9 h-9 text-sm"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="w-3.5 h-3.5 text-slate-400" />
                </button>
              )}
            </div>

            {/* Team member list */}
            <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
              {filtered.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No team members found</p>
              ) : (
                filtered.map((m) => {
                  const isSelected = selected.has(m.id);
                  const email = getEmail(m);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggle(m.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors",
                        isSelected
                          ? "bg-sky-50 border-sky-200"
                          : "bg-white border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                        isSelected ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-600"
                      )}>
                        {m.fields["Full Name"]?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{m.fields["Full Name"]}</p>
                        <p className="text-xs text-slate-400 truncate">{email || m.fields["Role"] || "No email"}</p>
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
                })
              )}
            </div>

            {/* Optional message */}
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Personal message (optional)</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Add a note to include in the invite email…"
                rows={2}
                className="text-sm resize-none"
              />
            </div>

            {selected.size > 0 && (
              <p className="text-xs text-slate-500">
                Sending to <strong className="text-sky-600">{selected.size}</strong> team member{selected.size !== 1 ? "s" : ""}
              </p>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{results ? "Close" : "Cancel"}</Button>
          {!results && (
            <Button
              onClick={handleSend}
              disabled={!selected.size || sending}
              className="bg-sky-600 hover:bg-sky-700 text-white"
            >
              {sending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                : <><Mail className="w-4 h-4 mr-2" /> Send {selected.size > 0 ? `${selected.size} ` : ""}Invite{selected.size !== 1 ? "s" : ""}</>
              }
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
