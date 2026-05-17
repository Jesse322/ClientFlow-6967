import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { getGamificationMe, getLeaderboard, clearAllPoints, clearUserPoints, type GamificationMe, type LeaderboardEntry } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Trophy, Medal, Star, Flame, Zap, Award, Trash2, RotateCcw } from "lucide-react";

// ─── Badge metadata ──────────────────────────────────────────────────────────
const BADGE_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  first_win:       { label: "First Win",      icon: Star,   color: "text-amber-700",  bg: "bg-amber-100 border-amber-300" },
  getting_started: { label: "Getting Started", icon: Zap,    color: "text-sky-700",    bg: "bg-sky-100 border-sky-300" },
  veteran:         { label: "Veteran",         icon: Medal,  color: "text-violet-700", bg: "bg-violet-100 border-violet-300" },
  legend:          { label: "Legend",          icon: Trophy, color: "text-orange-700", bg: "bg-orange-100 border-orange-300" },
  on_fire:         { label: "On Fire",         icon: Flame,  color: "text-red-700",    bg: "bg-red-100 border-red-300" },
};

function BadgeChip({ badgeKey }: { badgeKey: string }) {
  const meta = BADGE_META[badgeKey];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border", meta.bg, meta.color)}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function RankMedal({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg">🥇</span>;
  if (rank === 2) return <span className="text-lg">🥈</span>;
  if (rank === 3) return <span className="text-lg">🥉</span>;
  return <span className="w-7 text-center text-sm font-semibold text-slate-400">#{rank}</span>;
}

function Avatar({ name, url, size = "md" }: { name: string; url?: string; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "w-12 h-12 text-base" : size === "md" ? "w-9 h-9 text-sm" : "w-7 h-7 text-xs";
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  if (url) return <img src={url} alt={name} className={cn("rounded-full object-cover shrink-0", sizeClass)} />;
  return (
    <div className={cn("rounded-full bg-sky-100 text-sky-700 font-semibold flex items-center justify-center shrink-0 border border-sky-200", sizeClass)}>
      {initials}
    </div>
  );
}

// ─── My Stats Card ────────────────────────────────────────────────────────────
function MyStatsCard({ me }: { me: GamificationMe }) {
  const actionLabels: Record<string, string> = {
    deliverable_completed: "Deliverable Completed",
    open_item_completed: "Open Item Completed",
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Award className="w-4 h-4 text-sky-500" /> My Stats
        </h2>
        <span className="text-xs text-slate-400 font-medium">Rank #{me.rank}</span>
      </div>

      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-slate-900">{me.totalPoints.toLocaleString()}</span>
        <span className="text-sm text-slate-400 mb-1">pts</span>
      </div>

      {me.badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {me.badges.map((b) => <BadgeChip key={b} badgeKey={b} />)}
        </div>
      )}

      {me.recentActivity.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">Recent Activity</p>
          <div className="space-y-1.5">
            {me.recentActivity.slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-slate-600">{actionLabels[a.action] ?? a.action}</span>
                <span className="font-semibold text-sky-600">
                  +{a.total_points} pts
                  {a.bonus_points > 0 && <span className="text-green-600 ml-1">(+{a.bonus_points} early!)</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Podium ───────────────────────────────────────────────────────────────────
function Podium({ top3 }: { top3: LeaderboardEntry[] }) {
  const order = [top3[1], top3[0], top3[2]].filter(Boolean);
  const heights = ["h-20", "h-28", "h-16"];
  const labels = ["2nd", "1st", "3rd"];
  const podiumColors = [
    "bg-slate-100 border-slate-300 text-slate-600",
    "bg-amber-50 border-amber-300 text-amber-700",
    "bg-orange-50 border-orange-200 text-orange-600",
  ];

  return (
    <div className="flex items-end justify-center gap-3 py-4 bg-slate-50 rounded-lg mx-4 mt-2">
      {order.map((entry, i) => (
        <div key={entry.airtableId} className="flex flex-col items-center gap-2">
          <Avatar name={entry.name} url={entry.avatarUrl} size="lg" />
          <span className="text-xs font-semibold text-slate-700 text-center max-w-[70px] truncate">{entry.name}</span>
          <span className="text-xs font-bold text-sky-600">{entry.totalPoints.toLocaleString()} pts</span>
          <div className={cn("w-16 rounded-t-md flex items-end justify-center pb-2 text-xs font-bold border", heights[i], podiumColors[i])}>
            {labels[i]}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Full leaderboard table ────────────────────────────────────────────────────
function LeaderboardTable({
  entries, myAirtableId, isAdmin, onClearUser,
}: {
  entries: LeaderboardEntry[];
  myAirtableId?: string;
  isAdmin?: boolean;
  onClearUser?: (entry: LeaderboardEntry) => void;
}) {
  return (
    <div className="divide-y divide-slate-100">
      {entries.map((entry) => {
        const isMe = entry.airtableId === myAirtableId;
        return (
          <div
            key={entry.airtableId}
            className={cn(
              "flex items-center gap-3 px-4 py-3 transition-colors group",
              isMe ? "bg-sky-50" : "hover:bg-slate-50"
            )}
          >
            <div className="w-8 flex justify-center shrink-0">
              <RankMedal rank={entry.rank} />
            </div>
            <Avatar name={entry.name} url={entry.avatarUrl} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={cn("text-sm font-semibold truncate", isMe ? "text-sky-700" : "text-slate-800")}>
                  {entry.name}
                  {isMe && <span className="ml-1.5 text-[10px] text-sky-500 font-normal">(you)</span>}
                </span>
              </div>
              {entry.badges.length > 0 && (
                <div className="flex gap-1 mt-0.5 flex-wrap">
                  {entry.badges.map((b) => <BadgeChip key={b} badgeKey={b} />)}
                </div>
              )}
            </div>
            <span className="text-sm font-bold text-slate-900 shrink-0">{entry.totalPoints.toLocaleString()}</span>
            <span className="text-xs text-slate-400 shrink-0">pts</span>
            {isAdmin && onClearUser && (
              <button
                onClick={() => onClearUser(entry)}
                className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50"
                title={`Clear ${entry.name}'s points`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  const { session, isAdmin } = useSession();
  const [me, setMe] = useState<GamificationMe | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState<string | null>(null); // "all" | airtableId
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmClearUser, setConfirmClearUser] = useState<LeaderboardEntry | null>(null);

  const myAirtableId = (session?.user as any)?.airtableId;

  const load = () => {
    Promise.all([
      getGamificationMe().catch(() => null),
      getLeaderboard().catch(() => []),
    ]).then(([meData, boardData]) => {
      setMe(meData);
      setBoard(Array.isArray(boardData) ? boardData : []);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const handleClearAll = async () => {
    setClearing("all");
    try {
      await clearAllPoints();
      toast.success("Leaderboard cleared");
      setBoard([]);
      setMe(null);
    } catch { toast.error("Failed to clear"); }
    finally { setClearing(null); setConfirmClearAll(false); }
  };

  const handleClearUser = async (entry: LeaderboardEntry) => {
    setClearing(entry.airtableId);
    try {
      await clearUserPoints(entry.airtableId);
      toast.success(`Cleared points for ${entry.name}`);
      load();
    } catch { toast.error("Failed to clear"); }
    finally { setClearing(null); setConfirmClearUser(null); }
  };

  const top3 = board.slice(0, 3);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      {/* Confirm clear all */}
      {confirmClearAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="text-base font-semibold text-slate-800">Clear entire leaderboard?</h3>
            <p className="text-sm text-slate-500">This deletes all points and badges for everyone. Cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmClearAll(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={handleClearAll} disabled={clearing === "all"} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50">
                {clearing === "all" ? "Clearing…" : "Clear All"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm clear user */}
      {confirmClearUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="text-base font-semibold text-slate-800">Clear {confirmClearUser.name}'s points?</h3>
            <p className="text-sm text-slate-500">Removes all their points and badges. Cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmClearUser(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={() => handleClearUser(confirmClearUser)} disabled={!!clearing} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50">
                {clearing === confirmClearUser.airtableId ? "Clearing…" : "Clear"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Leaderboard"
          description="Points earned by completing open items and deliverables"
        />
        {isAdmin && (
          <button
            onClick={() => setConfirmClearAll(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors shrink-0 mt-1"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Leaderboard
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm pl-1">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: My stats + guide */}
          <div className="space-y-4">
            {me && me.totalPoints !== undefined ? (
              <MyStatsCard me={me} />
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <p className="text-xs text-slate-400 text-center">Complete open items and deliverables to earn points!</p>
              </div>
            )}

            {/* Point guide */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">How to Earn Points</p>
              <div className="space-y-1.5 text-xs text-slate-700">
                <div className="flex justify-between"><span>Complete an open item</span><span className="text-sky-600 font-bold">+10 pts</span></div>
                <div className="flex justify-between"><span>Complete a deliverable</span><span className="text-sky-600 font-bold">+25 pts</span></div>
                <div className="flex justify-between"><span>Early completion bonus</span><span className="text-green-600 font-bold">+50%</span></div>
              </div>
              <div className="border-t border-slate-100 pt-3 mt-2 space-y-2 text-xs text-slate-700">
                <p className="text-slate-500 font-semibold uppercase tracking-wide text-[10px]">Badges</p>
                <div className="flex justify-between items-center"><span>1st completion</span><BadgeChip badgeKey="first_win" /></div>
                <div className="flex justify-between items-center"><span>10 completions</span><BadgeChip badgeKey="getting_started" /></div>
                <div className="flex justify-between items-center"><span>50 completions</span><BadgeChip badgeKey="veteran" /></div>
                <div className="flex justify-between items-center"><span>100 completions</span><BadgeChip badgeKey="legend" /></div>
              </div>
            </div>
          </div>

          {/* Right: leaderboard */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 pt-4 pb-3 border-b border-slate-100 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-semibold text-slate-700">Rankings</span>
              <span className="ml-auto text-xs text-slate-400">{board.length} members</span>
            </div>

            {top3.length >= 3 && <Podium top3={top3} />}

            {board.length === 0 ? (
              <div className="px-4 py-10 text-center text-slate-400 text-sm">
                No points earned yet. Be the first!
              </div>
            ) : (
              <LeaderboardTable entries={board} myAirtableId={myAirtableId} isAdmin={isAdmin} onClearUser={setConfirmClearUser} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
