/**
 * Dynasty Objectives — career-spanning goals for GOLAZO Career mode.
 *
 * Game-design rationale: the career loop was flat — season 4 felt
 * identical to season 1, with nothing to build TOWARD. Objectives give
 * the multi-season grind a destination ("win 3 in a row", "complete a
 * decade") without touching the sim.
 *
 * Architecture: objectives are PURE DERIVED DATA from seasonHistory.
 * No new store state, no schema migration, no save-game risk. Each
 * objective is a check function over the season records; progress and
 * unlocked-ness are recomputed on render. Cheap (n ≤ ~20 seasons).
 */
import type { SeasonRecord } from "./career-store";

export interface DynastyObjective {
  id: string;
  icon: string;
  title: string;
  /** Short imperative description shown under the title. */
  description: string;
  /** 0..1 progress toward the objective (1 = unlocked). */
  progress: (history: SeasonRecord[]) => number;
}

/** Longest streak of consecutive seasons satisfying `pred`. */
function longestStreak(history: SeasonRecord[], pred: (r: SeasonRecord) => boolean): number {
  let best = 0;
  let cur = 0;
  // History is appended chronologically; trust the array order.
  for (const r of history) {
    if (pred(r)) {
      cur += 1;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  }
  return best;
}

export const DYNASTY_OBJECTIVES: DynastyObjective[] = [
  {
    id: "first-silverware",
    icon: "🏆",
    title: "First Silverware",
    description: "Win the league or the cup",
    progress: (h) =>
      h.some((r) => r.finalPosition === 1 || r.cupResult === "champion") ? 1 : 0,
  },
  {
    id: "the-double",
    icon: "👑",
    title: "The Double",
    description: "Win league AND cup in the same season",
    progress: (h) =>
      h.some((r) => r.finalPosition === 1 && r.cupResult === "champion") ? 1 : 0,
  },
  {
    id: "invincible-season",
    icon: "★",
    title: "Invincible Season",
    description: "Complete a season without losing a match",
    progress: (h) => (h.some((r) => r.losses === 0 && r.wins > 0) ? 1 : 0),
  },
  {
    id: "back-to-back",
    icon: "🔁",
    title: "Back-to-Back",
    description: "Win the league two seasons in a row",
    progress: (h) => {
      const streak = longestStreak(h, (r) => r.finalPosition === 1);
      return Math.min(1, streak / 2);
    },
  },
  {
    id: "dynasty",
    icon: "🏛️",
    title: "Dynasty",
    description: "Win the league three seasons in a row",
    progress: (h) => {
      const streak = longestStreak(h, (r) => r.finalPosition === 1);
      return Math.min(1, streak / 3);
    },
  },
  {
    id: "survivor",
    icon: "🛡️",
    title: "Survivor",
    description: "Five seasons without relegation",
    progress: (h) => {
      const streak = longestStreak(h, (r) => !r.relegated);
      return Math.min(1, streak / 5);
    },
  },
  {
    id: "centurion",
    icon: "💯",
    title: "Centurion",
    description: "Score 100 career goals",
    progress: (h) => {
      const goals = h.reduce((sum, r) => sum + r.goalsFor, 0);
      return Math.min(1, goals / 100);
    },
  },
  {
    id: "the-decade",
    icon: "📅",
    title: "The Decade",
    description: "Complete ten seasons",
    progress: (h) => Math.min(1, h.length / 10),
  },
];

export interface ObjectiveStatus {
  objective: DynastyObjective;
  progress: number; // 0..1
  unlocked: boolean;
}

/** Compute the status of every objective against a career's history. */
export function dynastyStatus(history: SeasonRecord[]): ObjectiveStatus[] {
  return DYNASTY_OBJECTIVES.map((o) => {
    const p = Math.max(0, Math.min(1, o.progress(history)));
    return { objective: o, progress: p, unlocked: p >= 1 };
  });
}

/** Objectives that JUST unlocked with the latest season — used by the
 *  recap screen to celebrate fresh achievements. Computes status with
 *  and without the final history entry and diffs. */
export function newlyUnlocked(history: SeasonRecord[]): ObjectiveStatus[] {
  if (history.length === 0) return [];
  const before = new Set(
    dynastyStatus(history.slice(0, -1))
      .filter((s) => s.unlocked)
      .map((s) => s.objective.id),
  );
  return dynastyStatus(history).filter((s) => s.unlocked && !before.has(s.objective.id));
}
