/**
 * Per-player season stats + a CM/Anstoss-style attribute breakdown.
 *
 * Stats are DERIVED from the played matches + the matchday lineups (the same
 * replay-safe local state the season screen rebuilds by clicking) — nothing is
 * accumulated in the store, so a replay reproduces the identical numbers.
 *
 * Attributes are a deterministic shaping of a player's overall by position: a
 * CB reads high on Defending/Physical and low on Shooting, a winger flips it.
 * Pure — no Math.random / Date.
 */
import { normalizeName } from "./career-core";

export interface PlayerSeasonStats {
  /** Matchdays the player was in the starting XI. */
  apps: number;
  /** Goals scored this season. */
  goals: number;
  /** Assists provided this season. */
  assists: number;
  /** Matchdays started in which the team conceded zero. */
  cleanSheets: number;
}

interface StatMatch {
  ourScore: number;
  theirScore: number;
  scorers: { name: string; assister?: string }[];
}

/**
 * Tally a player's season from the match feed. `lineups[i]` is the XI (keys
 * `club:name`) that started matchday `i`, parallel to `matches[i]`.
 */
export function playerSeasonStats(
  player: { name: string },
  matches: StatMatch[],
  lineups: string[][],
  playerKey: string,
): PlayerSeasonStats {
  const pn = normalizeName(player.name);
  let apps = 0;
  let goals = 0;
  let assists = 0;
  let cleanSheets = 0;

  matches.forEach((m, i) => {
    for (const s of m.scorers) {
      if (normalizeName(s.name) === pn) goals++;
      if (s.assister && normalizeName(s.assister) === pn) assists++;
    }
    const started = (lineups[i] ?? []).includes(playerKey);
    if (started) {
      apps++;
      if (m.theirScore === 0) cleanSheets++;
    }
  });

  return { apps, goals, assists, cleanSheets };
}

// ─── Position-shaped attributes ──────────────────────────────────────────

export interface Attribute {
  label: string;
  short: string;
  value: number;
}

type Bucket = "GK" | "DEF" | "FB" | "DM" | "MID" | "AM" | "WING" | "FWD";

/** Map a raw position string to a coarse role bucket. */
function bucketOf(position: string): Bucket {
  const p = position.toUpperCase();
  if (p === "GK") return "GK";
  if (p === "CB") return "DEF";
  if (p === "LB" || p === "RB" || p === "LWB" || p === "RWB") return "FB";
  if (p === "CDM" || p === "DM") return "DM";
  if (p === "CM") return "MID";
  if (p === "CAM" || p === "AM") return "AM";
  if (p === "LW" || p === "RW" || p === "LM" || p === "RM") return "WING";
  return "FWD"; // ST / CF / anything attacking
}

// Outfield: [Pace, Shooting, Passing, Dribbling, Defending, Physical].
const OUTFIELD_LABELS: { label: string; short: string }[] = [
  { label: "Pace", short: "PAC" },
  { label: "Shooting", short: "SHO" },
  { label: "Passing", short: "PAS" },
  { label: "Dribbling", short: "DRI" },
  { label: "Defending", short: "DEF" },
  { label: "Physical", short: "PHY" },
];

const GK_LABELS: { label: string; short: string }[] = [
  { label: "Reflexes", short: "REF" },
  { label: "Handling", short: "HAN" },
  { label: "Positioning", short: "POS" },
  { label: "Kicking", short: "KIC" },
  { label: "Aerial", short: "AER" },
  { label: "Speed", short: "SPD" },
];

// Offsets added to the overall per bucket, in label order. Tuned so the
// profile reads true to the role while staying anchored to the overall.
const OFFSETS: Record<Bucket, number[]> = {
  GK: [4, 2, 3, -6, 1, -18],
  DEF: [-6, -22, -8, -12, 6, 5],
  FB: [4, -16, -2, -2, 1, -2],
  DM: [-4, -10, 2, -4, 4, 3],
  MID: [-2, -4, 5, 2, -2, 0],
  AM: [0, 2, 5, 6, -14, -6],
  WING: [8, -2, 0, 7, -14, -6],
  FWD: [3, 8, -6, 2, -20, 2],
};

function fnv(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp99 = (n: number) => Math.max(20, Math.min(99, Math.round(n)));

/**
 * A six-attribute breakdown of the player, shaped by position and anchored to
 * their overall, with a small per-attribute seeded wobble so two same-rated
 * players of the same role still differ. Goalkeepers get keeper attributes.
 */
export function positionAttributes(player: {
  name: string;
  position: string;
  prime_rating: number;
}): Attribute[] {
  const bucket = bucketOf(player.position);
  const labels = bucket === "GK" ? GK_LABELS : OUTFIELD_LABELS;
  const offsets = OFFSETS[bucket];
  const base = player.prime_rating;
  return labels.map((l, i) => {
    const jitter = (fnv(`${player.name}:${l.short}`) % 7) - 3; // -3..+3
    return { label: l.label, short: l.short, value: clamp99(base + offsets[i] + jitter) };
  });
}
