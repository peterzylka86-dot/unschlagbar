/**
 * Daily Challenge — same seed for everyone, every day.
 *
 * Why UTC: a player in Tokyo and Berlin both need to play "the same June 8"
 * or H2H comparisons become nonsense. Local-time would mean two players
 * play different boards while both calling it "today".
 *
 * Why a date-derived integer (not a hash): the season simulator already
 * takes a numeric seed. Reusing the seed channel means zero changes to
 * the sim — Daily is just "Quick Match with a pre-decided seed".
 *
 * Why localStorage and not a backend: zero infra cost, zero abuse surface
 * (CLAUDE.md L-1). Tradeoff: streaks don't survive a browser-clear or a
 * device switch — acceptable for v1, revisit if Daily earns its place.
 */

const LS_KEY = "unschlagbar:daily:v1";

/** YYYYMMDD integer derived from the UTC date — e.g. 2026-06-08 → 20260608.
 *  Pinned to UTC so timezone has no effect on which seed you get. */
export function dailySeed(date: Date = new Date()): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return y * 10000 + m * 100 + d;
}

/** "YYYY-MM-DD" label for the UI ("Daily Challenge · 2026-06-08"). */
export function dailyDateLabel(seed: number): string {
  const y = Math.floor(seed / 10000);
  const m = Math.floor((seed % 10000) / 100);
  const d = seed % 100;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** True if `seed` corresponds to today's UTC date. */
export function isToday(seed: number, now: Date = new Date()): boolean {
  return seed === dailySeed(now);
}

export interface DailyResult {
  /** dailySeed for the day played (also the sim seed). */
  seed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Top scorer for the day — optional so older saved records don't break. */
  topScorer?: { name: string; goals: number };
  /** ISO timestamp of when the run finished. */
  playedAt: string;
  /** League id at time of save. We lock UCL for v1 but persist this so a
   *  future "rotating Daily" can read past plays correctly. */
  league?: string;
}

interface DailyStore {
  /** Map of seed → DailyResult. First play wins (no overwrites) to match
   *  Wordle's "no take-backs" norm. */
  results: Record<number, DailyResult>;
}

// In-memory fallback for SSR and the test env (no jsdom). Keeps the API
// identical regardless of where it runs — tests can exercise the full
// save/read/streak cycle without a DOM.
const memoryStore: DailyStore = { results: {} };

function hasLocalStorage(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as { localStorage?: Storage }).localStorage !== "undefined";
}

function readStore(): DailyStore {
  if (!hasLocalStorage()) return memoryStore;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { results: {} };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.results) {
      return parsed as DailyStore;
    }
    return { results: {} };
  } catch {
    return { results: {} };
  }
}

function writeStore(store: DailyStore): void {
  if (!hasLocalStorage()) {
    // Mirror into memory so subsequent readStore() sees the write.
    memoryStore.results = { ...store.results };
    return;
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    // Quota or privacy mode — silent fail; daily UX just won't remember.
  }
}

/** Save a daily result. First play for a given seed wins — subsequent
 *  attempts on the same day are ignored (returns false). */
export function saveDaily(r: DailyResult): boolean {
  const store = readStore();
  if (store.results[r.seed]) return false;
  store.results[r.seed] = r;
  writeStore(store);
  return true;
}

/** Read the result for a specific day. Null if not played. */
export function getDaily(seed: number): DailyResult | null {
  const store = readStore();
  return store.results[seed] ?? null;
}

/** All saved daily results, newest first. */
export function getAllDailyResults(): DailyResult[] {
  const store = readStore();
  return Object.values(store.results).sort((a, b) => b.seed - a.seed);
}

/** Consecutive-days streak ending today (or yesterday — see below).
 *
 *  Counts back from today: if today is played, count today + all consecutive
 *  prior days. If today is NOT played but yesterday was, the streak is still
 *  alive (user hasn't lost it yet) — count from yesterday.
 *
 *  Returns 0 if neither today nor yesterday was played.
 */
export function getDailyStreak(now: Date = new Date()): number {
  const store = readStore();
  const todaySeed = dailySeed(now);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ySeed = dailySeed(yesterday);

  // Pick the anchor: today if played, else yesterday if played, else 0.
  let anchor: Date;
  if (store.results[todaySeed]) {
    anchor = now;
  } else if (store.results[ySeed]) {
    anchor = yesterday;
  } else {
    return 0;
  }

  let streak = 0;
  let cursor = anchor;
  while (true) {
    const s = dailySeed(cursor);
    if (!store.results[s]) break;
    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return streak;
}

/** Test helper — wipes the daily store. NOT exported from the index. */
export function __clearDailyStore(): void {
  memoryStore.results = {};
  if (hasLocalStorage()) localStorage.removeItem(LS_KEY);
}
