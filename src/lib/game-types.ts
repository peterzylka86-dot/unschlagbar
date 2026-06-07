export type Position = "GK"|"CB"|"RB"|"LB"|"CDM"|"CM"|"CAM"|"RW"|"LW"|"ST";

export type EraTier = "current"|"00s"|"90s"|"70s-80s";

export interface Club {
  id: string;
  name: string;
  short: string;
  city: string;
  color: string;
  founded: number;
  strength: number;
  era: "current"|"classic"|"historic";
  era_tier: EraTier;
  era_tiers?: EraTier[];
}

export interface Player {
  name: string;
  position: Position;
  prime_rating: number;
  career_years: string;
  nationality: string;
  club: string;
}

export interface Slot {
  id: string;
  position: Position;
  x: number; // 0-100 across the pitch
  y: number; // 0-100 from top
  player?: Player;
}

export type FormationKey = "4-3-3"|"4-4-2"|"4-2-3-1"|"4-5-1"|"3-4-3"|"3-5-2"|"5-4-1";

export interface Formation {
  key: FormationKey;
  label: string;
  description: string;
  slots: Slot[];
}

export type Difficulty = "easy"|"normal"|"hard";
export type DraftMode = "squad"|"position"|"quick";
export type RatingMode = "career"|"prime";

export interface RunConfig {
  league: import("./leagues").LeagueId;
  formation: FormationKey;
  difficulty: Difficulty;
  showRatings: boolean;
  draftMode: DraftMode;
  ratingMode: RatingMode;
  challengeSeed?: number;
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
  outcome: "W"|"D"|"L";
  /** Knockout/group round label, e.g. "Group", "Quarter-Final", "Final". */
  round?: string;
  /** True if this match eliminates us (knockout loss / group failure). */
  eliminates?: boolean;
}
