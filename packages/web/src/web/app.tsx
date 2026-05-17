import { useState, useEffect, lazy, Suspense } from "react";
import { Route, Switch, useLocation } from "wouter";
import { Provider } from "./components/provider";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";
import { Toaster } from "@/components/ui/sonner";
import { Sidebar } from "./components/layout/sidebar";
import { Topbar } from "./components/layout/topbar";
import { AiChatPanel } from "./components/ai-chat-panel";
import { GlobalSearch } from "./components/global-search";
import { ShareAccessModal } from "./components/share-access-modal";
import { useTeamMembers, useClients } from "./hooks/useData";
import { useSession } from "./lib/session";
import { authClient } from "./lib/auth";
import { OfficeProvider } from "./lib/office-context";

// Eagerly loaded (auth + shell — needed immediately)
import SignIn from "./pages/sign-in";
import Register from "./pages/register";
import ForgotPassword from "./pages/forgot-password";
import ResetPassword from "./pages/reset-password";
import Setup from "./pages/setup";
import Dashboard from "./pages/dashboard";

// Lazy loaded — only fetched when the user navigates to that route
const ClientsPage = lazy(() => import("./pages/clients"));
const ClientDetailPage = lazy(() => import("./pages/client-detail"));
const OnboardingPage = lazy(() => import("./pages/onboarding"));
const DeliverablesPage = lazy(() => import("./pages/deliverables"));
const OpenItemsPage = lazy(() => import("./pages/open-items"));
const CalendarPage = lazy(() => import("./pages/calendar"));
const TeamMembersPage = lazy(() => import("./pages/team-members"));
const TeamMemberDetailPage = lazy(() => import("./pages/team-member-detail"));
const AdminUsersPage = lazy(() => import("./pages/admin-users"));
const ChangePassword = lazy(() => import("./pages/change-password"));
const OmniPage = lazy(() => import("./pages/omni"));
const NotificationSettingsPage = lazy(() => import("./pages/notification-settings"));
const LeaderboardPage = lazy(() => import("./pages/leaderboard"));
const AnalyticsPage = lazy(() => import("./pages/analytics"));
const CompliancePage = lazy(() => import("./pages/compliance"));
const ProfilePage = lazy(() => import("./pages/profile"));

const COLLAPSED_KEY = "sidebar-collapsed";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) setLocation("/sign-in");
  }, [user, loading]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <img src="/usi-logo.png" alt="USI" className="h-8 w-auto object-contain" />
          <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!user) return null;
  return <>{children}</>;
}

function AppShell() {
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { data: teamMembers } = useTeamMembers();
  const clients = useClients();
  const { user, isAdmin, loading: sessionLoading, refetch } = useSession();
  const [, setLocation] = useLocation();

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === "true"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024
  );

  const toggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    const handler = () => {
      const desktop = window.innerWidth >= 1024;
      setIsDesktop(desktop);
      if (desktop) setMobileOpen(false);
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const handleSignOut = async () => {
    await authClient.signOut();
    await refetch();
    setLocation("/sign-in");
  };

  const sidebarWidth = isDesktop ? (collapsed ? 56 : 224) : 0;

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <OfficeProvider clients={clients.data} isAdmin={isAdmin} sessionLoading={sessionLoading} airtableId={user?.airtableId}>

      <Sidebar
        onQuickUpdate={() => setAiChatOpen(true)}
        onShareAccess={isAdmin ? () => setShareOpen(true) : undefined}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        isAdmin={isAdmin}
        userName={user?.name}
        onSignOut={handleSignOut}
      />

      <Topbar
        onMenuClick={() => setMobileOpen(true)}
        onQuickUpdate={() => setAiChatOpen(true)}
      />
      <main
        className="min-h-screen pt-14 lg:pt-0 transition-[margin-left] duration-200"
        style={{ marginLeft: sidebarWidth }}
      >
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <Suspense fallback={
              <div className="flex items-center justify-center py-24">
                <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
              </div>
            }>
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/clients" component={ClientsPage} />
                <Route path="/clients/:id/onboard" component={OnboardingPage} />
                <Route path="/clients/:id" component={ClientDetailPage} />
                <Route path="/deliverables" component={DeliverablesPage} />
                <Route path="/compliance" component={CompliancePage} />
                <Route path="/open-items" component={OpenItemsPage} />
                <Route path="/calendar" component={CalendarPage} />
                {isAdmin && <Route path="/team" component={TeamMembersPage} />}
                {isAdmin && <Route path="/team/:id" component={TeamMemberDetailPage} />}
                {isAdmin && <Route path="/admin/users" component={AdminUsersPage} />}
                {isAdmin && <Route path="/analytics" component={AnalyticsPage} />}
                <Route path="/omni" component={OmniPage} />
                <Route path="/notifications" component={NotificationSettingsPage} />
                <Route path="/leaderboard" component={LeaderboardPage} />
                <Route path="/profile" component={ProfilePage} />
                <Route path="/change-password" component={ChangePassword} />
              </Switch>
            </Suspense>
          </div>
        </div>
      </main>

      </OfficeProvider>

      <GlobalSearch />

      <AiChatPanel
        open={aiChatOpen}
        onClose={() => setAiChatOpen(false)}
        onUpdated={() => {}}
      />

      {isAdmin && (
        <ShareAccessModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          teamMembers={teamMembers || []}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <Provider>
      <Switch>
        <Route path="/sign-in" component={SignIn} />
        <Route path="/register" component={Register} />
        <Route path="/setup" component={Setup} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route>
          <AuthGuard>
            <AppShell />
          </AuthGuard>
        </Route>
      </Switch>
      <Toaster position="bottom-right" richColors />
      {import.meta.env.DEV && <AgentFeedback />}
      {import.meta.env.DEV && <RunableBadge />}
    </Provider>
  );
}

export default App;
