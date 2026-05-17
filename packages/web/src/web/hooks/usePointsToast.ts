import { toast } from "sonner";
import confetti from "canvas-confetti";
import { getGamificationMe } from "@/lib/api";

const BADGE_LABELS: Record<string, string> = {
  first_win:       "First Win",
  getting_started: "Getting Started",
  veteran:         "Veteran",
  legend:          "Legend",
  on_fire:         "On Fire",
};

function playSuccessSound() {
  try {
    const audio = new Audio("/sounds/success.mp3");
    audio.volume = 0.5;
    audio.play().catch(() => {}); // ignore if blocked by browser autoplay policy
  } catch {}
}

function fireBadgeConfetti() {
  playSuccessSound();
  confetti({ particleCount: 80, spread: 60, origin: { x: 0.1, y: 0.6 }, zIndex: 9999 });
  confetti({ particleCount: 80, spread: 60, origin: { x: 0.9, y: 0.6 }, zIndex: 9999 });
  setTimeout(() => {
    confetti({ particleCount: 60, spread: 100, origin: { x: 0.5, y: 0.4 }, zIndex: 9999 });
  }, 250);
}

export async function snapshotPoints(): Promise<{ points: number; badges: string[] }> {
  try {
    const me = await getGamificationMe();
    return { points: me?.totalPoints ?? -1, badges: me?.badges ?? [] };
  } catch {
    return { points: -1, badges: [] };
  }
}

export function checkAndToastPoints(snapshot: { points: number; badges: string[] }) {
  // Poll a few times to catch the backend write
  let attempts = 0;
  const maxAttempts = 5;
  const interval = 1000; // check every 1s for up to 5s

  const poll = async () => {
    attempts++;
    try {
      const me = await getGamificationMe();
      if (!me || me.totalPoints === undefined) {
        if (attempts < maxAttempts) setTimeout(poll, interval);
        return;
      }

      const newBadges = me.badges.filter((b) => !snapshot.badges.includes(b));
      const pointsEarned = snapshot.points >= 0 && me.totalPoints > snapshot.points;

      if (newBadges.length > 0 || pointsEarned) {
        // Fire confetti for badges OR any points gain
        if (newBadges.length > 0) {
          fireBadgeConfetti();
          for (const b of newBadges) {
            toast.success(`🏅 Badge unlocked: ${BADGE_LABELS[b] ?? b}!`, { duration: 6000 });
          }
        } else {
          // Smaller confetti burst for just points
          playSuccessSound();
          confetti({ particleCount: 60, spread: 70, origin: { x: 0.5, y: 0.6 }, zIndex: 9999 });
        }

        if (pointsEarned) {
          const diff = me.totalPoints - snapshot.points;
          const recent = me.recentActivity?.[0];
          const isEarly = recent && recent.bonus_points > 0;
          toast.success(
            isEarly
              ? `🏆 +${diff} pts! (includes early completion bonus)`
              : `🏆 +${diff} pts earned!`,
            { duration: 4000 }
          );
        }
        return; // done
      }

      // No change yet — retry
      if (attempts < maxAttempts) setTimeout(poll, interval);
    } catch (e) {
      console.error("[points] poll error:", e);
      if (attempts < maxAttempts) setTimeout(poll, interval);
    }
  };

  // Start first poll after 1s
  setTimeout(poll, 1000);
}
