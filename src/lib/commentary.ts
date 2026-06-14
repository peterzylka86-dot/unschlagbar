/**
 * Flavour-text commentary — the "Anstoss secret sauce".
 *
 * Research finding: the single highest fun-per-line-of-code addition to a
 * stat-driven football game is a flavour-text table. It's what people
 * remember most fondly about Anstoss (the Halbzeitsprüche) and it makes a
 * numbers sim feel ALIVE — for near-zero infrastructure (a few string
 * arrays + a deterministic roll).
 *
 * Design rules:
 *   • PURE + DETERMINISTIC — the line for a given (matchday, facts) never
 *     changes on re-render or resume. Keyed off a numeric seed, no
 *     Math.random.
 *   • Context-aware — picks a category from the match facts (rout, upset,
 *     clean sheet, hat-trick, narrow win, capitulation…) so the line
 *     always fits what happened.
 *   • Tone: dry, fond, faintly tabloid — the cult-manager voice. Never
 *     mean, never breaks the retro charm.
 *
 * Placeholders: {opp} = opponent short name, {scorer} = top scorer name.
 */
import type { MatchResult } from "./game-types";

export interface CommentaryContext {
  /** Opponent display (short) name. */
  opp: string;
  /** True if we were the much weaker side on paper (giant-killing). */
  isUpset?: boolean;
  /** True if we lost to a much weaker side (embarrassment). */
  isUpsetLoss?: boolean;
  /** Name of a player who scored 3+ this match, if any. */
  hatTrickScorer?: string;
  /** Top scorer of THIS match (1-2 goals), if any. */
  topScorer?: string;
}

// ─── Line pools by situation ────────────────────────────────────────────
// Keep each pool ≥4 so repeats across a 22-38 game season feel rare.

const ROUT = [
  "Men against boys. {opp} never turned up.",
  "A demolition. The {opp} bench couldn't watch.",
  "Ruthless. They could have had ten.",
  "Total football — {opp} were mere spectators.",
  "The kind of result that ends managers. Sorry, {opp}.",
];

const COMFORTABLE_WIN = [
  "Professional. Job done against {opp}, never in doubt.",
  "Routine three points. Barely broke a sweat.",
  "Controlled from the first whistle. {opp} had nothing.",
  "Cruise control. The crowd were singing by the hour mark.",
];

const NARROW_WIN = [
  "Nervy. But three points are three points.",
  "Backs to the wall late on, but they held. Huge win.",
  "Smash-and-grab against {opp} — and nobody cares how.",
  "A goal was always going to settle it. It did.",
  "Heart-in-mouth stuff at the death. They got over the line.",
];

const UPSET_WIN = [
  "GIANT-KILLING. {opp} will not sleep tonight.",
  "Nobody gave them a chance against {opp}. Nobody told the players.",
  "The form book? Torn up and thrown at {opp}.",
  "An upset for the ages. The pundits are speechless.",
];

const CLEAN_SHEET_WIN = [
  "A clean sheet and three points — the defenders bought the drinks.",
  "Shut up shop, picked {opp} off. Textbook.",
  "Not a single sniff for {opp}. The back line was immense.",
];

const DRAW = [
  "Honours even. Both sides will feel they left points out there.",
  "A share of the spoils with {opp}. Forgettable.",
  "Stalemate. One for the connoisseurs of the goalless variety.",
  "Frustrating. Dominated, but {opp} dug in.",
  "A point's a point. The board wanted more.",
];

const NARROW_LOSS = [
  "Heartbreak. One moment of quality from {opp} settled it.",
  "Deserved more, got nothing. {opp} were clinical.",
  "A sucker-punch. The dressing room is silent.",
  "Fine margins. {opp} took theirs, we didn't.",
];

const HEAVY_LOSS = [
  "Capitulation. {opp} ran riot.",
  "A chastening afternoon. Questions will be asked.",
  "Outclassed by {opp}. Back to the training ground.",
  "Men against boys — and this time we were the boys.",
];

const UPSET_LOSS = [
  "Embarrassing. {opp} were there for the taking and we froze.",
  "The minnows of {opp} did a number on us. Inexcusable.",
  "A banana skin, and we slipped on it spectacularly.",
];

const HAT_TRICK = [
  "{scorer} with a hat-trick — match ball going on the mantelpiece.",
  "Three for {scorer}. A performance for the scrapbook.",
  "{scorer} couldn't stop scoring. {opp} had no answer.",
];

/** Deterministic index into a pool from a numeric seed. */
function pick(pool: string[], seed: number): string {
  const i = ((seed % pool.length) + pool.length) % pool.length;
  return pool[i];
}

/**
 * Produce a one-line flavour comment for a played match. Deterministic
 * for a given (match.matchday, facts) so it never reshuffles on render.
 * Returns null only if there is genuinely nothing to say (shouldn't
 * happen for a completed match).
 */
export function matchCommentary(match: MatchResult, ctx: CommentaryContext): string | null {
  const margin = match.ourScore - match.theirScore;
  const seed = match.matchday * 31 + match.ourScore * 7 + match.theirScore * 13;
  const oppName = ctx.opp || match.opponent.short || "them";

  let pool: string[];
  if (ctx.hatTrickScorer) {
    // Hat-trick line takes priority on a win; on a loss it's bittersweet
    // but still the story.
    pool = HAT_TRICK;
  } else if (match.outcome === "W") {
    if (ctx.isUpset) pool = UPSET_WIN;
    else if (margin >= 4) pool = ROUT;
    else if (match.theirScore === 0 && margin <= 2) pool = CLEAN_SHEET_WIN;
    else if (margin === 1) pool = NARROW_WIN;
    else pool = COMFORTABLE_WIN;
  } else if (match.outcome === "D") {
    pool = DRAW;
  } else {
    // Loss
    if (ctx.isUpsetLoss) pool = UPSET_LOSS;
    else if (-margin >= 3) pool = HEAVY_LOSS;
    else pool = NARROW_LOSS;
  }

  const line = pick(pool, seed);
  return line
    .replace(/\{opp\}/g, oppName)
    .replace(/\{scorer\}/g, ctx.hatTrickScorer ?? ctx.topScorer ?? "");
}

// ─── Board notes (season-level milestones) ──────────────────────────────
// Surfaced at the end of a season run to frame the achievement with the
// cult-manager voice. Pure function of the final standing.

export function boardNote(opts: {
  position: number;
  totalTeams: number;
  unbeaten: boolean;
  beatForecast: boolean | null;
  relegated: boolean;
  champion: boolean;
}): string {
  if (opts.unbeaten) return "📋 The board is speechless. An entire season unbeaten — you are untouchable.";
  if (opts.champion) return "📋 Champions. The board wanted top four. You gave them the title.";
  if (opts.relegated) return "📋 Relegation. The board's faith is… being discussed. Rebuild and bounce back.";
  if (opts.beatForecast === true)
    return "📋 The board is delighted — you finished well above where this squad was expected to.";
  if (opts.beatForecast === false)
    return "📋 The board expected more from this squad. A summer of reflection beckons.";
  if (opts.position <= 4) return "📋 A strong campaign. The board is pleased with the top-four finish.";
  return "📋 A solid, unremarkable season. The board files it under 'acceptable'.";
}
