import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { useSession } from "@/lib/session";
import {
  X, Send, Bot, Loader2, CheckCircle, XCircle, Sparkles, Trash2,
  ChevronRight, AlertTriangle, Users, CheckSquare, AlertCircle, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface ActionTaken {
  type: string;
  description: string;
  count?: number;
}

interface ResultRow {
  id?: string;
  href?: string;
  cols: string[];
}

interface ResultTable {
  headers: string[];
  rows: ResultRow[];
}

type MsgType = "answer" | "mutation" | "search_result" | "suggestion" | "error";

interface Message {
  role: "user" | "assistant";
  text: string;
  msgType?: MsgType;
  actionsTaken?: ActionTaken[];
  table?: ResultTable;
  success?: boolean;
  model?: string;
  retryable?: boolean;
  retryPayload?: { message: string; history: any[] };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

// ── Example prompts by category ──────────────────────────────────────────────
const EXAMPLE_GROUPS = [
  {
    label: "Questions",
    icon: <Users className="w-3 h-3" />,
    examples: [
      "Which clients are renewing in the next 30 days?",
      "Who has the most open items right now?",
      "Which clients are at risk?",
    ],
  },
  {
    label: "Updates",
    icon: <CheckSquare className="w-3 h-3" />,
    examples: [
      "Close all open items for [client name]",
      "Assign all stuck items to [team member]",
      "Mark deliverable [name] as Completed",
    ],
  },
  {
    label: "Search",
    icon: <AlertCircle className="w-3 h-3" />,
    examples: [
      "Show me all stuck items for Level Funded clients",
      "Find overdue deliverables for clients renewing this quarter",
    ],
  },
  {
    label: "Summaries",
    icon: <RefreshCw className="w-3 h-3" />,
    examples: [
      "Give me a status briefing for [client name]",
      "Summarize the team's workload",
    ],
  },
];

// ── Render a result table ─────────────────────────────────────────────────────
function ResultTableView({ table }: { table: ResultTable }) {
  if (!table.rows.length) return <p className="text-xs text-slate-400 italic">No results found.</p>;
  return (
    <div className="mt-2 rounded-lg border border-slate-200 overflow-hidden text-xs">
      <div className="grid bg-slate-50 border-b border-slate-200" style={{ gridTemplateColumns: `repeat(${table.headers.length}, 1fr)` }}>
        {table.headers.map((h) => (
          <div key={h} className="px-2 py-1.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] truncate">{h}</div>
        ))}
      </div>
      {table.rows.slice(0, 12).map((row, i) => {
        const inner = (
          <div key={i} className="grid divide-x divide-slate-100 hover:bg-sky-50/50 transition-colors" style={{ gridTemplateColumns: `repeat(${table.headers.length}, 1fr)` }}>
            {row.cols.map((col, j) => (
              <div key={j} className="px-2 py-1.5 text-slate-700 truncate">{col}</div>
            ))}
          </div>
        );
        return row.href ? (
          <Link key={i} href={row.href}>{inner}</Link>
        ) : inner;
      })}
      {table.rows.length > 12 && (
        <div className="px-2 py-1.5 text-[10px] text-slate-400 border-t border-slate-100 bg-slate-50">
          +{table.rows.length - 12} more results
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function AiChatPanel({ open, onClose, onUpdated }: Props) {
  const { isAdmin } = useSession();
  const [model, setModel] = useState<"gpt-4o-mini" | "gpt-4o">("gpt-4o-mini");

  const INITIAL_MESSAGE: Message = {
    role: "assistant",
    text: "Hey! I'm your AI assistant. I know everything in your dashboard — clients, open items, deliverables, team members.\n\nAsk me anything, make updates, search your data, or get a status briefing. Try one of the examples below.",
    msgType: "answer",
  };

  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showExamples, setShowExamples] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  const handleClear = () => {
    setMessages([INITIAL_MESSAGE]);
    setShowExamples(true);
    setInput("");
  };

  const handleRetry = useCallback(async (payload: { message: string; history: any[]; model?: string }) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) {
        const isTransient = data.retryable || data.error?.includes("Network connection lost") || data.error?.includes("D1_ERROR");
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: isTransient
            ? "Still having trouble connecting. Please try again in a moment."
            : `Error: ${data.error}`,
          msgType: "error",
          success: false,
          retryable: isTransient,
          retryPayload: isTransient ? payload : undefined,
        }]);
      } else {
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: data.message || "Done.",
          msgType: data.type || "answer",
          actionsTaken: data.actions_taken,
          table: data.table,
          success: data.success !== false,
          model: data.model,
        }]);
        if (data.mutated && onUpdated) onUpdated();
      }
    } catch {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: "Still can't connect. Please try again.",
        msgType: "error",
        success: false,
      }]);
    } finally {
      setLoading(false);
    }
  }, [loading, onUpdated]);

  const handleSend = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    setInput("");
    setShowExamples(false);

    const userMsg: Message = { role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    // Build conversation history for API (exclude initial greeting)
    const history = messages
      .slice(1) // skip initial greeting
      .map((m) => ({ role: m.role, content: m.text }));

    const payload = { message: text, history, model };
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.error) {
        const isTransient = data.retryable ||
          data.error?.includes("Network connection lost") ||
          data.error?.includes("D1_ERROR");
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: isTransient
            ? "The database had a hiccup. Hit retry — it usually works on the second attempt."
            : `Sorry, something went wrong: ${data.error}`,
          msgType: "error",
          success: false,
          retryable: isTransient,
          retryPayload: isTransient ? payload : undefined,
        }]);
      } else {
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: data.message || "Done.",
          msgType: data.type || "answer",
          actionsTaken: data.actions_taken,
          table: data.table,
          success: data.success !== false,
          model: data.model,
        }]);
        if (data.mutated && onUpdated) onUpdated();
      }
    } catch {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: "Connection lost. Please try again.",
        msgType: "error",
        success: false,
        retryable: true,
        retryPayload: payload,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, onUpdated]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const mutationCount = messages.filter((m) => m.msgType === "mutation" && m.success).length;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop (mobile) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20 lg:hidden"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 40 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-[420px] max-w-[95vw] bg-white border-l border-slate-200 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">AI Assistant</p>
                  <p className="text-[10px] text-slate-400">
                    {mutationCount > 0 ? `${mutationCount} update${mutationCount !== 1 ? "s" : ""} this session` : "Ask anything about your data"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Model toggle — admin only */}
                {isAdmin && (
                  <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[10px] font-semibold">
                    <button
                      onClick={() => setModel("gpt-4o-mini")}
                      className={cn(
                        "px-2 py-1 transition-colors",
                        model === "gpt-4o-mini"
                          ? "bg-slate-800 text-white"
                          : "bg-white text-slate-500 hover:bg-slate-50"
                      )}
                      title="Mini — faster and cheaper"
                    >
                      Mini
                    </button>
                    <button
                      onClick={() => setModel("gpt-4o")}
                      className={cn(
                        "px-2 py-1 transition-colors",
                        model === "gpt-4o"
                          ? "bg-indigo-600 text-white"
                          : "bg-white text-slate-500 hover:bg-slate-50"
                      )}
                      title="Full GPT-4o — smarter, higher cost"
                    >
                      4o
                    </button>
                  </div>
                )}
                {messages.length > 1 && (
                  <button
                    onClick={handleClear}
                    title="Clear conversation"
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn("flex gap-2.5", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
                >
                  {msg.role === "assistant" && (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-3 h-3 text-white" />
                    </div>
                  )}
                  <div className={cn("max-w-[88%] space-y-1.5", msg.role === "user" ? "items-end" : "items-start", "flex flex-col")}>
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                        msg.role === "user"
                          ? "bg-sky-500 text-white rounded-tr-sm"
                          : "bg-slate-100 text-slate-800 rounded-tl-sm"
                      )}
                    >
                      {/* Mutation status badge */}
                      {msg.role === "assistant" && msg.msgType === "mutation" && msg.success !== undefined && (
                        <div className={cn("flex items-center gap-1 mb-1.5 text-xs font-semibold", msg.success ? "text-emerald-600" : "text-red-500")}>
                          {msg.success
                            ? <><CheckCircle className="w-3.5 h-3.5" /> Done</>
                            : <><XCircle className="w-3.5 h-3.5" /> Failed</>
                          }
                        </div>
                      )}
                      <p className="whitespace-pre-line">{msg.text}</p>
                    </div>

                    {/* Retry button for transient errors */}
                    {msg.role === "assistant" && msg.retryable && msg.retryPayload && (
                      <button
                        onClick={() => handleRetry(msg.retryPayload!)}
                        disabled={loading}
                        className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-medium mt-0.5 disabled:opacity-50"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry
                      </button>
                    )}

                    {/* Actions taken */}
                    {msg.actionsTaken && msg.actionsTaken.length > 0 && (
                      <div className="space-y-1 w-full">
                        {msg.actionsTaken.map((a, j) => (
                          <div key={j} className="flex items-center gap-1.5 text-[11px] text-slate-500 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5">
                            <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                            <span>{a.description}{a.count && a.count > 1 ? ` (${a.count})` : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Result table */}
                    {msg.table && <ResultTableView table={msg.table} />}

                    {/* Model label — admin only */}
                    {isAdmin && msg.role === "assistant" && msg.model && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {msg.model === "gpt-4o" ? "⚡ GPT-4o" : "· mini"}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center shrink-0">
                    <Bot className="w-3 h-3 text-white" />
                  </div>
                  <div className="bg-slate-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Example prompts (shown initially, collapsible) */}
            {showExamples && (
              <div className="px-4 pb-3 shrink-0">
                <div className="space-y-3">
                  {EXAMPLE_GROUPS.map((group) => (
                    <div key={group.label}>
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                        {group.icon} {group.label}
                      </div>
                      <div className="flex flex-col gap-1">
                        {group.examples.map((ex) => (
                          <button
                            key={ex}
                            onClick={() => handleSend(ex)}
                            className="text-left text-xs text-slate-600 bg-slate-50 hover:bg-sky-50 hover:text-sky-700 border border-slate-200 hover:border-sky-200 rounded-lg px-3 py-1.5 transition-all flex items-center justify-between gap-2 group"
                          >
                            <span className="truncate">{ex}</span>
                            <ChevronRight className="w-3 h-3 shrink-0 text-slate-300 group-hover:text-sky-400 transition-colors" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="px-4 py-3 border-t border-slate-100 shrink-0">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
                  rows={1}
                  className="flex-1 resize-none text-sm text-slate-800 placeholder:text-slate-400 border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300 transition-all bg-white leading-relaxed max-h-32 overflow-y-auto"
                  disabled={loading}
                  style={{ minHeight: "40px" }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 128) + "px";
                  }}
                />
                <Button
                  size="icon"
                  onClick={() => handleSend()}
                  disabled={loading || !input.trim()}
                  className="h-10 w-10 bg-sky-500 hover:bg-sky-600 shrink-0 rounded-xl"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </Button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5 text-center">
                AI can make real changes to your data. Review updates before relying on them.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
