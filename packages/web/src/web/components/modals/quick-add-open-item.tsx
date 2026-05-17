import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createOpenItem } from "@/lib/api";
import { toast } from "sonner";
import { Mic, MicOff, Loader2, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AirtableRecord, Client, TeamMember } from "@/lib/types";

const TYPES = ["Analytics", "Compliance", "HR Support", "Population Health", "Miscellaneous", "Other", "Member Support", "Planning Support", "Ancillary", "Technology"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  clients: AirtableRecord<Client>[];
  teamMembers: AirtableRecord<TeamMember>[];
}

type RecordingState = "idle" | "recording";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export function QuickAddOpenItemModal({ open, onClose, onSaved, clients }: Props) {
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [transcript, setTranscript] = useState("");
  const [liveText, setLiveText] = useState("");
  const [micSupported, setMicSupported] = useState(false);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setMicSupported(!!SR);
  }, []);

  useEffect(() => {
    if (open) {
      setName(""); setClientId(""); setType(""); setPriority(""); setDueDate("");
      setTranscript(""); setLiveText(""); setRecordingState("idle");
    }
  }, [open]);

  const parseTranscript = useCallback((text: string) => {
    let parsedName = text.trim();
    const lower = text.toLowerCase();

    // ── Client matching ──────────────────────────────────────────────────────
    // Strategy 1: "for [client name]" pattern — greedy to end of sentence
    const clientMatch = text.match(/\bfor\s+(.+?)(?:\s+(?:due|by|priority|type)\b|[.,]|$)/i);
    const spokenForClient = clientMatch?.[1]?.toLowerCase().trim() ?? "";

    // Strategy 2: scan entire transcript for any client name word appearing
    const findClient = (hint: string) => {
      if (!hint) return null;
      const hintWords = hint.split(/\s+/).filter((w) => w.length > 2);
      // Exact substring match first
      let match = clients.find((c) =>
        (c.fields["Client Name"] || "").toLowerCase().includes(hint)
      );
      if (match) return match;
      // Word-level partial: any spoken word appears in client name
      match = clients.find((c) => {
        const cn = (c.fields["Client Name"] || "").toLowerCase();
        return hintWords.some((w) => cn.includes(w));
      });
      return match ?? null;
    };

    // Try "for [name]" first, then fall back to scanning full transcript
    const matchedClient =
      findClient(spokenForClient) ??
      findClient(lower);

    if (matchedClient) setClientId(matchedClient.id);

    // ── Due date ─────────────────────────────────────────────────────────────
    const dueMatch = text.match(/\bdue\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday)\b/i);
    if (dueMatch) {
      const d = dueMatch[1].toLowerCase();
      const today = new Date();
      if (d === "today") {
        setDueDate(today.toISOString().split("T")[0]);
      } else if (d === "tomorrow") {
        today.setDate(today.getDate() + 1);
        setDueDate(today.toISOString().split("T")[0]);
      } else {
        const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
        const target = days.indexOf(d);
        if (target >= 0) {
          const diff = (target - today.getDay() + 7) % 7 || 7;
          today.setDate(today.getDate() + diff);
          setDueDate(today.toISOString().split("T")[0]);
        }
      }
    }

    // ── Priority ─────────────────────────────────────────────────────────────
    if (/\burgent\b/i.test(text)) setPriority("Urgent");
    else if (/\bhigh\b/i.test(text)) setPriority("High");
    else if (/\bmedium\b/i.test(text)) setPriority("Medium");
    else if (/\blow\b/i.test(text)) setPriority("Low");

    // ── Type ─────────────────────────────────────────────────────────────────
    const foundType = TYPES.find((t) => new RegExp(`\\b${t}\\b`, "i").test(text));
    if (foundType) setType(foundType);

    // ── Clean up name ─────────────────────────────────────────────────────────
    parsedName = parsedName
      .replace(/\bfor\s+.+?(?=\s+(?:due|by|priority|type)\b|[.,]|$)/i, "")
      .replace(/\bdue\s+\S+/i, "")
      .replace(/\b(urgent|high|medium|low)\b(\s*priority)?/i, "")
      .replace(new RegExp(`\\b(${TYPES.join("|")})\\b`, "i"), "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (parsedName) setName(parsedName);
  }, [clients]);

  const startRecording = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      setLiveText(interim || final);
      if (final) {
        setTranscript(final);
        parseTranscript(final);
        setLiveText("");
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== "aborted") toast.error(`Mic error: ${e.error}`);
      setRecordingState("idle");
      setLiveText("");
    };

    recognition.onend = () => {
      setRecordingState("idle");
      setLiveText("");
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecordingState("recording");
  }, [parseTranscript]);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Open item name is required"); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        "Open Item Name": name.trim(),
        "Status": "Not Started",
      };
      if (clientId) payload["Client"] = [clientId];
      if (type) payload["Open Item Type"] = type;
      if (priority) payload["Priority"] = priority;
      if (dueDate) payload["Due Date"] = dueDate;
      await createOpenItem(payload as any);
      toast.success("Open item created");
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to create open item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-sky-500" />
            Quick Add Open Item
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Mic section */}
          {micSupported && (
            <div className={cn(
              "rounded-xl border p-4 flex flex-col items-center gap-3 transition-colors",
              recordingState === "recording"
                ? "border-red-300 bg-red-50 dark:bg-red-950/20"
                : "border-dashed border-border bg-muted/40"
            )}>
              {recordingState === "recording" ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-sm font-medium text-red-600">Listening…</span>
                  </div>
                  {liveText && (
                    <p className="text-xs text-muted-foreground italic text-center">{liveText}</p>
                  )}
                  <button
                    onClick={stopRecording}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
                  >
                    <MicOff className="w-4 h-4" /> Done
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground text-center">
                    Say the item name, client, due date &amp; priority
                  </p>
                  <button
                    onClick={startRecording}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium transition-colors"
                  >
                    <Mic className="w-4 h-4" /> Speak Item
                  </button>
                </>
              )}
              {transcript && recordingState === "idle" && (
                <p className="text-xs text-muted-foreground italic text-center border-t border-border pt-2 w-full">
                  <Sparkles className="w-3 h-3 inline mr-1 text-sky-400" />
                  "{transcript}"
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label>Item Name <span className="text-red-500">*</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Review renewal proposal"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Select client…" /></SelectTrigger>
              <SelectContent>
                {clients.filter((c) => c.fields["Active"] !== false).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.fields["Client Name"]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue placeholder="Type…" /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue placeholder="Priority…" /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Plus className="w-4 h-4" /> Add Item</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
