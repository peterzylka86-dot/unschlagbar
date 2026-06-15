/**
 * Live match text — the Championship-Manager heartbeat. A played matchday
 * unfolds as a running ticker of timed events (kickoff, goals, cards,
 * injuries, half/full time) instead of a bare scoreline.
 *
 * PURE + DETERMINISTIC (seeded, no Math.random/Date), the same contract as
 * the rest of the sim: the events for a given matchday are fixed, and so are
 * injuries — derived from the played history, NEVER accumulated in the store
 * (which would double-count when a season replays after a refresh).
 *
 * Injuries are the bite: a knock pulls a player out for a few matchdays, so
 * the deeper bench (squad of 18) finally matters.
 */
import type { MatchResult } from "./game-types";

function hash(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
const rand01 = (seed: string) => hash(seed) / 4294967296;

// ─── Injuries (derived, deterministic) ──────────────────────────────────

export const INJURY_RATE = 0.14; // chance a matchday produces an injury
const INJURY_MAX_WEEKS = 4;

/** Does this matchday injure one of the XI? Deterministic in
 *  (seasonSeed, matchday). Returns the unlucky player KEY + weeks out. */
export function matchInjury(
  matchday: number,
  xiKeys: string[],
  seasonSeed: number,
): { key: string; weeks: number } | null {
  if (xiKeys.length === 0) return null;
  if (rand01(`inj-${seasonSeed}-${matchday}`) >= INJURY_RATE) return null;
  const key = xiKeys[hash(`inj-who-${seasonSeed}-${matchday}`) % xiKeys.length];
  const weeks = 1 + (hash(`inj-len-${seasonSeed}-${matchday}`) % INJURY_MAX_WEEKS); // 1-4
  return { key, weeks };
}

/**
 * Who is currently injured going INTO the next matchday, derived purely
 * from the lineups played so far. `lineups[j]` is the XI that started
 * matchday j+1; an injury there sidelines the player for the following
 * `weeks` matchdays. Returns key → matchdays still to sit out.
 */
export function currentInjuries(lineups: string[][], seasonSeed: number): Map<string, number> {
  const out = new Map<string, number>();
  const played = lineups.length;
  for (let j = 0; j < played; j++) {
    const inj = matchInjury(j + 1, lineups[j], seasonSeed);
    if (!inj) continue;
    const lastOutMatchday = j + 1 + inj.weeks; // out through here
    const remaining = lastOutMatchday - played; // as of the next (played+1) matchday
    if (remaining > 0) out.set(inj.key, Math.max(out.get(inj.key) ?? 0, remaining));
  }
  return out;
}

// ─── Live event ticker ──────────────────────────────────────────────────

export type LiveEventType =
  | "ko"
  | "goal-us"
  | "goal-them"
  | "yellow"
  | "red"
  | "injury"
  | "ht"
  | "ft";

export interface LiveEvent {
  minute: number;
  type: LiveEventType;
  text: string;
}

const GOAL_US = [
  "GOAL! {p} buries it. Get in!",
  "{p} finishes coolly — what a strike!",
  "It's there! {p} with the goal.",
  "{p} pounces — the net bulges.",
];
const GOAL_THEM = [
  "{opp} score. Heads up.",
  "Against the run of play — {opp} level the tone.",
  "{opp} find a way through.",
  "Sucker-punch from {opp}.",
];
const YELLOW = ["Late challenge — yellow card.", "Into the book he goes.", "Cynical foul. Booked."];

/**
 * Build the minute-by-minute event list for a played match. Goal minutes
 * are spread deterministically; our scorers come from the sim, theirs are
 * anonymous. A booking or two, and the matchday's injury (if any) narrated
 * at its moment. Sorted by minute, framed by KO/HT/FT.
 */
export function buildLiveEvents(opts: {
  match: Pick<MatchResult, "matchday" | "ourScore" | "theirScore">;
  oppName: string;
  ourScorers: string[]; // names, length === ourScore
  xiKeys: string[];
  keyToName: (key: string) => string;
  seasonSeed: number;
}): LiveEvent[] {
  const { match, oppName, ourScorers, xiKeys, keyToName, seasonSeed } = opts;
  const seed = `${seasonSeed}-${match.matchday}`;
  const ev: LiveEvent[] = [{ minute: 0, type: "ko", text: "Kick-off." }];

  const minuteFor = (tag: string, i: number) =>
    1 + (hash(`min-${seed}-${tag}-${i}`) % 89); // 1..89

  for (let i = 0; i < match.ourScore; i++) {
    const scorer = ourScorers[i] ?? "Someone";
    const line = GOAL_US[hash(`gu-${seed}-${i}`) % GOAL_US.length].replace(/\{p\}/g, scorer);
    ev.push({ minute: minuteFor("gu", i), type: "goal-us", text: `${line}` });
  }
  for (let i = 0; i < match.theirScore; i++) {
    const line = GOAL_THEM[hash(`gt-${seed}-${i}`) % GOAL_THEM.length].replace(/\{opp\}/g, oppName);
    ev.push({ minute: minuteFor("gt", i), type: "goal-them", text: line });
  }

  // 0-2 bookings (mostly informational colour).
  const cards = hash(`cards-${seed}`) % 3;
  for (let i = 0; i < cards; i++) {
    ev.push({ minute: minuteFor("yc", i), type: "yellow", text: YELLOW[hash(`yc-${seed}-${i}`) % YELLOW.length] });
  }

  const inj = matchInjury(match.matchday, xiKeys, seasonSeed);
  if (inj) {
    const name = keyToName(inj.key);
    ev.push({
      minute: 20 + (hash(`injmin-${seed}`) % 65),
      type: "injury",
      text: `${name} goes down injured and can't continue — out ${inj.weeks} match${inj.weeks === 1 ? "" : "es"}.`,
    });
  }

  ev.sort((a, b) => a.minute - b.minute);
  ev.push({ minute: 45, type: "ht", text: "Half time." });
  ev.push({ minute: 90, type: "ft", text: "Full time." });
  // Keep HT in the right place (between ≤45 and >45) after the FT/HT push.
  ev.sort((a, b) => a.minute - b.minute || (a.type === "ht" ? -1 : 0));
  return ev;
}
