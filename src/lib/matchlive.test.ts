import { describe, it, expect } from "vitest";
import { matchInjury, currentInjuries, buildLiveEvents, INJURY_RATE } from "./matchlive";

const XI = Array.from({ length: 11 }, (_, i) => `c:P${i}`);

describe("matchInjury", () => {
  it("is deterministic", () => {
    expect(matchInjury(5, XI, 999)).toEqual(matchInjury(5, XI, 999));
  });
  it("only ever injures a player who was on the pitch", () => {
    const set = new Set(XI);
    for (let md = 1; md <= 60; md++) {
      const inj = matchInjury(md, XI, 42);
      if (inj) {
        expect(set.has(inj.key)).toBe(true);
        expect(inj.weeks).toBeGreaterThanOrEqual(1);
        expect(inj.weeks).toBeLessThanOrEqual(4);
      }
    }
  });
  it("fires at roughly the configured rate", () => {
    let n = 0;
    for (let md = 1; md <= 400; md++) if (matchInjury(md, XI, 7)) n++;
    expect(n / 400).toBeGreaterThan(INJURY_RATE - 0.08);
    expect(n / 400).toBeLessThan(INJURY_RATE + 0.08);
  });
  it("never injures from an empty XI", () => {
    expect(matchInjury(3, [], 1)).toBeNull();
  });
});

describe("currentInjuries", () => {
  it("sidelines a freshly-injured player and counts down", () => {
    // Find a matchday that injures, then check the window.
    const seed = 5;
    let injMd = -1;
    let weeks = 0;
    for (let md = 1; md <= 40; md++) {
      const inj = matchInjury(md, XI, seed);
      if (inj) {
        injMd = md;
        weeks = inj.weeks;
        break;
      }
    }
    expect(injMd).toBeGreaterThan(0);
    // Lineups for injMd matchdays (same XI each), as of just after injMd.
    const lineups = Array.from({ length: injMd }, () => XI);
    const out = currentInjuries(lineups, seed);
    expect(out.size).toBeGreaterThan(0);
    // Remaining should equal `weeks` right after the injuring matchday.
    const remaining = Math.max(...out.values());
    expect(remaining).toBe(weeks);
  });

  it("clears once the window passes", () => {
    const seed = 5;
    // Play far enough that early injuries have healed and re-derive at MD40.
    const lineups = Array.from({ length: 40 }, () => XI);
    const out = currentInjuries(lineups, seed);
    // Whatever is injured at MD40 must come from a recent matchday (<=4 ago).
    for (const rem of out.values()) {
      expect(rem).toBeGreaterThan(0);
      expect(rem).toBeLessThanOrEqual(4);
    }
  });
});

describe("buildLiveEvents", () => {
  const base = {
    oppName: "RIV",
    xiKeys: XI,
    keyToName: (k: string) => k.split(":")[1],
    seasonSeed: 11,
  };

  it("opens with kick-off and ends with full time", () => {
    const ev = buildLiveEvents({ ...base, match: { matchday: 1, ourScore: 2, theirScore: 1 }, ourScorers: ["A", "B"] });
    expect(ev[0].type).toBe("ko");
    expect(ev[ev.length - 1].type).toBe("ft");
  });

  it("emits one goal event per goal, named for our scorers", () => {
    const ev = buildLiveEvents({ ...base, match: { matchday: 3, ourScore: 3, theirScore: 0 }, ourScorers: ["Mbappé", "Vini", "Bellingham"] });
    const us = ev.filter((e) => e.type === "goal-us");
    expect(us.length).toBe(3);
    expect(ev.filter((e) => e.type === "goal-them").length).toBe(0);
    expect(us.some((e) => e.text.includes("Mbappé"))).toBe(true);
  });

  it("is deterministic", () => {
    const args = { ...base, match: { matchday: 4, ourScore: 1, theirScore: 1 }, ourScorers: ["X"] };
    expect(buildLiveEvents(args)).toEqual(buildLiveEvents(args));
  });

  it("leaves no unfilled placeholders", () => {
    const ev = buildLiveEvents({ ...base, match: { matchday: 9, ourScore: 2, theirScore: 2 }, ourScorers: ["A", "B"] });
    for (const e of ev) expect(e.text).not.toMatch(/\{\w+\}/);
  });
});
