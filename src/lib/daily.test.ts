/**
 * Tests for the Daily Challenge primitives.
 *
 * The seed function MUST be timezone-stable — a player in Berlin and a
 * player in Tokyo at the same moment must get the same seed. Otherwise
 * the daily H2H comparison is nonsense. Pinned by tests below.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  dailySeed,
  dailyDateLabel,
  isToday,
  saveDaily,
  getDaily,
  getAllDailyResults,
  getDailyStreak,
  __clearDailyStore,
} from "./daily";

describe("dailySeed()", () => {
  it("encodes a date as YYYYMMDD", () => {
    // Use Date.UTC so the test isn't affected by the machine's local TZ.
    const d = new Date(Date.UTC(2026, 5, 8, 12, 0, 0)); // June 8, 2026 (months 0-indexed)
    expect(dailySeed(d)).toBe(20260608);
  });

  it("is stable across the hour-of-day on the same UTC date", () => {
    // Midnight and 23:59 of the same UTC day produce the same seed.
    const morning = new Date(Date.UTC(2026, 5, 8, 0, 0, 1));
    const night = new Date(Date.UTC(2026, 5, 8, 23, 59, 59));
    expect(dailySeed(morning)).toBe(dailySeed(night));
  });

  it("changes across UTC day boundary", () => {
    const d1 = new Date(Date.UTC(2026, 5, 8, 23, 0, 0));
    const d2 = new Date(Date.UTC(2026, 5, 9, 1, 0, 0));
    expect(dailySeed(d1)).not.toBe(dailySeed(d2));
    expect(dailySeed(d2) - dailySeed(d1)).toBe(1); // 20260609 - 20260608
  });

  it("handles month rollovers", () => {
    const lastJune = new Date(Date.UTC(2026, 5, 30));
    const firstJuly = new Date(Date.UTC(2026, 6, 1));
    expect(dailySeed(lastJune)).toBe(20260630);
    expect(dailySeed(firstJuly)).toBe(20260701);
  });

  it("handles year rollovers", () => {
    const dec31 = new Date(Date.UTC(2026, 11, 31));
    const jan01 = new Date(Date.UTC(2027, 0, 1));
    expect(dailySeed(dec31)).toBe(20261231);
    expect(dailySeed(jan01)).toBe(20270101);
  });
});

describe("dailyDateLabel()", () => {
  it("round-trips dailySeed → label", () => {
    expect(dailyDateLabel(20260608)).toBe("2026-06-08");
    expect(dailyDateLabel(20261231)).toBe("2026-12-31");
    expect(dailyDateLabel(20270101)).toBe("2027-01-01");
  });

  it("pads single-digit months and days", () => {
    expect(dailyDateLabel(20260101)).toBe("2026-01-01");
    expect(dailyDateLabel(20260909)).toBe("2026-09-09");
  });
});

describe("isToday()", () => {
  it("matches the seed for the supplied 'now'", () => {
    const now = new Date(Date.UTC(2026, 5, 8));
    expect(isToday(20260608, now)).toBe(true);
    expect(isToday(20260607, now)).toBe(false);
    expect(isToday(20260609, now)).toBe(false);
  });
});

describe("saveDaily / getDaily", () => {
  beforeEach(() => __clearDailyStore());

  it("round-trips a saved result", () => {
    const result = {
      seed: 20260608,
      wins: 12,
      draws: 1,
      losses: 0,
      goalsFor: 36,
      goalsAgainst: 8,
      topScorer: { name: "Lionel Messi", goals: 9 },
      playedAt: "2026-06-08T15:23:00Z",
      league: "ucl",
    };
    expect(saveDaily(result)).toBe(true);
    expect(getDaily(20260608)).toEqual(result);
  });

  it("first save wins — subsequent saves on the same seed are ignored", () => {
    saveDaily({
      seed: 20260608,
      wins: 12,
      draws: 1,
      losses: 0,
      goalsFor: 36,
      goalsAgainst: 8,
      playedAt: "T1",
    });
    // Attempt to overwrite with a "better" score
    const second = saveDaily({
      seed: 20260608,
      wins: 13,
      draws: 0,
      losses: 0,
      goalsFor: 50,
      goalsAgainst: 0,
      playedAt: "T2",
    });
    expect(second).toBe(false);
    expect(getDaily(20260608)?.wins).toBe(12); // first one kept
  });

  it("returns null for a day that wasn't played", () => {
    expect(getDaily(20260608)).toBeNull();
  });

  it("getAllDailyResults returns newest-seed-first", () => {
    saveDaily({
      seed: 20260606,
      wins: 1,
      draws: 0,
      losses: 0,
      goalsFor: 1,
      goalsAgainst: 0,
      playedAt: "T1",
    });
    saveDaily({
      seed: 20260608,
      wins: 2,
      draws: 0,
      losses: 0,
      goalsFor: 2,
      goalsAgainst: 0,
      playedAt: "T2",
    });
    saveDaily({
      seed: 20260607,
      wins: 3,
      draws: 0,
      losses: 0,
      goalsFor: 3,
      goalsAgainst: 0,
      playedAt: "T3",
    });
    const all = getAllDailyResults();
    expect(all.map((r) => r.seed)).toEqual([20260608, 20260607, 20260606]);
  });
});

describe("getDailyStreak()", () => {
  beforeEach(() => __clearDailyStore());

  function plant(seed: number) {
    saveDaily({
      seed,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      playedAt: "x",
    });
  }

  const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

  it("returns 0 when nothing has been played", () => {
    expect(getDailyStreak(day(2026, 6, 8))).toBe(0);
  });

  it("returns 1 when only today is played", () => {
    plant(20260608);
    expect(getDailyStreak(day(2026, 6, 8))).toBe(1);
  });

  it("counts today + consecutive prior days", () => {
    plant(20260606);
    plant(20260607);
    plant(20260608);
    expect(getDailyStreak(day(2026, 6, 8))).toBe(3);
  });

  it("breaks the streak at a gap", () => {
    plant(20260604);
    plant(20260605);
    // skip 06
    plant(20260607);
    plant(20260608);
    expect(getDailyStreak(day(2026, 6, 8))).toBe(2); // only 7 + 8
  });

  it("counts yesterday when today is not yet played (streak still alive)", () => {
    // User played yesterday, hasn't played today yet — streak shouldn't show 0.
    plant(20260606);
    plant(20260607);
    expect(getDailyStreak(day(2026, 6, 8))).toBe(2);
  });

  it("returns 0 if neither today nor yesterday played (streak lost)", () => {
    plant(20260601);
    plant(20260602);
    expect(getDailyStreak(day(2026, 6, 8))).toBe(0);
  });

  it("handles a month rollover correctly", () => {
    plant(20260530); // May 30
    plant(20260531); // May 31
    plant(20260601); // June 1
    expect(getDailyStreak(day(2026, 6, 1))).toBe(3);
  });
});

describe("regression: seed feeds the sim deterministically", () => {
  // The point of Daily is "same draws for everyone today." That contract
  // hinges on dailySeed() being deterministic AND the existing sim/wheel
  // being seed-driven. If either drifts, Daily breaks silently.
  it("dailySeed() for a fixed date is invariant", () => {
    expect(dailySeed(new Date(Date.UTC(2026, 5, 8)))).toBe(20260608);
    expect(dailySeed(new Date(Date.UTC(2026, 5, 8)))).toBe(20260608);
  });
});
