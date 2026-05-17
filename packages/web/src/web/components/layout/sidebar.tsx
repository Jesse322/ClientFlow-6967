import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { SearchTrigger } from "@/components/global-search";
import { useOffice, OFFICES, type Office } from "@/lib/office-context";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  LayoutDashboard,
  Users,
  CheckSquare,
  AlertCircle,
  CalendarDays,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  UserCheck,
  Layers,
  X,
  Share2,
  LogOut,
  KeyRound,
  ShieldCheck,
  Bell,
  Trophy,
  BarChart2,
  Scale,
  UserCircle,
  Sun,
  Moon,
  Building2,
} from "lucide-react";

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/clients", icon: Users, label: "Clients" },
  { href: "/deliverables", icon: CheckSquare, label: "Deliverables" },
  { href: "/compliance", icon: Scale, label: "Compliance" },
  { href: "/open-items", icon: AlertCircle, label: "Open Items" },
  { href: "/calendar", icon: CalendarDays, label: "Compliance Calendar" },
  { href: "/omni", icon: Layers, label: "OMNI Solutions" },
  { href: "/leaderboard", icon: Trophy, label: "Leaderboard" },
  { href: "/notifications", icon: Bell, label: "Notifications" },
];

const adminNavItems = [
  { href: "/team", icon: UserCheck, label: "Team Members" },
  { href: "/analytics", icon: BarChart2, label: "Analytics" },
  { href: "/admin/users", icon: ShieldCheck, label: "User Management" },
];

interface Props {
  onQuickUpdate: () => void;
  onShareAccess?: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  isAdmin?: boolean;
  userName?: string;
  onSignOut?: () => void;
}

function NavContent({
  collapsed,
  onQuickUpdate,
  onShareAccess,
  onToggleCollapse,
  onLinkClick,
  isAdmin,
  userName,
  onSignOut,
}: {
  collapsed: boolean;
  onQuickUpdate: () => void;
  onShareAccess?: () => void;
  onToggleCollapse: () => void;
  onLinkClick?: () => void;
  isAdmin?: boolean;
  userName?: string;
  onSignOut?: () => void;
}) {
  const [location] = useLocation();
  const { resolvedTheme, setTheme } = useTheme();
  const toggleTheme = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");
  const { selectedOffice, setSelectedOffice, accessibleOffices } = useOffice();

  const allNavItems = isAdmin
    ? [...navItems, ...adminNavItems]
    : navItems;

  return (
    <div className="flex flex-col h-full">
      {/* Logo row */}
      <div className={cn("flex items-center border-b border-slate-800 shrink-0", collapsed ? "px-3 py-4 justify-center" : "px-4 py-4 gap-2.5 justify-between")}>
        <div className="flex items-center gap-2.5 min-w-0">
          {collapsed ? (
            <div className="w-7 h-7 rounded-md bg-sky-600 flex items-center justify-center shrink-0">
              <img src="/usi-logo.png" alt="USI" className="w-5 h-5 object-contain" />
            </div>
          ) : (
            <img src="/usi-logo.png" alt="USI" className="h-7 w-auto object-contain shrink-0" />
          )}
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-slate-400 text-[10px] leading-tight">Client Benefits Dashboard</p>
            </div>
          )}
        </div>
        {!collapsed && (
          <button onClick={onToggleCollapse} className="hidden lg:flex p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors shrink-0" title="Collapse">
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>

      {collapsed && (
        <button onClick={onToggleCollapse} className="hidden lg:flex mx-auto mt-3 p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors" title="Expand">
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      )}

      {/* Office selector */}
      {collapsed ? (
        <div className="flex justify-center mt-2 px-2">
          <button
            title={`Office: ${selectedOffice}`}
            className="p-1.5 rounded hover:bg-slate-800 text-sky-400 transition-colors"
            onClick={() => {
              // cycle to next accessible office on click when collapsed
              const idx = accessibleOffices.indexOf(selectedOffice);
              const next = accessibleOffices[(idx + 1) % accessibleOffices.length];
              setSelectedOffice(next);
            }}
          >
            <Building2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="px-3 pt-3 pb-0">
          <Select value={selectedOffice} onValueChange={(v) => setSelectedOffice(v as Office)}>
            <SelectTrigger className="h-8 text-xs bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 focus:ring-0 focus:ring-offset-0">
              <Building2 className="w-3 h-3 mr-1.5 text-sky-400 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700">
              {OFFICES.map((o) => {
                const accessible = accessibleOffices.includes(o);
                return (
                  <SelectItem
                    key={o}
                    value={o}
                    disabled={!accessible}
                    className={cn(
                      "text-xs",
                      accessible ? "text-slate-200" : "text-slate-600 cursor-not-allowed"
                    )}
                  >
                    {o}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Search — desktop only, hidden when collapsed */}
      {!collapsed && (
        <div className="px-3 pt-2 pb-1">
          <SearchTrigger />
        </div>
      )}

      {/* Nav */}
      <nav className={cn("flex-1 py-4 space-y-0.5 overflow-y-auto", collapsed ? "px-2" : "px-3")}>
        {allNavItems.map(({ href, icon: Icon, label }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link key={href} href={href}>
              <a onClick={onLinkClick} title={collapsed ? label : undefined}
                className={cn("flex items-center rounded-lg text-sm font-medium transition-colors group",
                  collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5",
                  active ? "bg-sky-500/15 text-sky-400" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                )}>
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="flex-1">{label}</span>}
                {!collapsed && active && <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
              </a>
            </Link>
          );
        })}
      </nav>

      {/* Quick Update + Share Access */}
      <div className={cn("pb-3 shrink-0 space-y-1.5", collapsed ? "px-2" : "px-3")}>
        <button onClick={() => { onQuickUpdate(); onLinkClick?.(); }} title={collapsed ? "Quick Update (AI)" : undefined}
          className={cn("w-full flex items-center rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 hover:border-sky-500/40 text-sky-400 font-medium transition-all",
            collapsed ? "justify-center p-2.5" : "gap-2.5 px-3 py-2.5 text-sm"
          )}>
          <Sparkles className="w-4 h-4 shrink-0" />
          {!collapsed && <><span>Quick Update</span><span className="ml-auto text-[10px] bg-sky-500/20 px-1.5 py-0.5 rounded text-sky-300">AI</span></>}
        </button>
        {isAdmin && onShareAccess && (
          <button onClick={() => { onShareAccess(); onLinkClick?.(); }} title={collapsed ? "Share Access" : undefined}
            className={cn("w-full flex items-center rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white font-medium transition-all",
              collapsed ? "justify-center p-2.5" : "gap-2.5 px-3 py-2.5 text-sm"
            )}>
            <Share2 className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Share Access</span>}
          </button>
        )}
      </div>

      {/* User + sign out */}
      <div className={cn("border-t border-slate-800 shrink-0", collapsed ? "px-2 py-3" : "px-4 py-3")}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <Link href="/profile">
              <a onClick={onLinkClick} title="My Profile" className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors">
                <UserCircle className="w-4 h-4" />
              </a>
            </Link>
            <Link href="/change-password">
              <a onClick={onLinkClick} title="Change password" className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors">
                <KeyRound className="w-4 h-4" />
              </a>
            </Link>
            <button onClick={toggleTheme} title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"} className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors">
              {resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={onSignOut} title="Sign out" className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-red-400 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="min-w-0">
                {userName && <p className="text-slate-300 text-xs font-medium truncate">{userName}</p>}
                <p className="text-slate-600 text-[10px]">{isAdmin ? "Admin" : "Team Member"}</p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={toggleTheme} title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"} className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors">
                  {resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
                <button onClick={onSignOut} title="Sign out" className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-red-400 transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/profile">
                <a onClick={onLinkClick} className="flex items-center gap-1.5 text-[10px] text-slate-600 hover:text-slate-400 transition-colors">
                  <UserCircle className="w-3 h-3" /> My Profile
                </a>
              </Link>
              <Link href="/change-password">
                <a onClick={onLinkClick} className="flex items-center gap-1.5 text-[10px] text-slate-600 hover:text-slate-400 transition-colors">
                  <KeyRound className="w-3 h-3" /> Change password
                </a>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Sidebar({ onQuickUpdate, onShareAccess, collapsed, onToggleCollapse, mobileOpen, onMobileClose, isAdmin, userName, onSignOut }: Props) {
  return (
    <>
      <motion.aside
        animate={{ width: collapsed ? 56 : 224 }}
        transition={{ type: "spring", stiffness: 400, damping: 40 }}
        className="hidden lg:flex fixed left-0 top-0 h-screen bg-slate-950 flex-col z-40 overflow-hidden"
        style={{ minWidth: collapsed ? 56 : 224 }}
      >
        <NavContent collapsed={collapsed} onQuickUpdate={onQuickUpdate} onShareAccess={onShareAccess}
          onToggleCollapse={onToggleCollapse} isAdmin={isAdmin} userName={userName} onSignOut={onSignOut} />
      </motion.aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onMobileClose} />
            <motion.aside initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 40 }}
              className="fixed left-0 top-0 h-screen w-64 bg-slate-950 flex flex-col z-50 lg:hidden">
              <button onClick={onMobileClose} className="absolute top-3 right-3 p-1.5 rounded hover:bg-slate-800 text-slate-400">
                <X className="w-4 h-4" />
              </button>
              <NavContent collapsed={false} onQuickUpdate={onQuickUpdate} onShareAccess={onShareAccess}
                onToggleCollapse={onToggleCollapse} onLinkClick={onMobileClose}
                isAdmin={isAdmin} userName={userName} onSignOut={onSignOut} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
