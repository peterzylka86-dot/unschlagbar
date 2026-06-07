/*
 * Tests for career-core. Ported from GOLAZO's lib/golazo-core.test.js (84
 * cases) to vitest, retyped against Unschlagbar's domain types.
 *
 * The pure-function ethos means every test is deterministic — random
 * sources use seededRand (Mulberry32). No flaky tests by construction.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeName,
  simplifyPosition,
  poisson,
  weightedPick,
  generateFixtures,
  snakePickerId,
  positionsNeeded,
  pickScorer,
  pickAssister,
  computeFormDelta,
  clampForm,
  crossedFormThreshold,
  sortStandings,
  cupBracketSeeded,
  detectStarDemands,
  detectRelegation,
  buildAIManagers,
  computeChemistry,
  chemistryGroups,
  eraFromCareerYears,
  fromPlayer,
  scorePlayerByArchetype,
  DEFAULT_ARCHETYPES,
  type CareerPlayer,
  type Archetype,
  type FoundingClub,
  type StandingsTable,
  type StandingsRow,
} from "./career-core";
import type { Player } from "./game-types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Mulberry32 — small, fast, deterministic PRNG for tests. */
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F433 = { G: 1, D: 4, M: 3, F: 3 };
const F442 = { G: 1, D: 4, M: 4, F: 2 };

const SAMPLE_XI: CareerPlayer[] = [
  { name: "Keeper", position: "GK" },
  { name: "Def A", position: "CB" },
  { name: "Def B", position: "CB" },
  { name: "Mid A", position: "CM" },
  { name: "Mid B", position: "CM" },
  { name: "Fwd A", position: "ST" },
  { name: "Fwd B", position: "ST" },
];

function makeTable(rows: Array<[string, number, number?]>): StandingsTable {
  const t: StandingsTable = {};
  rows.forEach(([id, pts, gd]) => {
    t[id] = { P: 0, W: 0, D: 0, L: 0, GF: gd ?? 0, GA: 0, Pts: pts } as StandingsRow;
  });
  return t;
}

// ─── normalizeName ──────────────────────────────────────────────────────────

describe("normalizeName", () => {
  it("lowercases", () => {
    expect(normalizeName("Diego MARADONA")).toBe("diego maradona");
  });
  it("strips accents", () => {
    expect(normalizeName("Eusébio")).toBe("eusebio");
    expect(normalizeName("Marc-André")).toBe("marc-andre");
    expect(normalizeName("Iñaki")).toBe("inaki");
    expect(normalizeName("São Paulo")).toBe("sao paulo");
  });
  it("strips dots from initials", () => {
    expect(normalizeName("M. Salah")).toBe("m salah");
    expect(normalizeName("T. Alexander-Arnold")).toBe("t alexander-arnold");
  });
  it("collapses internal whitespace and trims", () => {
    expect(normalizeName("   Lionel    Messi   ")).toBe("lionel messi");
  });
  it("handles empty/null input", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(undefined)).toBe("");
  });
});

// ─── simplifyPosition ───────────────────────────────────────────────────────

describe("simplifyPosition", () => {
  it("maps all defender variants to DEF", () => {
    expect(simplifyPosition("CB")).toBe("DEF");
    expect(simplifyPosition("LB")).toBe("DEF");
    expect(simplifyPosition("RB")).toBe("DEF");
    expect(simplifyPosition("DEF")).toBe("DEF");
  });
  it("maps all midfielder variants to MID", () => {
    expect(simplifyPosition("CDM")).toBe("MID");
    expect(simplifyPosition("CM")).toBe("MID");
    expect(simplifyPosition("CAM")).toBe("MID");
    expect(simplifyPosition("MID")).toBe("MID");
  });
  it("maps all forward variants to FWD", () => {
    expect(simplifyPosition("LW")).toBe("FWD");
    expect(simplifyPosition("RW")).toBe("FWD");
    expect(simplifyPosition("ST")).toBe("FWD");
    expect(simplifyPosition("FWD")).toBe("FWD");
  });
  it("keeps GK as GK", () => {
    expect(simplifyPosition("GK")).toBe("GK");
  });
  it("defaults unknown to MID", () => {
    expect(simplifyPosition("?" as unknown as string)).toBe("MID");
  });
});

// ─── poisson ────────────────────────────────────────────────────────────────

describe("poisson", () => {
  it("never returns a negative integer", () => {
    const rand = seededRand(42);
    for (let i = 0; i < 5000; i++) {
      const v = poisson(2.0, rand);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
  it("returns 0 for non-positive λ", () => {
    expect(poisson(0)).toBe(0);
    expect(poisson(-5)).toBe(0);
  });
  it("mean approximates λ over many samples", () => {
    const rand = seededRand(7);
    let total = 0;
    const N = 50000;
    const lambda = 1.5;
    for (let i = 0; i < N; i++) total += poisson(lambda, rand);
    const mean = total / N;
    expect(Math.abs(mean - lambda)).toBeLessThan(0.05);
  });
});

// ─── weightedPick ───────────────────────────────────────────────────────────

describe("weightedPick", () => {
  it("honours relative weights", () => {
    const items = ["A", "B"];
    const rand = seededRand(1);
    const N = 10000;
    let aCount = 0;
    for (let i = 0; i < N; i++) {
      const pick = weightedPick(items, (x) => (x === "A" ? 9 : 1), rand);
      if (pick === "A") aCount++;
    }
    expect(aCount).toBeGreaterThan(N * 0.86);
    expect(aCount).toBeLessThan(N * 0.94);
  });
  it("returns null on empty list", () => {
    expect(weightedPick([], () => 1)).toBeNull();
  });
  it("returns null when all weights are zero", () => {
    expect(weightedPick(["A", "B"], () => 0)).toBeNull();
  });
  it("ignores negative weights", () => {
    const result = weightedPick(["A", "B"], (x) => (x === "A" ? -1 : 5));
    expect(result).toBe("B");
  });
});

// ─── generateFixtures ───────────────────────────────────────────────────────

describe("generateFixtures", () => {
  it("produces double round-robin for 8 clubs (14 matchdays × 4 matches)", () => {
    const ids = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const md = generateFixtures(ids);
    expect(md).toHaveLength(14);
    md.forEach((round) => expect(round).toHaveLength(4));
  });
  it("produces 22 matchdays × 6 matches for 12 clubs", () => {
    const ids = Array.from({ length: 12 }, (_, i) => "c" + i);
    const md = generateFixtures(ids);
    expect(md).toHaveLength(22);
    md.forEach((round) => expect(round).toHaveLength(6));
  });
  it("every unordered pair plays exactly twice", () => {
    const ids = ["A", "B", "C", "D", "E", "F"];
    const md = generateFixtures(ids);
    const pairs: Record<string, number> = {};
    md.flat().forEach((m) => {
      const key = [m.home, m.away].sort().join("-");
      pairs[key] = (pairs[key] ?? 0) + 1;
    });
    const expectedPairs = (ids.length * (ids.length - 1)) / 2;
    expect(Object.keys(pairs)).toHaveLength(expectedPairs);
    Object.values(pairs).forEach((count) => expect(count).toBe(2));
  });
  it("each pair plays once at home, once away", () => {
    const ids = ["A", "B", "C", "D"];
    const md = generateFixtures(ids);
    const ordered: Record<string, number> = {};
    md.flat().forEach((m) => {
      const key = m.home + "->" + m.away;
      ordered[key] = (ordered[key] ?? 0) + 1;
    });
    Object.values(ordered).forEach((count) => expect(count).toBe(1));
  });
  it("no self-pairings", () => {
    const ids = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const md = generateFixtures(ids);
    md.flat().forEach((m) => expect(m.home).not.toBe(m.away));
  });
  it("every team plays exactly (n-1)*2 matches", () => {
    const ids = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
    const md = generateFixtures(ids);
    const counts: Record<string, number> = {};
    md.flat().forEach((m) => {
      counts[m.home] = (counts[m.home] ?? 0) + 1;
      counts[m.away] = (counts[m.away] ?? 0) + 1;
    });
    ids.forEach((id) => expect(counts[id]).toBe((ids.length - 1) * 2));
  });
  it("edge case: 2 clubs", () => {
    const md = generateFixtures(["A", "B"], { shuffle: false });
    expect(md).toHaveLength(2);
    expect(md[0][0].home).toBe("A");
    expect(md[0][0].away).toBe("B");
    expect(md[1][0].home).toBe("B");
    expect(md[1][0].away).toBe("A");
  });
  it("edge case: 1 or 0 clubs returns empty", () => {
    expect(generateFixtures([])).toEqual([]);
    expect(generateFixtures(["A"])).toEqual([]);
  });
  it("every team plays equal home and away (the slot-0 H/A regression)", () => {
    const ids = Array.from({ length: 12 }, (_, i) => "c" + i);
    const md = generateFixtures(ids, { shuffle: false });
    const counts: Record<string, { H: number; A: number }> = {};
    ids.forEach((id) => {
      counts[id] = { H: 0, A: 0 };
    });
    md.flat().forEach((m) => {
      counts[m.home].H++;
      counts[m.away].A++;
    });
    ids.forEach((id) => {
      expect(counts[id].H).toBe(counts[id].A);
      expect(counts[id].H).toBe(ids.length - 1);
    });
  });
  it("shuffle keeps balance AND avoids extreme H/A runs (≥8 in a row)", () => {
    const ids = Array.from({ length: 12 }, (_, i) => "c" + i);
    const md = generateFixtures(ids, { rand: seededRand(12345) });
    const counts: Record<string, { H: number; A: number }> = {};
    ids.forEach((id) => {
      counts[id] = { H: 0, A: 0 };
    });
    md.flat().forEach((m) => {
      counts[m.home].H++;
      counts[m.away].A++;
    });
    ids.forEach((id) => expect(counts[id].H).toBe(counts[id].A));
    ids.forEach((id) => {
      const seq = md.map((round) => {
        const m = round.find((x) => x.home === id || x.away === id);
        return m && m.home === id ? "H" : "A";
      });
      let run = 1,
        maxRun = 1;
      for (let i = 1; i < seq.length; i++) {
        if (seq[i] === seq[i - 1]) {
          run++;
          maxRun = Math.max(maxRun, run);
        } else run = 1;
      }
      expect(maxRun).toBeLessThan(8);
    });
  });
  it("shuffle with a seed is deterministic", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const a = generateFixtures(ids, { rand: seededRand(99) });
    const b = generateFixtures(ids, { rand: seededRand(99) });
    expect(a.map((md) => md.map((m) => m.home + "-" + m.away))).toEqual(
      b.map((md) => md.map((m) => m.home + "-" + m.away)),
    );
  });
});

// ─── snakePickerId ──────────────────────────────────────────────────────────

describe("snakePickerId", () => {
  it("round 1 picks forward", () => {
    const order = ["A", "B", "C", "D"];
    expect(snakePickerId(order, 1, 1)).toBe("A");
    expect(snakePickerId(order, 1, 2)).toBe("B");
    expect(snakePickerId(order, 1, 3)).toBe("C");
    expect(snakePickerId(order, 1, 4)).toBe("D");
  });
  it("round 2 reverses", () => {
    const order = ["A", "B", "C", "D"];
    expect(snakePickerId(order, 2, 1)).toBe("D");
    expect(snakePickerId(order, 2, 2)).toBe("C");
    expect(snakePickerId(order, 2, 3)).toBe("B");
    expect(snakePickerId(order, 2, 4)).toBe("A");
  });
  it("round 3 goes forward again", () => {
    const order = ["A", "B", "C", "D"];
    expect(snakePickerId(order, 3, 1)).toBe("A");
    expect(snakePickerId(order, 3, 4)).toBe("D");
  });
  it("every manager picks once per round", () => {
    const order = ["A", "B", "C", "D", "E"];
    for (let r = 1; r <= 6; r++) {
      const picked = new Set<string | null>();
      for (let p = 1; p <= order.length; p++) {
        picked.add(snakePickerId(order, r, p));
      }
      expect(picked.size).toBe(order.length);
    }
  });
});

// ─── positionsNeeded ────────────────────────────────────────────────────────

describe("positionsNeeded", () => {
  it("empty squad needs all positions", () => {
    const need = positionsNeeded([], F433);
    expect(need.has("GK")).toBe(true);
    expect(need.has("DEF")).toBe(true);
    expect(need.has("MID")).toBe(true);
    expect(need.has("FWD")).toBe(true);
    expect(need.size).toBe(4);
  });
  it("full XI needs nothing", () => {
    const xi: CareerPlayer[] = [
      { name: "g", position: "GK" },
      ...Array(4).fill({ name: "d", position: "CB" }),
      ...Array(3).fill({ name: "m", position: "CM" }),
      ...Array(3).fill({ name: "f", position: "ST" }),
    ];
    expect(positionsNeeded(xi, F433).size).toBe(0);
  });
  it("signing 1 GK removes GK from needs", () => {
    const need = positionsNeeded([{ name: "g", position: "GK" }], F433);
    expect(need.has("GK")).toBe(false);
    expect(need.has("DEF")).toBe(true);
  });
  it("respects formation differences (4-4-2 vs 4-3-3)", () => {
    const xi: CareerPlayer[] = [
      { name: "g", position: "GK" },
      ...Array(4).fill({ name: "d", position: "CB" }),
      ...Array(3).fill({ name: "m", position: "CM" }),
      ...Array(2).fill({ name: "f", position: "ST" }),
    ];
    const need442 = positionsNeeded(xi, F442);
    expect(need442.size).toBe(1);
    expect(need442.has("MID")).toBe(true);
  });
  it("handles null squad", () => {
    expect(positionsNeeded(null, F433).size).toBe(4);
  });
  it("correctly buckets Unschlagbar's 10-position taxonomy", () => {
    const xi: CareerPlayer[] = [
      { name: "k", position: "GK" },
      { name: "lb", position: "LB" },
      { name: "rb", position: "RB" },
      { name: "cb", position: "CB" },
      { name: "cdm", position: "CDM" },
      { name: "cam", position: "CAM" },
      { name: "lw", position: "LW" },
      { name: "st", position: "ST" },
    ];
    const need = positionsNeeded(xi, F433);
    // Need 4 DEF, have 3 → need 1 more DEF
    expect(need.has("DEF")).toBe(true);
    expect(need.has("GK")).toBe(false);
    // Need 3 MID, have 2 → need 1 more MID
    expect(need.has("MID")).toBe(true);
    // Need 3 FWD, have 2 → need 1 more FWD
    expect(need.has("FWD")).toBe(true);
  });
});

// ─── pickScorer / pickAssister ──────────────────────────────────────────────

describe("pickScorer", () => {
  it("never returns null on a non-empty XI", () => {
    const rand = seededRand(99);
    for (let i = 0; i < 1000; i++) {
      const s = pickScorer(SAMPLE_XI, null, rand);
      expect(s).not.toBeNull();
    }
  });
  it("biases heavily to forwards over defenders", () => {
    const rand = seededRand(50);
    const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    const N = 10000;
    for (let i = 0; i < N; i++) {
      const s = pickScorer(SAMPLE_XI, null, rand)!;
      counts[simplifyPosition(s.position)]++;
    }
    expect(counts.FWD).toBeGreaterThan(counts.DEF * 5);
    expect(counts.MID).toBeGreaterThan(counts.GK * 10);
  });
  it("hot form boosts a player", () => {
    const rand = seededRand(77);
    const formMap = { "fwd a": 2.0 };
    const counts: Record<string, number> = { "Fwd A": 0, "Fwd B": 0 };
    const N = 10000;
    for (let i = 0; i < N; i++) {
      const s = pickScorer(SAMPLE_XI, formMap, rand)!;
      if (s.name === "Fwd A" || s.name === "Fwd B") counts[s.name]++;
    }
    expect(counts["Fwd A"]).toBeGreaterThan(counts["Fwd B"] * 1.2);
  });
  it("chemistry boosts a player", () => {
    const rand = seededRand(202);
    const xi: CareerPlayer[] = [
      { name: "Chem Striker", position: "ST", club: "X", era: "Y" },
      { name: "Mate", position: "ST", club: "X", era: "Y" },
      { name: "Solo Striker", position: "ST", club: "Z", era: "W" },
    ];
    const counts: Record<string, number> = { "Chem Striker": 0, "Solo Striker": 0 };
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const s = pickScorer(xi, null, rand)!;
      if (counts[s.name] !== undefined) counts[s.name]++;
    }
    expect(counts["Chem Striker"]).toBeGreaterThan(counts["Solo Striker"]);
  });
});

describe("pickAssister", () => {
  it("can return null (unassisted goals)", () => {
    const a = pickAssister(SAMPLE_XI, SAMPLE_XI[5], seededRand(1), 1.0);
    expect(a).toBeNull();
  });
  it("never picks the scorer", () => {
    const rand = seededRand(33);
    const scorer = SAMPLE_XI[5];
    for (let i = 0; i < 1000; i++) {
      const a = pickAssister(SAMPLE_XI, scorer, rand, 0);
      expect(a).not.toBe(scorer);
    }
  });
  it("MID heavily favoured over DEF", () => {
    const rand = seededRand(101);
    const counts = { MID: 0, FWD: 0, DEF: 0, GK: 0 };
    const N = 10000;
    const scorer = SAMPLE_XI[5];
    for (let i = 0; i < N; i++) {
      const a = pickAssister(SAMPLE_XI, scorer, rand, 0);
      if (a) counts[simplifyPosition(a.position)]++;
    }
    expect(counts.MID).toBeGreaterThan(counts.DEF * 3);
    expect(counts.FWD).toBeGreaterThan(counts.GK * 10);
  });
});

// ─── form mechanics ─────────────────────────────────────────────────────────

describe("form", () => {
  it("computeFormDelta: scorer/assister gets +1", () => {
    const d = computeFormDelta(
      { position: "ST" },
      { wasInvolved: true, gf: 2, ga: 1, currentForm: 0 },
    );
    expect(d).toBeGreaterThanOrEqual(1);
  });
  it("computeFormDelta: clean sheet for a defender = +1", () => {
    const d = computeFormDelta(
      { position: "CB" },
      { wasInvolved: false, gf: 1, ga: 0, currentForm: 0 },
    );
    expect(d).toBe(1);
  });
  it("computeFormDelta: clean sheet for a forward does NOT boost", () => {
    const d = computeFormDelta(
      { position: "ST" },
      { wasInvolved: false, gf: 1, ga: 0, currentForm: 0 },
    );
    expect(d).toBe(0);
  });
  it("computeFormDelta: heavy loss penalises uninvolved attackers", () => {
    const d = computeFormDelta(
      { position: "ST" },
      { wasInvolved: false, gf: 0, ga: 3, currentForm: 1 },
    );
    expect(d).toBe(-1);
  });
  it("computeFormDelta: GK conceding 3 takes a hit", () => {
    const d = computeFormDelta(
      { position: "GK" },
      { wasInvolved: false, gf: 0, ga: 3, currentForm: 0 },
    );
    expect(d).toBe(-1);
  });
  it("computeFormDelta: positive form decays without involvement", () => {
    const d = computeFormDelta(
      { position: "CM" },
      { wasInvolved: false, gf: 1, ga: 1, currentForm: 1.5 },
    );
    expect(d).toBe(-0.5);
  });
  it("computeFormDelta: negative form recovers without involvement", () => {
    const d = computeFormDelta(
      { position: "CM" },
      { wasInvolved: false, gf: 1, ga: 1, currentForm: -1.0 },
    );
    expect(d).toBe(0.5);
  });
  it("clampForm respects bounds", () => {
    expect(clampForm(5)).toBe(2);
    expect(clampForm(-5)).toBe(-2);
    expect(clampForm(1.4)).toBe(1.4);
  });
  it("crossedFormThreshold into hot", () => {
    expect(crossedFormThreshold(1.5, 2)).toBe("hot");
    expect(crossedFormThreshold(0, 1.8)).toBe("hot");
  });
  it("crossedFormThreshold into cold", () => {
    expect(crossedFormThreshold(-1, -2)).toBe("cold");
    expect(crossedFormThreshold(0, -1.8)).toBe("cold");
  });
  it("crossedFormThreshold: no crossing returns null", () => {
    expect(crossedFormThreshold(1.5, 1.6)).toBeNull();
    expect(crossedFormThreshold(2, 2)).toBeNull();
    expect(crossedFormThreshold(-2, -2)).toBeNull();
  });
});

// ─── standings, cup, demands, relegation ────────────────────────────────────

describe("sortStandings", () => {
  it("sorts by Pts descending", () => {
    const t = makeTable([
      ["a", 30],
      ["b", 50],
      ["c", 40],
    ]);
    const sorted = sortStandings(t).map(([id]) => id);
    expect(sorted).toEqual(["b", "c", "a"]);
  });
  it("tiebreaks on goal difference", () => {
    const t = makeTable([
      ["a", 30, 5],
      ["b", 30, 10],
    ]);
    const sorted = sortStandings(t).map(([id]) => id);
    expect(sorted).toEqual(["b", "a"]);
  });
});

describe("cupBracketSeeded", () => {
  it("top 8 seeded 1v8 / 2v7 / 3v6 / 4v5", () => {
    const t = makeTable([
      ["user", 50],
      ["ai2", 48],
      ["ai3", 45],
      ["ai4", 42],
      ["ai5", 40],
      ["ai6", 38],
      ["ai7", 35],
      ["ai8", 32],
      ["ai9", 28],
      ["ai10", 22],
    ]);
    const { qf, userOut, qualifiers } = cupBracketSeeded(t, "user");
    expect(qf).toHaveLength(4);
    expect(qualifiers).toEqual(["user", "ai2", "ai3", "ai4", "ai5", "ai6", "ai7", "ai8"]);
    expect(qf[0]).toEqual({ home: "user", away: "ai8" });
    expect(qf[1]).toEqual({ home: "ai2", away: "ai7" });
    expect(qf[2]).toEqual({ home: "ai3", away: "ai6" });
    expect(qf[3]).toEqual({ home: "ai4", away: "ai5" });
    expect(userOut).toBe(false);
  });
  it("user out of top 8 → userOut = true", () => {
    const t = makeTable([
      ["ai1", 50],
      ["ai2", 48],
      ["ai3", 45],
      ["ai4", 42],
      ["ai5", 40],
      ["ai6", 38],
      ["ai7", 35],
      ["ai8", 32],
      ["user", 22],
    ]);
    expect(cupBracketSeeded(t, "user").userOut).toBe(true);
  });
  it("6-club league makes a smaller bracket", () => {
    const t = makeTable([
      ["a", 50],
      ["b", 48],
      ["c", 45],
      ["d", 42],
      ["e", 40],
      ["f", 38],
    ]);
    expect(cupBracketSeeded(t, "a").qf).toHaveLength(3);
  });

  // Regression: user finished 2nd in the league but got bounced from
  // the cup. Root cause was a re-derived standings table in /career/cup
  // using a DIFFERENT pts formula than computeLeagueTable used. Test:
  // when standings put user at position 2 by points, qualifiers[1] is user
  // and they pair with seed 7 (1v8, 2v7, 3v6, 4v5).
  it("regression: user 2nd in league qualifies for the cup", () => {
    const t = makeTable([
      ["ai1", 53],
      ["user", 50],
      ["ai3", 47],
      ["ai4", 44],
      ["ai5", 41],
      ["ai6", 38],
      ["ai7", 35],
      ["ai8", 32],
      ["ai9", 28],
      ["ai10", 22],
      ["ai11", 18],
      ["ai12", 14],
    ]);
    const { qualifiers, qf, userOut } = cupBracketSeeded(t, "user");
    expect(userOut).toBe(false);
    expect(qualifiers).toEqual(["ai1", "user", "ai3", "ai4", "ai5", "ai6", "ai7", "ai8"]);
    expect(qualifiers[1]).toBe("user");
    // 2v7 pairing: user vs ai7
    expect(qf[1]).toEqual({ home: "user", away: "ai7" });
  });
});

describe("detectStarDemands", () => {
  it("only +2 form triggers a demand at default threshold", () => {
    const squad: CareerPlayer[] = [
      { name: "Cold Star", position: "ST" },
      { name: "Warm One", position: "CM" },
      { name: "Hot Boss", position: "ST" },
    ];
    const stats = {
      "cold star": { form: -2 },
      "warm one": { form: 1.5 },
      "hot boss": { form: 2 },
    };
    const demands = detectStarDemands(squad, stats);
    expect(demands).toHaveLength(1);
    expect(demands[0].name).toBe("Hot Boss");
  });
  it("custom threshold respected", () => {
    const squad: CareerPlayer[] = [{ name: "Warm", position: "CM" }];
    const stats = { warm: { form: 1.6 } };
    expect(detectStarDemands(squad, stats, 1.5)).toHaveLength(1);
    expect(detectStarDemands(squad, stats, 2)).toHaveLength(0);
  });
  it("missing stats are not demands", () => {
    const squad: CareerPlayer[] = [{ name: "No Stat", position: "ST" }];
    expect(detectStarDemands(squad, {})).toHaveLength(0);
  });
});

describe("detectRelegation", () => {
  it("returns bottom 2 ids in a 12-club league", () => {
    const t = makeTable([
      ["user", 60],
      ["ai1", 55],
      ["ai2", 50],
      ["ai3", 45],
      ["ai4", 40],
      ["ai5", 38],
      ["ai6", 35],
      ["ai7", 30],
      ["ai8", 25],
      ["ai9", 20],
      ["flop1", 12],
      ["flop2", 8],
    ]);
    const { relegatedIds, userRelegated } = detectRelegation(t, "user");
    expect(relegatedIds).toEqual(["flop1", "flop2"]);
    expect(userRelegated).toBe(false);
  });
  it("detects when user is in the zone", () => {
    const t = makeTable([
      ["ai1", 60],
      ["ai2", 55],
      ["ai3", 50],
      ["ai4", 45],
      ["ai5", 40],
      ["ai6", 38],
      ["ai7", 35],
      ["ai8", 30],
      ["ai9", 25],
      ["ai10", 20],
      ["user", 15],
      ["flop", 8],
    ]);
    const { relegatedIds, userRelegated } = detectRelegation(t, "user");
    expect(relegatedIds.sort()).toEqual(["flop", "user"]);
    expect(userRelegated).toBe(true);
  });
  it("skipped in small leagues", () => {
    const t = makeTable([
      ["a", 50],
      ["b", 40],
      ["c", 30],
      ["d", 20],
      ["e", 10],
      ["f", 5],
      ["g", 4],
      ["h", 3],
    ]);
    const { relegatedIds, userRelegated } = detectRelegation(t, "a");
    expect(relegatedIds).toEqual([]);
    expect(userRelegated).toBe(false);
  });
});

// ─── buildAIManagers (the 12-club regression suite) ─────────────────────────

const FAKE_ARCHETYPES: Archetype[] = [
  { name: "Galáctico", style: "galactico" },
  { name: "Pragmatist", style: "pragmatist" },
  { name: "Romantic", style: "romantic" },
  { name: "Hipster", style: "hipster" },
  { name: "Brick Wall", style: "brickwall" },
  { name: "Goal Machine", style: "goals" },
  { name: "Old-School", style: "oldschool" },
];
const FAKE_CLUBS: FoundingClub[] = Array.from({ length: 30 }, (_, i) => ({
  name: "Club" + i,
  letter: String.fromCharCode(65 + (i % 26)),
  bg: "#000000",
  fg: "#ffffff",
}));

describe("buildAIManagers", () => {
  it("requests 11, returns 11 (the 12-club bug regression)", () => {
    const ais = buildAIManagers(11, "Club0", FAKE_ARCHETYPES, FAKE_CLUBS);
    expect(ais).toHaveLength(11);
  });
  it("small leagues still work (n=3, 5, 7)", () => {
    for (const n of [3, 5, 7]) {
      expect(buildAIManagers(n, "Club0", FAKE_ARCHETYPES, FAKE_CLUBS)).toHaveLength(n);
    }
  });
  it("each manager has a unique founding club", () => {
    const ais = buildAIManagers(11, "Club0", FAKE_ARCHETYPES, FAKE_CLUBS);
    const clubs = new Set(ais.map((m) => m.foundingClub));
    expect(clubs.size).toBe(ais.length);
  });
  it("user club is never assigned", () => {
    const ais = buildAIManagers(11, "Club5", FAKE_ARCHETYPES, FAKE_CLUBS);
    ais.forEach((m) => expect(m.foundingClub).not.toBe("Club5"));
  });
  it("archetypes recycle when n > available archetypes", () => {
    const ais = buildAIManagers(11, "Club0", FAKE_ARCHETYPES, FAKE_CLUBS);
    const counts: Record<string, number> = {};
    ais.forEach((m) => {
      counts[m.archetype] = (counts[m.archetype] ?? 0) + 1;
    });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(11);
    expect(Math.max(...Object.values(counts))).toBeGreaterThanOrEqual(2);
  });
  it("every manager has id, name, badge, colour, empty squad", () => {
    const ais = buildAIManagers(11, "Club0", FAKE_ARCHETYPES, FAKE_CLUBS);
    ais.forEach((m) => {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.badge).toBeTruthy();
      expect(m.colour).toBeTruthy();
      expect(m.isUser).toBe(false);
      expect(m.squad).toEqual([]);
      expect(m.archetype).toBeTruthy();
    });
  });
  it("degenerate inputs handled safely", () => {
    expect(buildAIManagers(0, "X", FAKE_ARCHETYPES, FAKE_CLUBS)).toEqual([]);
    expect(buildAIManagers(-1, "X", FAKE_ARCHETYPES, FAKE_CLUBS)).toEqual([]);
    expect(buildAIManagers(5, "X", [], FAKE_CLUBS)).toEqual([]);
    expect(buildAIManagers(5, "X", FAKE_ARCHETYPES, [])).toEqual([]);
  });
  it("cannot exceed available clubs", () => {
    const tinyClubs = FAKE_CLUBS.slice(0, 3);
    const ais = buildAIManagers(10, "Club0", FAKE_ARCHETYPES, tinyClubs);
    expect(ais.length).toBeLessThanOrEqual(2);
    const clubs = new Set(ais.map((m) => m.foundingClub));
    expect(clubs.size).toBe(ais.length);
  });
  it("deterministic with a seeded random source", () => {
    const a = buildAIManagers(11, "Club0", FAKE_ARCHETYPES, FAKE_CLUBS, seededRand(123));
    const b = buildAIManagers(11, "Club0", FAKE_ARCHETYPES, FAKE_CLUBS, seededRand(123));
    expect(a.map((m) => m.foundingClub)).toEqual(b.map((m) => m.foundingClub));
    expect(a.map((m) => m.archetype)).toEqual(b.map((m) => m.archetype));
  });
});

// ─── chemistry ──────────────────────────────────────────────────────────────

describe("chemistry", () => {
  it("a duo from same club+era gets 0.5 each", () => {
    const squad: CareerPlayer[] = [
      { name: "Messi", position: "ST", club: "Barcelona", era: "2010s" },
      { name: "Xavi", position: "CM", club: "Barcelona", era: "2010s" },
      { name: "Buffon", position: "GK", club: "Juventus", era: "2000s" },
    ];
    const chem = computeChemistry(squad);
    expect(chem["messi"]).toBe(0.5);
    expect(chem["xavi"]).toBe(0.5);
    expect(chem["buffon"]).toBeUndefined();
  });
  it("a trio+ gets 1.0 each", () => {
    const squad: CareerPlayer[] = [
      { name: "Messi", position: "ST", club: "Barcelona", era: "2010s" },
      { name: "Xavi", position: "CM", club: "Barcelona", era: "2010s" },
      { name: "Iniesta", position: "CM", club: "Barcelona", era: "2010s" },
      { name: "Suarez", position: "ST", club: "Barcelona", era: "2010s" },
    ];
    const chem = computeChemistry(squad);
    expect(chem["messi"]).toBe(1.0);
    expect(chem["iniesta"]).toBe(1.0);
    expect(chem["suarez"]).toBe(1.0);
  });
  it("same club but different era = no chemistry", () => {
    const squad: CareerPlayer[] = [
      { name: "Messi", position: "ST", club: "Barcelona", era: "2010s" },
      { name: "Ronaldinho", position: "ST", club: "Barcelona", era: "2000s" },
    ];
    expect(Object.keys(computeChemistry(squad))).toHaveLength(0);
  });
  it("players missing club/era are ignored", () => {
    const squad: CareerPlayer[] = [
      { name: "Mystery A", position: "ST" },
      { name: "Mystery B", position: "CM" },
    ];
    expect(Object.keys(computeChemistry(squad))).toHaveLength(0);
  });
  it("empty/null squad returns empty map", () => {
    expect(computeChemistry([])).toEqual({});
    expect(computeChemistry(null)).toEqual({});
  });
  it("chemistryGroups: returns display-ready groups sorted by size", () => {
    const squad: CareerPlayer[] = [
      { name: "Messi", position: "ST", club: "Barcelona", era: "2010s" },
      { name: "Xavi", position: "CM", club: "Barcelona", era: "2010s" },
      { name: "Iniesta", position: "CM", club: "Barcelona", era: "2010s" },
      { name: "Kaka", position: "CM", club: "AC Milan", era: "2000s" },
      { name: "Nesta", position: "CB", club: "AC Milan", era: "2000s" },
      { name: "Buffon", position: "GK", club: "Juventus", era: "2000s" },
    ];
    const groups = chemistryGroups(squad);
    expect(groups).toHaveLength(2);
    expect(groups[0].players).toHaveLength(3);
    expect(groups[0].bonus).toBe(1.0);
    expect(groups[1].players).toHaveLength(2);
    expect(groups[1].bonus).toBe(0.5);
  });
});

// ─── Unschlagbar adapters ───────────────────────────────────────────────────

describe("eraFromCareerYears", () => {
  it("maps career start year to the right era tier", () => {
    expect(eraFromCareerYears("1975-1985")).toBe("70s-80s");
    expect(eraFromCareerYears("1992-1998")).toBe("90s");
    expect(eraFromCareerYears("2005-2014")).toBe("00s");
    expect(eraFromCareerYears("2018-2024")).toBe("current");
  });
  it("uses the earliest year when multiple appear (split careers)", () => {
    expect(eraFromCareerYears("1984-1988, 1992-2000")).toBe("70s-80s");
  });
  it("returns empty for missing or malformed input", () => {
    expect(eraFromCareerYears(undefined)).toBe("");
    expect(eraFromCareerYears("")).toBe("");
    expect(eraFromCareerYears("no years here")).toBe("");
  });
});

describe("DEFAULT_ARCHETYPES", () => {
  it("ships exactly 7 archetypes (the GOLAZO canonical set)", () => {
    expect(DEFAULT_ARCHETYPES).toHaveLength(7);
  });
  it("every archetype has name, style, and description", () => {
    DEFAULT_ARCHETYPES.forEach((a) => {
      expect(a.name).toBeTruthy();
      expect(a.style).toBeTruthy();
      expect(a.description).toBeTruthy();
    });
  });
});

describe("scorePlayerByArchetype", () => {
  function mockP(overrides: Partial<Player> = {}): Player {
    return {
      name: "Test Player",
      position: "ST",
      prime_rating: 80,
      career_years: "2015-2025",
      nationality: "Germany",
      ...overrides,
    } as Player;
  }
  const noNeed = new Set<"GK" | "DEF" | "MID" | "FWD">();
  const needFWD = new Set<"GK" | "DEF" | "MID" | "FWD">(["FWD"]);

  it("galactico boosts elite (≥92) over mid-tier players massively", () => {
    const elite = mockP({ prime_rating: 95 });
    const mid = mockP({ prime_rating: 85 });
    const elScore = scorePlayerByArchetype(elite, "galactico", noNeed);
    const midScore = scorePlayerByArchetype(mid, "galactico", noNeed);
    expect(elScore).toBeGreaterThan(midScore + 5);
  });

  it("pragmatist heavily favors filling positional needs", () => {
    const player = mockP({ position: "ST" });
    const withNeed = scorePlayerByArchetype(player, "pragmatist", needFWD);
    const withoutNeed = scorePlayerByArchetype(player, "pragmatist", noNeed);
    expect(withNeed).toBeGreaterThan(withoutNeed + 10);
  });

  it("romantic bumps South Americans", () => {
    const samerican = mockP({ nationality: "Brazil" });
    const european = mockP({ nationality: "Germany" });
    const sScore = scorePlayerByArchetype(samerican, "romantic", noNeed);
    const eScore = scorePlayerByArchetype(european, "romantic", noNeed);
    expect(sScore).toBeGreaterThan(eScore + 5);
  });

  it("brickwall picks defenders over forwards", () => {
    const gk = mockP({ position: "GK", prime_rating: 80 });
    const cb = mockP({ position: "CB", prime_rating: 80 });
    const st = mockP({ position: "ST", prime_rating: 80 });
    expect(scorePlayerByArchetype(gk, "brickwall", noNeed)).toBeGreaterThan(
      scorePlayerByArchetype(st, "brickwall", noNeed),
    );
    expect(scorePlayerByArchetype(cb, "brickwall", noNeed)).toBeGreaterThan(
      scorePlayerByArchetype(st, "brickwall", noNeed),
    );
  });

  it("goals favors forwards over midfielders over defenders", () => {
    const fwd = mockP({ position: "ST", prime_rating: 80 });
    const mid = mockP({ position: "CM", prime_rating: 80 });
    const def = mockP({ position: "CB", prime_rating: 80 });
    expect(scorePlayerByArchetype(fwd, "goals", noNeed)).toBeGreaterThan(
      scorePlayerByArchetype(mid, "goals", noNeed),
    );
    expect(scorePlayerByArchetype(mid, "goals", noNeed)).toBeGreaterThan(
      scorePlayerByArchetype(def, "goals", noNeed),
    );
  });

  it("oldschool bumps pre-2000 players over modern ones", () => {
    const old = mockP({ career_years: "1985-1997" });
    const modern = mockP({ career_years: "2018-2025" });
    expect(scorePlayerByArchetype(old, "oldschool", noNeed)).toBeGreaterThan(
      scorePlayerByArchetype(modern, "oldschool", noNeed) + 5,
    );
  });

  it("unknown archetype style returns OVR with only need-bump", () => {
    const player = mockP();
    expect(scorePlayerByArchetype(player, "totally-fake-style", noNeed)).toBe(player.prime_rating);
  });
});

describe("fromPlayer", () => {
  it("converts Unschlagbar's Player to a CareerPlayer with derived era", () => {
    const result = fromPlayer({
      name: "Toni Kroos",
      position: "CM",
      prime_rating: 91,
      career_years: "2014-2024",
      nationality: "Germany",
      club: "realmadrid",
    });
    expect(result).toEqual({
      name: "Toni Kroos",
      position: "CM",
      club: "realmadrid",
      era: "00s", // 2014 falls in 00s tier per draft.tsx's TIER_YEAR_RANGES
    });
  });
});
