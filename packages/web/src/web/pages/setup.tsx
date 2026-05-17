import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, ShieldCheck, Eye, EyeOff, CheckCircle2 } from "lucide-react";

export default function Setup() {
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [, setLocation] = useLocation();

  const [name, setName] = useState("Jesse Valentine");
  const [email, setEmail] = useState("jesse.valenitne@usi.com");
  const [airtableId, setAirtableId] = useState("recVyjDX31kYK91GE");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/setup-status")
      .then((r) => r.json())
      .then((d) => {
        setNeedsSetup(d.needsSetup);
        if (!d.needsSetup) setLocation("/sign-in");
      })
      .catch(() => setNeedsSetup(true))
      .finally(() => setChecking(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("Passwords don't match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password, airtableId }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setDone(true);
      setTimeout(() => setLocation("/sign-in"), 2000);
    } catch { setError("Something went wrong."); }
    finally { setLoading(false); }
  };

  if (checking) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
    </div>
  );

  if (!needsSetup) return null;

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-900/20 via-slate-950 to-slate-950" />
      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/usi-logo.png" alt="USI" className="h-10 w-auto object-contain mb-4" />
          <p className="text-slate-400 text-sm mt-1">Create your admin account to get started</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          {done ? (
            <div className="flex flex-col items-center py-6 gap-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
              <p className="font-semibold text-white">Admin account created!</p>
              <p className="text-slate-400 text-sm">Redirecting to sign in…</p>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-white mb-1">Create Admin Account</h2>
              <p className="text-slate-400 text-sm mb-6">This only runs once. You'll use these credentials to log in.</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Full Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Team Member Record ID <span className="text-slate-600">(optional)</span></label>
                  <input type="text" value={airtableId} onChange={(e) => setAirtableId(e.target.value)}
                    placeholder="recXXXXXXXXXXXXXX"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
                  <div className="relative">
                    <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required
                      placeholder="Min. 8 characters"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 pr-10" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Confirm Password</label>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
                    placeholder="••••••••"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500" />
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>
                )}

                <button type="submit" disabled={loading}
                  className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors flex items-center justify-center gap-2 mt-2">
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? "Creating account…" : "Create Admin Account"}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 mt-6 text-slate-600 text-xs">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>This page is only accessible when no admin account exists.</span>
        </div>
      </div>
    </div>
  );
}
