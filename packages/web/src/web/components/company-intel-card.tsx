import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Building2, MapPin, Users, Calendar, RefreshCw, ExternalLink, Newspaper, ChevronDown, ChevronUp } from "lucide-react";

interface Intel {
  bio: string;
  industry: string;
  headquarters: string;
  founded: string;
  employeeEstimate: string;
  newsItems: { headline: string; summary: string; date: string }[];
}

interface Props {
  companyName: string;
  industry?: string;
  location?: string;
}

export function CompanyIntelCard({ companyName, industry, location }: Props) {
  const [intel, setIntel] = useState<Intel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/company-intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, industry, location }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setIntel(data);
      setExpanded(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!intel && !loading) {
    return (
      <button
        onClick={load}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-sky-50 to-violet-50 border border-sky-200 rounded-xl text-sm text-sky-700 hover:from-sky-100 hover:to-violet-100 transition-all group"
      >
        <div className="w-7 h-7 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-sky-600" />
        </div>
        <div className="text-left">
          <p className="font-medium text-sky-800">Generate Company Profile</p>
          <p className="text-xs text-sky-600">AI-powered company intelligence</p>
        </div>
        <ExternalLink className="w-4 h-4 ml-auto opacity-50 group-hover:opacity-100" />
      </button>
    );
  }

  if (loading) {
    return (
      <div className="px-4 py-4 bg-gradient-to-r from-sky-50 to-violet-50 border border-sky-200 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-sky-100 flex items-center justify-center">
            <Bot className="w-4 h-4 text-sky-600 animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-medium text-sky-800">Generating profile…</p>
            <p className="text-xs text-sky-500">Researching {companyName}</p>
          </div>
          <div className="ml-auto flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between">
        <p className="text-xs text-red-600">{error}</p>
        <button onClick={load} className="text-xs text-red-700 underline ml-2">Retry</button>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-sky-50 to-violet-50 border border-sky-200 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-sky-100 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-sky-600" />
          </div>
          <span className="text-sm font-semibold text-sky-800">Company Intelligence</span>
          <span className="text-xs text-sky-500 bg-sky-100 px-1.5 py-0.5 rounded-full">AI</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); load(); }}
            className="p-1 rounded hover:bg-sky-200 text-sky-400 hover:text-sky-600 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {expanded ? <ChevronUp className="w-4 h-4 text-sky-400" /> : <ChevronDown className="w-4 h-4 text-sky-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && intel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {/* Bio */}
              <p className="text-sm text-slate-600 leading-relaxed">{intel.bio}</p>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { icon: <Building2 className="w-3 h-3" />, label: "Industry", value: intel.industry },
                  { icon: <MapPin className="w-3 h-3" />, label: "HQ", value: intel.headquarters },
                  { icon: <Calendar className="w-3 h-3" />, label: "Founded", value: intel.founded },
                  { icon: <Users className="w-3 h-3" />, label: "Employees", value: intel.employeeEstimate },
                ].map((item) => (
                  <div key={item.label} className="bg-white/60 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1 text-slate-400 mb-0.5">
                      {item.icon}
                      <span className="text-[10px] uppercase tracking-wide font-medium">{item.label}</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-700 truncate">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* News items */}
              {intel.newsItems?.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Newspaper className="w-3.5 h-3.5 text-slate-400" />
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">News & Updates</p>
                  </div>
                  <div className="space-y-2">
                    {intel.newsItems.map((item, i) => (
                      <a
                        key={i}
                        href={`https://www.google.com/search?q=${encodeURIComponent(item.headline)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block bg-white/70 border border-white rounded-lg p-3 hover:bg-white hover:shadow-sm transition-all group"
                      >
                        <div className="flex items-start justify-between gap-1 mb-1">
                          <p className="text-xs font-semibold text-slate-700 line-clamp-2 flex-1">{item.headline}</p>
                          <ExternalLink className="w-3 h-3 text-slate-300 group-hover:text-sky-500 shrink-0 mt-0.5 transition-colors" />
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2">{item.summary}</p>
                        <p className="text-[10px] text-sky-500 mt-1">{item.date}</p>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
