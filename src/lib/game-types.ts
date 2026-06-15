export type Position = "GK" | "CB" | "RB" | "LB" | "CDM" | "CM" | "CAM" | "RW" | "LW" | "ST";

export type EraTier = "current" | "00s" | "90s" | "70s-80s";

export interface Club {
  id: string;
  name: string;
  short: string;
  city: string;
  color: string;
  founded: number;
  strength: number;
  era: "current" | "classic" | "historic";
  era_tier: EraTier;
  era_tiers?: EraTier[];
}

export interface Player {
  name: string;
  /** Primary position — used by the recap tactic view and as the default
   *  identifier ("ST · 95"). */
  position: Position;
  /** Other positions this player can fill. Mbappé might be LW with [ST]
   *  alts; Bellingham CAM with [CM]; Hakimi RB with [RWB,RM] etc.
   *  Slot eligibility (drafting + swap windows) is primary ∪ altPositions.
   *  Omit/empty for specialists (Sørloth = ST only, no alts). */
  altPositions?: Position[];
  prime_rating: number;
  career_years: string;
  nationality: string;
  club: string;
  /** Quiet quality signal — true if the (player, club) pairing was
   *  confirmed against an external source (Wikipedia article mention
   *  via tools/verify_wikidata.py). Used to upweight verified players
   *  in the picker so users see them first. Unverified players are
   *  STILL shown — this is sort order, not a filter. */
  verified?: boolean;
  /** GOLAZO wonderkid state (legend-prospect). Present only on a developing
   *  prospect signed via the wonderkid lottery. When set, `prime_rating` is
   *  the player's CURRENT (rising) rating and `targetRating` is the legend's
   *  historical peak — the growth ceiling. `age` drives the decline curve.
   *  See lib/wonderkids.ts. */
  wonderkidId?: string;
  targetRating?: number;
  age?: number;
  /** Real-mode (EA FC) potential ceiling — used by the ageing curve so a
   *  young current player can still develop toward his peak. */
  potential?: number;
}

export interface Slot {
  id: string;
  position: Position;
  x: number; // 0-100 across the pitch
  y: number; // 0-100 from top
  player?: Player;
}

export type FormationKey = "4-3-3" | "4-4-2" | "4-2-3-1" | "4-5-1" | "3-4-3" | "3-5-2" | "5-4-1";

export interface Formation {
  key: FormationKey;
  label: string;
  description: string;
  slots: Slot[];
}

/** GOLAZO career flavour: "real" draws from today's players (current
 *  squads); "legends" draws from the all-time pool. */
export type CareerMode = "real" | "legends";

export type Difficulty = "easy" | "normal" | "hard";
export type DraftMode = "squad" | "position" | "quick";
export type RatingMode = "career" | "prime";

export interface RunConfig {
  league: import("./leagues").LeagueId;
  formation: FormationKey;
  difficulty: Difficulty;
  showRatings: boolean;
  draftMode: DraftMode;
  ratingMode: RatingMode;
  challengeSeed?: number;
  /** Challenger's score that came in via the URL — used to show "you vs
   *  them" on the result screen + the landing banner ("beat their 54 pts").
   *  Cleared after the result has been compared. */
  challengerScore?: {
    name?: string;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
  };
  /** Optional: a specific player the user wants to start with. Pre-assigned
   *  to a compatible slot on /draft mount; the wheel handles the rest. */
  foundingPlayer?: Player;
}

export interface MatchResult {
  matchday: number;
  opponent: Club;
  home: boolean;
  ourScore: number;
  theirScore: number;
  outcome: "W" | "D" | "L";
  /** Knockout/group round label, e.g. "Group", "Quarter-Final", "Final". */
  round?: string;
  /** True if this match eliminates us (knockout loss / group failure). */
  eliminates?: boolean;
  /** Goal scorers (with optional assister) — populated for Quick Match
   *  by /season post-sim, and for Career by /career/season. Pure sim
   *  output omits this; consumers must treat as optional. */
  scorers?: { name: string; assister?: string }[];
}
