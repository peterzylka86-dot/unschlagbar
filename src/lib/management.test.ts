import { describe, it, expect } from "vitest";
import {
  deriveMorale,
  averageMorale,
  moraleRatingKick,
  moraleBadge,
  MORALE_NEUTRAL,
  talkEffect,
  boardExpectation,
  deriveConfidence,
} from "./management";

type M = { outcome: "W" | "D" | "L"; ourScore: number; theirScore: number };
const W = (gf = 2, ga = 0): M => ({ outcome: "W", ourScore: gf, theirScore: ga });
const L = (gf = 0, ga = 2): M => ({ outcome: "L", ourScore: gf, theirScore: ga });

describe("deriveMorale", () => {
  const squad = ["c:A", "c:B", "c:C"];
  const xi = ["c:A", "c:B"]; // C is benched every week

  it("starts everyone at neutral with no matches", () => {
    const m = deriveMorale({ squadKeys: squad, matches: [], lineups: [], talkMoraleDeltas: [] });
    expect(m["c:A"]).toBe(MORALE_NEUTRAL);
  });

  it("starts a shopped-around (unsettled) player below neutral", () => {
    const m = deriveMorale({
      squadKeys: squad,
      matches: [],
      lineups: [],
      talkMoraleDeltas: [],
      unsettledKeys: ["c:B"],
    });
    expect(m["c:B"]).toBeLessThan(m["c:A"]);
    expect(m["c:B"]).toBeLessThan(42); // shows in the "unsettled" panel
  });

  it("is deterministic", () => {
    const args = { squadKeys: squad, matches: [W(), W()], lineups: [xi, xi], talkMoraleDeltas: [2, 2] };
    expect(deriveMorale(args)).toEqual(deriveMorale(args));
  });

  it("lifts starters on a winning run", () => {
    const m = deriveMorale({
      squadKeys: squad,
      matches: [W(3, 0), W(2, 0), W(1, 0)],
      lineups: [xi, xi, xi],
      talkMoraleDeltas: [2, 2, 2],
    });
    expect(m["c:A"]).toBeGreaterThan(MORALE_NEUTRAL);
  });

  it("sinks starters on a losing run, harder on hidings", () => {
    const m = deriveMorale({
      squadKeys: squad,
      matches: [L(0, 4), L(0, 3), L(0, 2)],
      lineups: [xi, xi, xi],
      talkMoraleDeltas: [0, 0, 0],
    });
    expect(m["c:A"]).toBeLessThan(MORALE_NEUTRAL);
  });

  it("frustrates a permanently benched player below the starters", () => {
    const m = deriveMorale({
      squadKeys: squad,
      matches: [W(), W(), W(), W()],
      lineups: [xi, xi, xi, xi],
      talkMoraleDeltas: [2, 2, 2, 2],
    });
    expect(m["c:C"]).toBeLessThan(m["c:A"]);
  });

  it("keeps morale within bounds under a long collapse", () => {
    const matches = Array.from({ length: 30 }, () => L(0, 5));
    const lineups = matches.map(() => xi);
    const m = deriveMorale({ squadKeys: squad, matches, lineups, talkMoraleDeltas: matches.map(() => -4) });
    expect(m["c:A"]).toBeGreaterThanOrEqual(0);
  });
});

describe("morale helpers", () => {
  it("averageMorale falls back to neutral for an empty XI", () => {
    expect(averageMorale({}, [])).toBe(MORALE_NEUTRAL);
  });

  it("moraleRatingKick is bounded ±2 and signed by morale", () => {
    expect(moraleRatingKick(100)).toBe(2);
    expect(moraleRatingKick(0)).toBe(-2);
    expect(moraleRatingKick(MORALE_NEUTRAL)).toBe(0);
  });

  it("moraleBadge ranges from mutinous to flying", () => {
    expect(moraleBadge(95).label).toBe("flying");
    expect(moraleBadge(10).label).toBe("mutinous");
  });
});

describe("talkEffect", () => {
  it("calm is a safe small lift", () => {
    const e = talkEffect("calm", 60, false);
    expect(e.ratingDelta).toBeGreaterThan(0);
    expect(e.moraleDelta).toBeGreaterThan(0);
  });

  it("fire rewards a confident squad", () => {
    const e = talkEffect("fire", 70, false);
    expect(e.ratingDelta).toBeGreaterThan(0);
  });

  it("fire backfires on a fragile squad", () => {
    const e = talkEffect("fire", 40, false);
    expect(e.ratingDelta).toBeLessThan(0);
    expect(e.moraleDelta).toBeLessThan(0);
  });

  it("bus pays off only as the underdog", () => {
    expect(talkEffect("bus", 60, true).ratingDelta).toBeGreaterThan(0);
    expect(talkEffect("bus", 60, false).ratingDelta).toBe(0);
  });
});

describe("boardExpectation", () => {
  it("demands the title when you're the strongest", () => {
    const e = boardExpectation(90, [80, 78, 75]);
    expect(e.targetPosition).toBe(1);
    expect(e.label.toLowerCase()).toContain("league");
  });

  it("expects survival when you're the weakest", () => {
    const e = boardExpectation(70, [85, 84, 83, 82, 81]);
    expect(e.targetPosition).toBe(6);
    expect(e.label.toLowerCase()).toContain("survival");
  });
});

describe("deriveConfidence", () => {
  it("starts mid and is deterministic", () => {
    const a = deriveConfidence({ matches: [], targetPosition: 5, currentPosition: 0 });
    const b = deriveConfidence({ matches: [], targetPosition: 5, currentPosition: 0 });
    expect(a).toEqual(b);
    expect(a.tone).toBe("backed");
  });

  it("a winning run + overachieving position adores you", () => {
    const c = deriveConfidence({
      matches: Array.from({ length: 8 }, () => W(2, 0)),
      targetPosition: 6,
      currentPosition: 1,
    });
    expect(c.value).toBeGreaterThanOrEqual(75);
    expect(c.tone).toBe("adored");
  });

  it("a losing run below the brief triggers a vote of confidence", () => {
    const c = deriveConfidence({
      matches: Array.from({ length: 8 }, () => L(0, 3)),
      targetPosition: 2,
      currentPosition: 12,
    });
    expect(c.threatened).toBe(true);
    expect(c.tone).toBe("threat");
  });

  it("clamps to 0..100", () => {
    const lo = deriveConfidence({ matches: Array.from({ length: 30 }, () => L(0, 5)), targetPosition: 1, currentPosition: 18 });
    const hi = deriveConfidence({ matches: Array.from({ length: 30 }, () => W(5, 0)), targetPosition: 18, currentPosition: 1 });
    expect(lo.value).toBeGreaterThanOrEqual(0);
    expect(hi.value).toBeLessThanOrEqual(100);
  });
});
