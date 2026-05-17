/**
 * NotesLog — displays and adds timestamped notes with author names.
 *
 * Storage format in the Notes field (multilineText):
 *   [2026-03-25 10:42 | Jesse Valentine] Initial note here
 *   [2026-03-26 14:05 | Sarah Chen] Follow-up: carrier responded
 *
 * Legacy format (no author):
 *   [2026-03-25 10:42] Note text
 *
 * Unformatted legacy notes are shown as-is at the top.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Send, Loader2, MessageSquare, Trash2 } from "lucide-react";

export interface LogEntry {
  timestamp: string; // ISO or formatted
  author?: string;
  text: string;
  isLegacy?: boolean;
  /** Original line index for deletion */
  lineStart: number;
  lineEnd: number;
}

export function parseNotes(raw: string | undefined): LogEntry[] {
  if (!raw?.trim()) return [];
  const lines = raw.split("\n");
  const entries: LogEntry[] = [];
  let current: LogEntry | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: [2026-03-25 10:42 | Author Name] text
    const matchWithAuthor = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) \| ([^\]]+)\] (.*)$/);
    // Match: [2026-03-25 10:42] text (legacy, no author)
    const matchNoAuthor = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] (.*)$/);

    if (matchWithAuthor) {
      if (current) entries.push(current);
      current = {
        timestamp: matchWithAuthor[1],
        author: matchWithAuthor[2].trim(),
        text: matchWithAuthor[3],
        lineStart: i,
        lineEnd: i,
      };
    } else if (matchNoAuthor) {
      if (current) entries.push(current);
      current = {
        timestamp: matchNoAuthor[1],
        text: matchNoAuthor[2],
        lineStart: i,
        lineEnd: i,
      };
    } else if (current) {
      // continuation of previous entry
      current.text += "\n" + line;
      current.lineEnd = i;
    } else if (line.trim()) {
      // legacy unformatted note
      entries.push({ timestamp: "", text: line, isLegacy: true, lineStart: i, lineEnd: i });
    }
  }
  if (current) entries.push(current);
  return entries;
}

export function appendNote(existingNotes: string | undefined, newText: string, authorName?: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const authorPart = authorName ? ` | ${authorName}` : "";
  const newLine = `[${timestamp}${authorPart}] ${newText.trim()}`;
  if (!existingNotes?.trim()) return newLine;
  return existingNotes.trimEnd() + "\n" + newLine;
}

export function deleteNote(existingNotes: string, entry: LogEntry): string {
  const lines = existingNotes.split("\n");
  const filtered = lines.filter((_, i) => i < entry.lineStart || i > entry.lineEnd);
  return filtered.join("\n").trim();
}

interface Props {
  notes: string | undefined;
  onAdd: (updatedNotes: string) => Promise<void>;
  onUpdate?: (updatedNotes: string) => Promise<void>;
  authorName?: string;
  readOnly?: boolean;
  maxHeight?: string;
}

export function NotesLog({ notes, onAdd, onUpdate, authorName, readOnly = false, maxHeight = "max-h-48" }: Props) {
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const entries = parseNotes(notes);

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      const updated = appendNote(notes, newNote.trim(), authorName);
      await onAdd(updated);
      setNewNote("");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: LogEntry, idx: number) => {
    if (!notes) return;
    const handler = onUpdate || onAdd;
    setDeletingIdx(idx);
    try {
      const updated = deleteNote(notes, entry);
      await handler(updated);
    } finally {
      setDeletingIdx(null);
    }
  };

  return (
    <div className="space-y-2">
      {/* Existing entries */}
      {entries.length > 0 && (
        <div className={cn("overflow-y-auto space-y-2", maxHeight)}>
          {entries.map((entry, i) => (
            <div key={i} className={cn(
              "group rounded-lg px-3 py-2.5 text-sm relative",
              entry.isLegacy
                ? "bg-slate-50 border border-slate-100"
                : "bg-sky-50/50 border border-sky-100"
            )}>
              {!entry.isLegacy && (entry.timestamp || entry.author) && (
                <div className="flex items-center gap-1.5 mb-1">
                  <MessageSquare className="w-3 h-3 text-sky-400" />
                  {entry.author && (
                    <span className="text-[10px] font-semibold text-sky-700">{entry.author}</span>
                  )}
                  {entry.author && entry.timestamp && (
                    <span className="text-[10px] text-sky-300">·</span>
                  )}
                  {entry.timestamp && (
                    <span className="text-[10px] text-sky-400">{entry.timestamp}</span>
                  )}
                </div>
              )}
              <p className="text-slate-700 whitespace-pre-wrap text-sm leading-relaxed pr-6">{entry.text}</p>

              {/* Delete button */}
              {!readOnly && (
                <button
                  onClick={() => handleDelete(entry, i)}
                  disabled={deletingIdx !== null}
                  className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-slate-300 hover:text-red-500 transition-all"
                  title="Delete note"
                >
                  {deletingIdx === i ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {entries.length === 0 && (
        <p className="text-xs text-slate-400 italic">No notes yet.</p>
      )}

      {/* Add new note */}
      {!readOnly && (
        <div className="flex gap-2 items-end pt-1">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd();
            }}
            placeholder="Add an update… (⌘Enter to submit)"
            rows={2}
            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !newNote.trim()}
            className="shrink-0 h-9 w-9 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white flex items-center justify-center transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      )}
    </div>
  );
}
