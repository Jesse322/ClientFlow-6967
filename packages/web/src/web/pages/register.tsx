import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { useLocation, Link } from "wouter";
import { Eye, EyeOff, Loader2, CheckCircle2, ArrowLeft } from "lucide-react";

/**
 * Register page — works in two modes:
 * 1. No admin exists yet → registers as admin
 * 2. Admin exists → registers as a team member (for invited users)
 */
export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [isFirstAdmin, setIsFirstAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const { refetch } = useSession();
  const [, setLocation] = useLocation();

  useEffect(() => {
    // Check if this is a first-run setup (no admin yet)
    fetch("/api/setup-status")
      .then((r) => r.json())
      .then((d) => setIsFirstAdmin(d.needsSetup === true))
      .catch(() => setIsFirstAdmin(false))
      .finally(() => setChecking(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("Passwords don't match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);

    try {
      if (isFirstAdmin) {
        // First admin — use the setup endpoint
        const res = await fetch("/api/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name, password }),
        });
        const data = await res.json();
        if (data.error) { setError(data.error); setLoading(false); return; }
      } else {
        // Team member self-registration
        const result = await authClient.signUp.email({ email, name, password });
        if (result.error) { setError(result.error.message || "Registration failed."); setLoading(false); return; }
      }

      setDone(true);

      // Auto sign-in after a brief pause
      setTimeout(async () => {
        try {
          await authClient.signIn.email({ email, password });
          await refetch();
          setLocation("/");
        } catch {
          setLocation("/sign-in");
        }
      }, 1500);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-900/20 via-slate-950 to-slate-950" />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src="/usi-logo.png" alt="USI" className="h-10 w-auto object-contain mb-4" />
          <p className="text-slate-400 text-sm mt-1">
            {isFirstAdmin ? "Admin Setup" : "Create Account"}
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          {done ? (
            <div className="flex flex-col items-center py-6 gap-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
              <p className="font-semibold text-white">Account created!</p>
              <p className="text-slate-400 text-sm">Signing you in…</p>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-white mb-1">
                {isFirstAdmin ? "Set up your admin account" : "Create your account"}
              </h2>
              <p className="text-slate-400 text-sm mb-6">
                {isFirstAdmin
                  ? "This creates the first admin account for this dashboard."
                  : "Enter your details to get access to the dashboard."}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your full name"
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@usi.com"
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      required
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors flex items-center justify-center gap-2 mt-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? "Creating account…" : "Create Account"}
                </button>
              </form>

              <div className="mt-5 pt-5 border-t border-slate-800 text-center">
                <Link href="/sign-in">
                  <a className="text-slate-400 text-sm hover:text-slate-300 flex items-center justify-center gap-1.5">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                  </a>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
