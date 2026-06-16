/**
 * Management loop — the Anstoss / Championship-Manager spine that turns the
 * GOLAZO season from "watch results" into "make decisions that bite".
 *
 * Three interlocking pieces, all PURE + DETERMINISTIC (no Math.random, no
 * Date) so they re-derive identically on every render and resume — the same
 * contract as liveForm / fatigue in career.season.tsx:
 *
 *   1. MORALE — a per-player stat (sister to form + fatigue). Driven by
 *      playing time, results, and your team-talk choices. Feeds match
 *      performance, so rotation and man-management carry a real cost.
 *   2. TEAM TALK — a pre-match decision (Calm / Fire up / Park the bus) that
 *      nudges this matchday's odds and shifts squad morale — and can backfire.
 *   3. BOARD CONFIDENCE — a season-long job-security gauge. The board sets an
 *      expectation from your squad strength; results vs. that expectation
 *      move the bar, and a slump triggers a vote of confidence.
 *
 * Because a career's `matches` array is local state rebuilt by clicking
 * (deterministic from the season seed), morale and confidence are DERIVED
 * from the played sequence — never accumulated via store mutations, which
 * would double-count if the season re-plays after a refresh.
 */

// ─── Morale ─────────────────────────────────────────────────────────────

export const MORALE_NEUTRAL = 60;
export const MORALE_MIN = 0;
export const MORALE_MAX = 100;

const clampMorale = (v: number) => Math.max(MORALE_MIN, Math.min(MORALE_MAX, v));

/** Bucket label + emoji for a morale value, for HUD badges. */
export function moraleBadge(v: number): { icon: string; label: string } {
  if (v >= 80) return { icon: "🤩", label: "flying" };
  if (v >= 62) return { icon: "🙂", label: "happy" };
  if (v >= 42) return { icon: "😐", label: "settled" };
  if (v >= 25) return { icon: "😟", label: "unsettled" };
  return { icon: "😡", label: "mutinous" };
}

interface MoraleMatch {
  outcome: "W" | "D" | "L";
  ourScore: number;
  theirScore: number;
}

/**
 * Derive every squad player's morale from the played season so far.
 *
 * Per matchday, in order:
 *   • the team-talk's morale delta lands on whoever started,
 *   • the result lands on the starters (win lifts, loss bites, a hiding bites
 *     harder), benched players drift down (itching to play),
 *   • everyone mean-reverts 6% toward neutral so values never run away.
 *
 * Keys are `${club}:${name}` (playerKey) — the same keys used by the XI
 * lineups, so a starter is matched exactly.
 */
export function deriveMorale(opts: {
  squadKeys: string[];
  matches: MoraleMatch[];
  lineups: string[][];
  talkMoraleDeltas: number[];
  /** Players shopped around in a failed wonderkid bid last window — they
   *  start the season unsettled (a lingering morale hit). */
  unsettledKeys?: string[];
  /** Lingering per-player mood offset (±) from conversations/events. */
  moodOffsets?: Record<string, number>;
}): Record<string, number> {
  const { squadKeys, matches, lineups, talkMoraleDeltas } = opts;
  const unsettled = new Set(opts.unsettledKeys ?? []);
  const moods = opts.moodOffsets ?? {};
  const morale: Record<string, number> = {};
  for (const k of squadKeys)
    morale[k] = clampMorale((unsettled.has(k) ? MORALE_NEUTRAL - 20 : MORALE_NEUTRAL) + (moods[k] ?? 0));

  const n = Math.min(matches.length, lineups.length);
  for (let i = 0; i < n; i++) {
    const m = matches[i];
    const starters = new Set(lineups[i]);
    const talkDelta = talkMoraleDeltas[i] ?? 0;

    const margin = m.ourScore - m.theirScore;
    let resultDelta: number;
    if (m.outcome === "W") resultDelta = margin >= 3 ? 7 : 4;
    else if (m.outcome === "D") resultDelta = 0;
    else resultDelta = -margin >= 3 ? -7 : -4;

    for (const k of squadKeys) {
      let v = morale[k];
      if (starters.has(k)) {
        v += talkDelta + resultDelta;
      } else {
        // Benched: a touch of frustration, softened on a team win.
        v += m.outcome === "W" ? -1 : -2;
      }
      // Mean-reversion toward neutral.
      v += (MORALE_NEUTRAL - v) * 0.06;
      morale[k] = clampMorale(v);
    }
  }
  return morale;
}

/** Average morale across a set of player keys (the XI), for talk context. */
export function averageMorale(morale: Record<string, number>, keys: string[]): number {
  if (keys.length === 0) return MORALE_NEUTRAL;
  const sum = keys.reduce((a, k) => a + (morale[k] ?? MORALE_NEUTRAL), 0);
  return sum / keys.length;
}

/** Small rating kicker (±2) from squad morale — high morale plays above
 *  itself, a mutinous dressing room below. Tight clamp keeps scorelines sane. */
export function moraleRatingKick(avgMorale: number): number {
  const k = (avgMorale - MORALE_NEUTRAL) / 18;
  return Math.max(-2, Math.min(2, Math.round(k)));
}

// ─── Team talk ──────────────────────────────────────────────────────────

export type TalkId = "calm" | "fire" | "bus";

export interface TalkOption {
  id: TalkId;
  label: string;
  hint: string;
}

export const TALK_OPTIONS: TalkOption[] = [
  { id: "calm", label: "Keep it calm", hint: "Steady, low-risk. A small lift." },
  { id: "fire", label: "Fire them up", hint: "Big upside — but a fragile squad can wilt." },
  { id: "bus", label: "Park the bus", hint: "Grind it out. Best when you're outgunned." },
];

export interface TalkEffect {
  ratingDelta: number;
  moraleDelta: number;
  /** One-line read on how the talk landed, for the match feed. */
  line: string;
}

/**
 * Resolve a team talk into its effect for this matchday. "Fire them up" is
 * the gamble: a confident squad (avg morale ≥ 58) responds with a real
 * boost, a shaky one switches off and the talk backfires. "Park the bus"
 * earns its keep only when you're the underdog.
 */
export function talkEffect(id: TalkId, avgMorale: number, isUnderdog: boolean): TalkEffect {
  switch (id) {
    case "calm":
      return { ratingDelta: 1, moraleDelta: 2, line: "🎙️ Calm words. Heads clear, nerves settled." };
    case "fire":
      if (avgMorale >= 58)
        return { ratingDelta: 3, moraleDelta: 3, line: "🎙️ Fired up — and they came out roaring." };
      return { ratingDelta: -2, moraleDelta: -4, line: "🎙️ The rocket backfired — a fragile squad froze." };
    case "bus":
      return isUnderdog
        ? { ratingDelta: 3, moraleDelta: -1, line: "🎙️ Bus parked. Dogged, disciplined, hard to beat." }
        : { ratingDelta: 0, moraleDelta: -2, line: "🎙️ Negative tactics against lesser opponents. Flat." };
  }
}

// ─── Board confidence / job security ────────────────────────────────────

export interface BoardExpectation {
  /** Where the board expects this squad to finish (1 = title). */
  targetPosition: number;
  /** Short framing of the brief. */
  label: string;
}

/**
 * The board's pre-season brief, read purely off squad strength vs. the
 * league: target finish = 1 + (rivals rated above you). The label frames it —
 * and in a SECOND-TIER league the framing is about PROMOTION, not the title,
 * so a strong side there is told to "go straight up", not "win the league".
 */
export function boardExpectation(
  userRating: number,
  opponentStrengths: number[],
  opts: { secondTier?: boolean } = {},
): BoardExpectation {
  const above = opponentStrengths.filter((s) => s > userRating).length;
  const targetPosition = 1 + above;
  const total = opponentStrengths.length + 1;
  let label: string;
  if (opts.secondTier) {
    if (targetPosition <= 2) label = "Go straight up — promotion as champions.";
    else if (targetPosition <= 3) label = "Win promotion — top three at least.";
    else if (targetPosition <= Math.ceil(total * 0.5)) label = "Push for the promotion places.";
    else if (targetPosition < total - 1) label = "Consolidate — a steady mid-table year.";
    else label = "Don't get dragged into the drop zone.";
  } else {
    if (targetPosition === 1) label = "Win the league. Nothing less.";
    else if (targetPosition <= Math.ceil(total * 0.25)) label = "Push for the title and a top finish.";
    else if (targetPosition <= Math.ceil(total * 0.5)) label = "A solid top-half campaign is expected.";
    else if (targetPosition < total - 1) label = "Establish the club. Avoid any drama.";
    else label = "Survival. Keep us up and we'll talk.";
  }
  return { targetPosition, label };
}

export type ConfidenceTone = "adored" | "backed" | "pressure" | "threat";

export interface ConfidenceState {
  value: number; // 0-100
  tone: ConfidenceTone;
  label: string;
  /** True once the board has lost patience — a vote of confidence. */
  threatened: boolean;
}

const CONFIDENCE_START = 50;

/**
 * Derive board confidence from the played season. Each result moves the bar
 * (a win restores faith, a hiding erodes it fast), then it's adjusted by how
 * the current league position compares to the board's target — overachieving
 * delights them, sliding below the brief is what gets managers sacked.
 */
export function deriveConfidence(opts: {
  matches: MoraleMatch[];
  targetPosition: number;
  currentPosition: number; // 0 if season not started
}): ConfidenceState {
  const { matches, targetPosition, currentPosition } = opts;
  let v = CONFIDENCE_START;
  for (const m of matches) {
    if (m.outcome === "W") v += 5;
    else if (m.outcome === "D") v += 1;
    else v -= m.theirScore - m.ourScore >= 3 ? 6 : 4;
  }
  // Position vs. brief: +3 per place above target, −3 per place below.
  if (currentPosition > 0) v += (targetPosition - currentPosition) * 3;
  v = Math.max(0, Math.min(100, Math.round(v)));

  let tone: ConfidenceTone;
  let label: string;
  if (v >= 75) {
    tone = "adored";
    label = "The board adores you.";
  } else if (v >= 45) {
    tone = "backed";
    label = "The board backs you.";
  } else if (v >= 25) {
    tone = "pressure";
    label = "The board is growing restless.";
  } else {
    tone = "threat";
    label = "Vote of confidence — your job is on the line.";
  }
  return { value: v, tone, label, threatened: tone === "threat" };
}
