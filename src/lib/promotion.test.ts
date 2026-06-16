import { describe, it, expect } from "vitest";
import {
  leagueAbove,
  leagueBelow,
  promotionOutcome,
  isPlayoff,
  twoLegPlayoff,
} from "./promotion";

describe("tier ladder", () => {
  it("maps second tiers up and top tiers down", () => {
    expect(leagueAbove("de2")).toBe("de1");
    expect(leagueAbove("it2")).toBe("it1");
    expect(leagueBelow("es1")).toBe("es2");
    // Single-tier leagues have no neighbour.
    expect(leagueAbove("en1")).toBeNull();
    expect(leagueBelow("en1")).toBeNull();
    expect(leagueBelow("de2")).toBeNull();
    expect(leagueAbove("de1")).toBeNull();
  });
});

describe("promotionOutcome", () => {
  it("second tier: top 2 auto-promote, 3rd to the playoff", () => {
    expect(promotionOutcome("de2", 1, 18)).toBe("promoted");
    expect(promotionOutcome("de2", 2, 18)).toBe("promoted");
    expect(promotionOutcome("de2", 3, 18)).toBe("promotion-playoff");
    expect(promotionOutcome("de2", 4, 18)).toBe("safe");
  });

  it("top tier: bottom 2 auto-relegate, 3rd-from-bottom to the playoff", () => {
    expect(promotionOutcome("de1", 18, 18)).toBe("relegated");
    expect(promotionOutcome("de1", 17, 18)).toBe("relegated");
    expect(promotionOutcome("de1", 16, 18)).toBe("relegation-playoff");
    expect(promotionOutcome("de1", 15, 18)).toBe("safe");
    expect(promotionOutcome("de1", 1, 18)).toBe("safe");
  });

  it("scales to a 20-team top tier", () => {
    expect(promotionOutcome("it1", 20, 20)).toBe("relegated");
    expect(promotionOutcome("it1", 19, 20)).toBe("relegated");
    expect(promotionOutcome("it1", 18, 20)).toBe("relegation-playoff");
    expect(promotionOutcome("it1", 17, 20)).toBe("safe");
  });

  it("single-tier leagues never move", () => {
    expect(promotionOutcome("en1", 20, 20)).toBe("safe");
    expect(promotionOutcome("ch1", 12, 12)).toBe("safe");
    expect(promotionOutcome("fr1", 1, 18)).toBe("safe");
  });

  it("flags which outcomes need a playoff", () => {
    expect(isPlayoff("promotion-playoff")).toBe(true);
    expect(isPlayoff("relegation-playoff")).toBe(true);
    expect(isPlayoff("promoted")).toBe(false);
    expect(isPlayoff("safe")).toBe(false);
  });
});

describe("twoLegPlayoff", () => {
  it("is deterministic and plays two legs", () => {
    const a = twoLegPlayoff(80, 78, "seed-1");
    const b = twoLegPlayoff(80, 78, "seed-1");
    expect(a).toEqual(b);
    expect(a.aggUs).toBe(a.leg1[0] + a.leg2[0]);
    expect(a.aggThem).toBe(a.leg1[1] + a.leg2[1]);
  });

  it("a clearly stronger side usually goes through", () => {
    let wins = 0;
    for (let i = 0; i < 40; i++) if (twoLegPlayoff(88, 70, `s${i}`).won) wins++;
    expect(wins).toBeGreaterThan(28); // heavy favourite
  });

  it("never reports a level tie as undecided", () => {
    for (let i = 0; i < 20; i++) {
      const r = twoLegPlayoff(78, 78, `t${i}`);
      if (r.aggUs === r.aggThem) expect(typeof r.won).toBe("boolean");
    }
  });
});
