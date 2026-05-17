import { Menu, Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import { SearchTrigger } from "@/components/global-search";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/clients": "Clients",
  "/deliverables": "Deliverables",
  "/compliance": "Compliance",
  "/open-items": "Open Items",
  "/calendar": "Compliance Calendar",
  "/team": "Team Members",
  "/omni": "OMNI Solutions",
  "/analytics": "Analytics",
  "/leaderboard": "Leaderboard",
  "/notifications": "Notification Settings",
  "/admin/users": "Admin — Users",
  "/change-password": "Change Password",
};

function getTitle(location: string) {
  if (location.startsWith("/clients/")) return "Client Detail";
  return PAGE_TITLES[location] ?? "Dashboard";
}

interface Props {
  onMenuClick: () => void;
  onQuickUpdate: () => void;
}

export function Topbar({ onMenuClick, onQuickUpdate }: Props) {
  const [location] = useLocation();

  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 z-30 h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3">
      <button
        onClick={onMenuClick}
        className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex items-center gap-2 min-w-0 flex-1">
        <img src="/usi-logo.png" alt="USI" className="h-6 w-auto object-contain shrink-0" />
        <span className="font-semibold text-slate-800 text-sm truncate">{getTitle(location)}</span>
      </div>

      <SearchTrigger />

      <button
        onClick={onQuickUpdate}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-600 text-xs font-medium"
      >
        <Sparkles className="w-3.5 h-3.5" />
        AI
      </button>
    </header>
  );
}
