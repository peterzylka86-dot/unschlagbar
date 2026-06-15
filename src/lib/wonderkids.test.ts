import { describe, it, expect } from "vitest";
import {
  WONDERKID_ICONS,
  youngRating,
  growthTier,
  growStep,
  declineStep,
  seasonLottery,
  rivalClaim,
  unclaimedIcons,
  bidWinChance,
  bidOddsLabel,
  resolveBid,
  ageStep,
  WK_DECLINE_START_AGE,
  WK_RATING_FLOOR,
} from "./wonderkids";

const pele = WONDERKID_ICONS.find((i) => i.id === "pele")!;

describe("icon pool", () => {
  it("has unique ids and plausible primes", () => {
    const ids = WONDERKID_ICONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of WONDERKID_ICONS) {
      expect(i.prime).toBeGreaterThanOrEqual(88);
      expect(i.prime).toBeLessThanOrEqual(99);
    }
  });
});

describe("youngRating", () => {
  it("starts a prospect well below prime (~64%)", () => {
    const y = youngRating(pele); // 96 * 0.64 = 61.44 → 61
    expect(y).toBe(61);
    expect(y).toBeLessThan(pele.prime);
  });
});

describe("growthTier", () => {
  it("classifies by share of matchdays started", () => {
    expect(growthTier(20, 22)).toBe("starter");
    expect(growthTier(11, 22)).toBe("rotation");
    expect(growthTier(4, 22)).toBe("bench");
  });
});

describe("growStep", () => {
  it("is deterministic", () => {
    expect(growStep(61, 96, "starter", "p-s1")).toBe(growStep(61, 96, "starter", "p-s1"));
  });

  it("never exceeds prime", () => {
    expect(growStep(95, 96, "starter", "x")).toBeLessThanOrEqual(96);
    expect(growStep(96, 96, "starter", "x")).toBe(96);
  });

  it("a starter grows faster than a benched prospect", () => {
    // Average growth across many seeds: starter clearly out-develops bench.
    const avg = (tier: "starter" | "bench") => {
      let sum = 0;
      for (let s = 0; s < 40; s++) sum += growStep(70, 96, tier, `seed-${s}`) - 70;
      return sum / 40;
    };
    expect(avg("starter")).toBeGreaterThan(avg("bench"));
  });

  it("a regular starter reaches prime within ~6 seasons", () => {
    let r = youngRating(pele);
    for (let season = 1; season <= 6; season++) r = growStep(r, pele.prime, "starter", `pele-${season}`);
    expect(r).toBe(pele.prime);
  });

  it("a benched prospect stays well short after 6 seasons", () => {
    let r = youngRating(pele);
    for (let season = 1; season <= 6; season++) r = growStep(r, pele.prime, "bench", `pele-${season}`);
    expect(r).toBeLessThan(pele.prime - 10);
  });
});

describe("declineStep", () => {
  it("does not decline before 30", () => {
    expect(declineStep(96, WK_DECLINE_START_AGE - 1, "x")).toBe(96);
  });

  it("declines from 30 and is floored", () => {
    expect(declineStep(96, 31, "x")).toBeLessThan(96);
    expect(declineStep(71, 36, "x")).toBeGreaterThanOrEqual(WK_RATING_FLOOR);
  });
});

describe("seasonLottery", () => {
  it("is deterministic", () => {
    expect(seasonLottery("seedA", 3, [])).toEqual(seasonLottery("seedA", 3, []));
  });

  it("surfaces icons roughly a tenth of seasons over a long run", () => {
    let hits = 0;
    for (let s = 1; s <= 300; s++) if (seasonLottery("careerX", s, [])) hits++;
    // ~10% expected; allow a wide deterministic band.
    expect(hits).toBeGreaterThan(15);
    expect(hits).toBeLessThan(60);
  });

  it("never returns an already-claimed icon", () => {
    const claimed = WONDERKID_ICONS.map((i) => i.id).filter((id) => id !== "pele");
    for (let s = 1; s <= 200; s++) {
      const drawn = seasonLottery("careerY", s, claimed);
      if (drawn) expect(drawn.id).toBe("pele");
    }
  });

  it("returns null once the pool is exhausted", () => {
    const all = WONDERKID_ICONS.map((i) => i.id);
    expect(seasonLottery("careerZ", 5, all)).toBeNull();
  });
});

describe("rivalClaim", () => {
  it("never fires in a season you landed an icon", () => {
    expect(rivalClaim("c", 2, [], pele)).toBeNull();
  });

  it("is deterministic and draws only from the unclaimed pool", () => {
    const claimed = WONDERKID_ICONS.map((i) => i.id).filter((id) => id !== "messi");
    const a = rivalClaim("c", 7, claimed, null);
    const b = rivalClaim("c", 7, claimed, null);
    expect(a).toEqual(b);
    if (a) expect(a.id).toBe("messi");
  });

  it("can drain the pool over many seasons", () => {
    const claimed: string[] = [];
    for (let s = 1; s <= 400 && claimed.length < WONDERKID_ICONS.length; s++) {
      const got = rivalClaim("drainer", s, claimed, null);
      if (got) claimed.push(got.id);
    }
    expect(claimed.length).toBeGreaterThan(0);
    expect(unclaimedIcons(claimed).length).toBeLessThan(WONDERKID_ICONS.length);
  });
});

describe("ageStep (general player ageing)", () => {
  it("a teen prospect climbs fast as a starter", () => {
    let r = 61;
    for (let s = 1; s <= 6; s++) r = ageStep(r, 16 + s, 96, "starter", `p-${s}`);
    expect(r).toBeGreaterThan(88); // reaches near-peak in ~5-6 seasons
    expect(r).toBeLessThanOrEqual(96);
  });

  it("a near-peak mid-20s player only inches up", () => {
    const next = ageStep(91, 26, 94, "starter", "x");
    expect(next).toBeGreaterThanOrEqual(91);
    expect(next).toBeLessThanOrEqual(93); // not a one-season leap to ceiling
  });

  it("a benched youngster grows far slower than a starter", () => {
    const starter = ageStep(70, 18, 90, "starter", "s");
    const benched = ageStep(70, 18, 90, "bench", "s");
    expect(starter).toBeGreaterThan(benched);
  });

  it("never exceeds the ceiling", () => {
    expect(ageStep(95, 19, 96, "starter", "x")).toBeLessThanOrEqual(96);
    expect(ageStep(96, 19, 96, "starter", "x")).toBe(96);
  });

  it("declines past 30", () => {
    expect(ageStep(90, 33, 95, "starter", "x")).toBeLessThan(90);
  });

  it("is deterministic", () => {
    expect(ageStep(70, 20, 90, "starter", "k")).toBe(ageStep(70, 20, 90, "starter", "k"));
  });
});

describe("bidding war", () => {
  it("bidWinChance rises with the staked player's rating and is clamped", () => {
    expect(bidWinChance(60)).toBe(0.1);
    expect(bidWinChance(99)).toBeLessThanOrEqual(0.9);
    expect(bidWinChance(90)).toBeGreaterThan(bidWinChance(75));
  });

  it("bidOddsLabel spans long shot → strong", () => {
    expect(bidOddsLabel(70)).toBe("long shot");
    expect(bidOddsLabel(95)).toBe("strong");
  });

  it("resolveBid is deterministic for the same bid", () => {
    expect(resolveBid("c", 4, "pele", 88)).toBe(resolveBid("c", 4, "pele", 88));
  });

  it("a marquee stake wins far more often than a fringe stake", () => {
    let starWins = 0;
    let scrubWins = 0;
    for (let s = 1; s <= 100; s++) {
      if (resolveBid("careerX", s, "pele", 95)) starWins++;
      if (resolveBid("careerX", s, "pele", 70)) scrubWins++;
    }
    expect(starWins).toBeGreaterThan(scrubWins);
  });
});
