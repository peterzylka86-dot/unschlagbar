/*
 * Career Core — pure functions for the multi-season Career mode.
 *
 * Ported from GOLAZO's lib/golazo-core.js (the proven sibling project).
 * Translated to TypeScript, retyped against Unschlagbar's domain types,
 * and adapted to coexist with the existing match-simulation engine in
 * sim.ts. Imported by career-store and the /career routes; tested in
 * isolation via career-core.test.ts.
 *
 * Design contract — every function in this module is:
 *   1. Pure (no DOM, no fetch, no module-level mutation)
 *   2. Deterministic given its inputs (random functions take an injectable
 *      `rand` so tests pass a seeded source)
 *   3. Independent of UI / framework (zero React imports)
 *
 * The GOLAZO origin used a 4-bucket position model (GK / DEF / MID / FWD).
 * Unschlagbar uses 10 positions (GK / CB / LB / RB / CDM / CM / CAM / LW /
 * RW / ST). Pure scorer/assister weighting needs the 4-bucket model to
 * match the calibrated rates, so we expose `simplifyPosition` to bridge.
 */
import type { Player, Position } from "./game-types";

// ─── Types ──────────────────────────────────────────────────────────────────

/** 4-bucket position model used by scorer/assist weighting. */
export type SimplePosition = "GK" | "DEF" | "MID" | "FWD";

/** Minimal player shape the career engine works on. Compatible with
 *  Unschlagbar's full `Player` (extra fields like prime_rating, career_years
 *  are ignored here — they live in the domain layer). */
export interface CareerPlayer {
  name: string;
  position: Position | SimplePosition;
  club?: string;
  era?: string;
}

/** Form is bounded in [-2, 2] and clamped after every match. */
export type Form = number;

/** Per-player stats kept across a season — read into the form delta and
 *  star-demand detection. */
export interface PlayerStat {
  form: Form;
}

/** League table row used by sortStandings / cup bracket / relegation. */
export interface StandingsRow {
  Pts: number;
  GF: number;
  GA: number;
  W?: number;
  D?: number;
  L?: number;
  P?: number;
}

export type StandingsTable = Record<string, StandingsRow>;

/** Archetype seed for an AI rival manager. */
export interface Archetype {
  name: string;
  style: string;
  /** One-line flavor describing their draft personality. */
  description: string;
}

/** The canonical archetype set ported from GOLAZO. Each rival picks
 *  according to their style — Galáctico chases OVR, Pragmatist fills gaps,
 *  Romantic loves South Americans, etc. */
export const DEFAULT_ARCHETYPES: Archetype[] = [
  { name: "Galáctico",    style: "galactico",  description: "Chases the highest OVR. Pure star-power." },
  { name: "Pragmatist",   style: "pragmatist", description: "Fills positional gaps first." },
  { name: "Romantic",     style: "romantic",   description: "Loves Brazilians, Argentinians, South Americans." },
  { name: "Hipster",      style: "hipster",    description: "Quirky picks — 80s legends, deep cuts." },
  { name: "Brick Wall",   style: "brickwall",  description: "Defense first. CBs and GKs over flair." },
  { name: "Goal Machine", style: "goals",      description: "Forwards, forwards, forwards." },
  { name: "Old-School",   style: "oldschool",  description: "Pre-2000 legends only when possible." },
];

/** Minimal founding-club shape — id-less since the GOLAZO version keyed on
 *  name; can be upgraded to use Unschlagbar's `Club` id later. */
export interface FoundingClub {
  name: string;
  letter: string;
  bg: string;
  fg: string;
}

export interface AIManager {
  id: string;
  name: string;
  badge: string;
  colour: string;
  textColour: string;
  isUser: false;
  archetype: string;
  archName: string;
  foundingClub: string;
  squad: CareerPlayer[];
}

/** Formation requirement in the 4-bucket model. */
export interface FormationNeed {
  G: number;
  D: number;
  M: number;
  F: number;
}

// ─── Strings ────────────────────────────────────────────────────────────────

/** Lowercase, accent-strip, dot-strip, whitespace-collapse. Used as the
 *  stable key for form/chemistry/demands maps. */
export function normalizeName(n: string | null | undefined): string {
  return String(n ?? "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[áàâã]/g, "a")
    .replace(/[éèê]/g, "e")
    .replace(/[íì]/g, "i")
    .replace(/[óòôõ]/g, "o")
    .replace(/[úù]/g, "u")
    .replace(/[ñ]/g, "n")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Position bridge ────────────────────────────────────────────────────────

/** Map Unschlagbar's 10-position taxonomy to GOLAZO's 4-bucket. Used by
 *  scorer/assister weighting where the calibrated rates assume 4 buckets. */
export function simplifyPosition(pos: Position | SimplePosition | string): SimplePosition {
  if (pos === "GK") return "GK";
  if (pos === "CB" || pos === "LB" || pos === "RB" || pos === "DEF") return "DEF";
  if (pos === "CDM" || pos === "CM" || pos === "CAM" || pos === "MID") return "MID";
  if (pos === "LW" || pos === "RW" || pos === "ST" || pos === "FWD") return "FWD";
  // Defensive default: anything unknown is MID (least costly mis-bucket)
  return "MID";
}

// ─── Random utilities ───────────────────────────────────────────────────────

/** Sample from a Poisson distribution. Falls back to 0 for non-positive λ. */
export function poisson(lambda: number, rand: () => number = Math.random): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  while (p > L) {
    k++;
    p *= rand();
  }
  return k - 1;
}

/** Weighted random pick. Negative or zero weights are skipped. Returns null
 *  for an empty list or all-zero weights. */
export function weightedPick<T>(
  items: T[],
  weightFn: (item: T) => number,
  rand: () => number = Math.random,
): T | null {
  if (!items || items.length === 0) return null;
  const weights = items.map(weightFn);
  let sum = 0;
  for (const w of weights) if (w > 0) sum += w;
  if (sum <= 0) return null;
  let r = rand() * sum;
  for (let i = 0; i < items.length; i++) {
    if (weights[i] <= 0) continue;
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ─── Scheduling — fixtures + snake draft ────────────────────────────────────

/** A single fixture in a matchday. */
export interface Fixture {
  home: string;
  away: string;
}

export interface GenerateFixturesOptions {
  /** Optional seeded random source. */
  rand?: () => number;
  /** Set to false to skip the season-wide matchday shuffle (used in tests). */
  shuffle?: boolean;
}

/** Generate a double round-robin fixture list using the circle method with
 *  greedy home/away balancing + season-wide matchday shuffle.
 *
 *  Invariants:
 *    - Every unordered pair plays exactly twice (once each side at home)
 *    - Every team's total home count = total away count = (n - 1)
 *    - No team plays itself
 *    - With shuffle, no team has a clustered home/away streak
 */
export function generateFixtures(
  clubIds: string[],
  options: GenerateFixturesOptions = {},
): Fixture[][] {
  if (!clubIds || clubIds.length < 2) return [];
  const teams: string[] = [...clubIds];
  if (teams.length % 2 === 1) teams.push("__BYE__");
  const rounds = teams.length - 1;
  const half = teams.length / 2;
  const firstHalf: Fixture[][] = [];

  // Greedy home/away balance: at each pairing the team with fewer first-half
  // home games gets the home slot. Prevents the slot-0 team going all-home
  // then all-away (the naive circle-method bug).
  const homeCount: Record<string, number> = {};
  clubIds.forEach(id => { homeCount[id] = 0; });

  for (let r = 0; r < rounds; r++) {
    const matches: Fixture[] = [];
    for (let i = 0; i < half; i++) {
      const a = teams[i];
      const b = teams[teams.length - 1 - i];
      if (a === "__BYE__" || b === "__BYE__") continue;
      let home: string, away: string;
      if (homeCount[a] <= homeCount[b]) { home = a; away = b; }
      else { home = b; away = a; }
      homeCount[home]++;
      matches.push({ home, away });
    }
    firstHalf.push(matches);
    teams.splice(1, 0, teams.pop()!);
  }
  const secondHalf: Fixture[][] = firstHalf.map(md =>
    md.map(m => ({ home: m.away, away: m.home })),
  );
  const all = [...firstHalf, ...secondHalf];

  const shuffleSource = options.shuffle === false
    ? null
    : (options.rand ?? Math.random);
  if (shuffleSource) {
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(shuffleSource() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
  }
  return all;
}

/** Compute which manager is on the clock for a given pick in a snake draft.
 *  Round 1 is forward order, round 2 reverses, etc. */
export function snakePickerId(
  round1Order: string[],
  round: number,
  pickInRound: number,
): string | null {
  if (!round1Order || round1Order.length === 0) return null;
  const r = round - 1;
  const idxInRound = (pickInRound - 1) % round1Order.length;
  const order = (r % 2 === 0) ? round1Order : [...round1Order].reverse();
  return order[idxInRound];
}

// ─── Formation needs ────────────────────────────────────────────────────────

/** Which 4-bucket positions still have open slots in this partial squad.
 *  Caller passes Unschlagbar players; we simplify to 4-bucket internally. */
export function positionsNeeded(
  squad: CareerPlayer[] | null | undefined,
  formation: FormationNeed,
): Set<SimplePosition> {
  const counts: Record<SimplePosition, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  (squad ?? []).forEach(p => {
    const bucket = simplifyPosition(p.position);
    counts[bucket]++;
  });
  const need = new Set<SimplePosition>();
  if (counts.GK < formation.G) need.add("GK");
  if (counts.DEF < formation.D) need.add("DEF");
  if (counts.MID < formation.M) need.add("MID");
  if (counts.FWD < formation.F) need.add("FWD");
  return need;
}

// ─── Match: scorer + assister ───────────────────────────────────────────────

export const SCORER_WEIGHT: Record<SimplePosition, number> = {
  FWD: 4, MID: 1.6, DEF: 0.18, GK: 0.02,
};
export const ASSIST_WEIGHT: Record<SimplePosition, number> = {
  MID: 3.5, FWD: 2.0, DEF: 0.6, GK: 0.05,
};

/** Pick a goal scorer from the XI, weighted heavily toward forwards. Form
 *  and chemistry give a multiplicative boost. */
export function pickScorer(
  xi: CareerPlayer[],
  formMap: Record<string, number> | null | undefined,
  rand: () => number = Math.random,
  chemMap?: Record<string, number>,
): CareerPlayer | null {
  const chem = chemMap ?? computeChemistry(xi);
  return weightedPick(xi, p => {
    const base = SCORER_WEIGHT[simplifyPosition(p.position)] ?? 0;
    const form = formMap ? (formMap[normalizeName(p.name)] ?? 0) : 0;
    const c = chem[normalizeName(p.name)] ?? 0;
    return base * (1 + form * 0.25) * (1 + c * 0.15);
  }, rand);
}

/** Pick an assister, biased toward midfielders. Returns null ~28% of the
 *  time to model unassisted goals (penalty / solo run / dead-ball). */
export function pickAssister(
  xi: CareerPlayer[],
  scorer: CareerPlayer,
  rand: () => number = Math.random,
  unassistedProb: number = 0.28,
): CareerPlayer | null {
  if (rand() < unassistedProb) return null;
  const others = xi.filter(p => p !== scorer);
  if (others.length === 0) return null;
  return weightedPick(others, p => ASSIST_WEIGHT[simplifyPosition(p.position)] ?? 0, rand);
}

// ─── Form: between-match deltas ─────────────────────────────────────────────

export const FORM_MIN = -2;
export const FORM_MAX = 2;
export const FORM_HOT_THRESHOLD = 1.8;
export const FORM_COLD_THRESHOLD = -1.8;

export interface FormDeltaContext {
  wasInvolved: boolean;
  gf: number;
  ga: number;
  currentForm: Form;
}

/** Compute the form delta for one player after one match. Caller adds the
 *  result onto the player's existing form and clamps. */
export function computeFormDelta(
  player: { position: Position | SimplePosition | string },
  ctx: FormDeltaContext,
): number {
  const bucket = simplifyPosition(player.position);
  let delta = 0;
  const heavyLoss = (ctx.ga - ctx.gf) >= 3;
  const cleanSheet = ctx.ga === 0;
  const concededLots = ctx.ga >= 3;
  if (ctx.wasInvolved) delta += 1;
  if (cleanSheet && (bucket === "GK" || bucket === "DEF")) delta += 1;
  if (heavyLoss && !ctx.wasInvolved && (bucket === "FWD" || bucket === "MID")) delta -= 1;
  if (concededLots && bucket === "GK") delta -= 1;
  if (delta === 0) {
    // Drift toward neutral when nothing happened
    if (ctx.currentForm > 0) delta = -0.5;
    else if (ctx.currentForm < 0) delta = 0.5;
  }
  return delta;
}

export function clampForm(form: number): number {
  return Math.max(FORM_MIN, Math.min(FORM_MAX, form));
}

export type FormCrossingDirection = "hot" | "cold";

/** Detect whether a form change crossed the hot/cold threshold. Used by the
 *  post-season screen to surface "Mbappé hits a purple patch" / "VVD in a
 *  slump" events. */
export function crossedFormThreshold(
  prevForm: Form,
  newForm: Form,
): FormCrossingDirection | null {
  if (prevForm < FORM_HOT_THRESHOLD && newForm >= FORM_HOT_THRESHOLD) return "hot";
  if (prevForm > FORM_COLD_THRESHOLD && newForm <= FORM_COLD_THRESHOLD) return "cold";
  return null;
}

// ─── League standings, cup, relegation ─────────────────────────────────────

/** Sort the standings by points then goal difference. Pure: doesn't mutate. */
export function sortStandings(table: StandingsTable): [string, StandingsRow][] {
  return Object.entries(table).sort((a, b) => {
    if (b[1].Pts !== a[1].Pts) return b[1].Pts - a[1].Pts;
    return (b[1].GF - b[1].GA) - (a[1].GF - a[1].GA);
  });
}

export interface CupBracketOptions {
  /** Max number of teams in the cup. Defaults to 8. */
  size?: number;
}

export interface CupBracketResult {
  qf: Fixture[];
  userOut: boolean;
  qualifiers: string[];
}

/** Build a cup quarter-final bracket from the top N of the league table,
 *  seeded 1v8 / 2v7 / 3v6 / 4v5 so finishing higher earns an easier draw. */
export function cupBracketSeeded(
  table: StandingsTable,
  userId: string,
  options: CupBracketOptions = {},
): CupBracketResult {
  const cupCap = options.size ?? 8;
  const sorted = sortStandings(table);
  const target = Math.min(cupCap, sorted.length);
  const usable = target - (target % 2);
  const top = sorted.slice(0, usable).map(([id]) => id);
  const qf: Fixture[] = [];
  const half = usable / 2;
  for (let i = 0; i < half; i++) {
    qf.push({ home: top[i], away: top[usable - 1 - i] });
  }
  return { qf, userOut: !top.includes(userId), qualifiers: top };
}

/** Identify players whose form has crossed into "I want a transfer" territory.
 *  Default threshold is FORM_MAX (2.0) — only the genuinely hottest players
 *  demand moves. */
export function detectStarDemands(
  squad: CareerPlayer[] | null | undefined,
  playerStats: Record<string, PlayerStat>,
  threshold: number = FORM_MAX,
): CareerPlayer[] {
  const result: CareerPlayer[] = [];
  (squad ?? []).forEach(p => {
    const stat = playerStats[normalizeName(p.name)];
    if (stat && stat.form >= threshold) result.push(p);
  });
  return result;
}

export interface DetectRelegationOptions {
  /** Leagues smaller than this skip relegation entirely (defaults to 10). */
  minClubsForRelegation?: number;
  /** Number of bottom clubs that go down (defaults to 2). */
  zoneSize?: number;
}

export interface RelegationResult {
  relegatedIds: string[];
  userRelegated: boolean;
}

/** Identify the bottom-N clubs in the standings (the "relegation zone"). */
export function detectRelegation(
  table: StandingsTable,
  userId: string,
  options: DetectRelegationOptions = {},
): RelegationResult {
  const min = options.minClubsForRelegation ?? 10;
  const zone = options.zoneSize ?? 2;
  const sorted = sortStandings(table);
  if (sorted.length < min) return { relegatedIds: [], userRelegated: false };
  const relegatedIds = sorted.slice(-zone).map(([id]) => id);
  return { relegatedIds, userRelegated: relegatedIds.includes(userId) };
}

// ─── AI rivals — archetype-driven managers ──────────────────────────────────

/** Build n AI rival managers, each with a founding club + archetype.
 *
 *  Critical invariant — returns exactly n managers even when n exceeds the
 *  archetype pool. The original GOLAZO bug (Lovable-shipped league count of
 *  12 silently capped at 8) came from a `slice(0, n)` on the 7-archetype
 *  array. The fix recycles archetypes. */
export function buildAIManagers(
  n: number,
  excludeClub: string,
  archetypes: Archetype[],
  clubs: FoundingClub[],
  rand: () => number = Math.random,
): AIManager[] {
  if (n <= 0) return [];
  if (!archetypes || archetypes.length === 0) return [];
  if (!clubs || clubs.length === 0) return [];
  // Shuffle archetypes; recycle when n > pool size
  const shuffledArchs = [...archetypes].sort(() => rand() - 0.5);
  const archs: Archetype[] = [];
  for (let i = 0; i < n; i++) archs.push(shuffledArchs[i % shuffledArchs.length]);
  // Founding clubs — unique per manager (exclude the user's)
  const availClubs = clubs.filter(c => c.name !== excludeClub)
    .sort(() => rand() - 0.5)
    .slice(0, n);
  const count = Math.min(n, availClubs.length);
  const result: AIManager[] = [];
  for (let i = 0; i < count; i++) {
    const a = archs[i];
    const club = availClubs[i];
    result.push({
      id: "ai_" + i,
      name: club.name,
      badge: club.letter,
      colour: club.bg,
      textColour: club.fg,
      isUser: false,
      archetype: a.style,
      archName: a.name,
      foundingClub: club.name,
      squad: [],
    });
  }
  return result;
}

/**
 * Score a player from an AI archetype's perspective. Higher = more likely
 * to be picked by an AI with that style. Used by the snake-draft AI loop.
 *
 * Returns a number; the AI simply picks the highest-scoring eligible
 * player from the available pool.
 */
export function scorePlayerByArchetype(
  player: Player,
  archetypeStyle: string,
  positionalNeed: Set<SimplePosition>,
): number {
  let score = player.prime_rating;  // every archetype loves quality
  const pos = simplifyPosition(player.position);
  const fillsNeed = positionalNeed.has(pos);

  switch (archetypeStyle) {
    case "galactico":
      // Pure OVR chaser — small bump for need, big multiplier for top tier
      if (player.prime_rating >= 92) score += 10;
      if (fillsNeed) score += 3;
      break;
    case "pragmatist":
      // Need-first; OVR matters less
      if (fillsNeed) score += 12;
      else score -= 5;
      break;
    case "romantic":
      // Brazilians, Argentinians, Uruguayans, Colombians — South American
      // football romance.
      if (/brazil|argentin|uruguay|colombi|chile|paraguay|ecuador|peru/i.test(player.nationality)) {
        score += 8;
      }
      if (fillsNeed) score += 2;
      break;
    case "hipster":
      // Era / OVR sweet-spot — favor 88-91 over 95+, and pre-2010 eras
      if (player.prime_rating >= 88 && player.prime_rating <= 91) score += 6;
      const yearMatch = player.career_years.match(/(?:19|20)\d{2}/);
      if (yearMatch) {
        const year = parseInt(yearMatch[0]);
        if (year < 2010) score += 4;
      }
      if (fillsNeed) score += 2;
      break;
    case "brickwall":
      if (pos === "GK" || pos === "DEF") score += 8;
      else score -= 3;
      if (fillsNeed) score += 3;
      break;
    case "goals":
      if (pos === "FWD") score += 10;
      else if (pos === "MID") score += 2;
      else score -= 4;
      if (fillsNeed) score += 2;
      break;
    case "oldschool":
      const yMatch = player.career_years.match(/(?:19|20)\d{2}/);
      if (yMatch && parseInt(yMatch[0]) < 2000) score += 10;
      else if (yMatch && parseInt(yMatch[0]) < 2010) score += 3;
      if (fillsNeed) score += 2;
      break;
    default:
      if (fillsNeed) score += 3;
  }
  return score;
}

// ─── Chemistry — squad synergy from same club + era ─────────────────────────

export const CHEM_DUO = 0.5;
export const CHEM_TRIO_PLUS = 1.0;

/** Detect chemistry groups in a squad. Players sharing the same (club, era)
 *  bucket form a group; the group's bonus is 0.5 for a duo, 1.0 for trio+.
 *  Returns a map: normalized player name → chemistry bonus. */
export function computeChemistry(
  squad: CareerPlayer[] | null | undefined,
): Record<string, number> {
  if (!squad || squad.length === 0) return {};
  const buckets: Record<string, CareerPlayer[]> = {};
  squad.forEach(p => {
    const club = p.club ?? "";
    const era = p.era ?? "";
    if (!club || !era) return;
    const key = club + "||" + era;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(p);
  });
  const chem: Record<string, number> = {};
  Object.values(buckets).forEach(group => {
    if (group.length < 2) return;
    const bonus = group.length >= 3 ? CHEM_TRIO_PLUS : CHEM_DUO;
    group.forEach(p => {
      const k = normalizeName(p.name);
      chem[k] = Math.max(chem[k] ?? 0, bonus);
    });
  });
  return chem;
}

export interface ChemistryGroup {
  club: string;
  era: string;
  players: CareerPlayer[];
  bonus: number;
}

/** Group the chemistry into a display-ready shape sorted by group size desc. */
export function chemistryGroups(
  squad: CareerPlayer[] | null | undefined,
): ChemistryGroup[] {
  if (!squad || squad.length === 0) return [];
  const buckets: Record<string, { club: string; era: string; players: CareerPlayer[] }> = {};
  squad.forEach(p => {
    const club = p.club ?? "";
    const era = p.era ?? "";
    if (!club || !era) return;
    const key = club + "||" + era;
    if (!buckets[key]) buckets[key] = { club, era, players: [] };
    buckets[key].players.push(p);
  });
  return Object.values(buckets)
    .filter(g => g.players.length >= 2)
    .map(g => ({ ...g, bonus: g.players.length >= 3 ? CHEM_TRIO_PLUS : CHEM_DUO }))
    .sort((a, b) => b.players.length - a.players.length);
}

// ─── Adapter from Unschlagbar's Player ──────────────────────────────────────

/** Derive an era label from Unschlagbar's career_years string. Used so that
 *  chemistry can group players from the same decade together. Mirrors the
 *  era tier logic already in draft.tsx. */
export function eraFromCareerYears(years: string | undefined): string {
  if (!years) return "";
  const matches = years.match(/(?:19|20)\d{2}/g);
  if (!matches || matches.length === 0) return "";
  const start = Math.min(...matches.map(Number));
  if (start < 1988) return "70s-80s";
  if (start < 2000) return "90s";
  if (start < 2015) return "00s";
  return "current";
}

/** Adapter from Unschlagbar's Player to a CareerPlayer. Adds an `era` field
 *  derived from career_years so chemistry detection works without changing
 *  the player JSON schema. */
export function fromPlayer(p: Player): CareerPlayer {
  return {
    name: p.name,
    position: p.position,
    club: p.club,
    era: eraFromCareerYears(p.career_years),
  };
}
