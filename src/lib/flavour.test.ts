import { describe, it, expect } from "vitest";
import { matchdayEvent, seasonDiary } from "./flavour";

describe("matchdayEvent", () => {
  it("is deterministic", () => {
    expect(matchdayEvent(1, 6, ["Aubameyang"])).toBe(matchdayEvent(1, 6, ["Aubameyang"]));
  });

  it("substitutes a squad name and leaves no token", () => {
    // Sweep matchdays until we hit a firing one, then assert substitution.
    let fired: string | null = null;
    for (let md = 1; md <= 30 && !fired; md++) fired = matchdayEvent(2, md, ["Zlatan"]);
    expect(fired).toBeTruthy();
    expect(fired).not.toMatch(/\{player\}/);
  });

  it("falls back gracefully with an empty squad", () => {
    for (let md = 1; md <= 30; md++) {
      const ev = matchdayEvent(3, md, []);
      if (ev) expect(ev).not.toMatch(/\{player\}/);
    }
  });

  it("fires rarely — it's occasional colour, not a weekly column", () => {
    let fires = 0;
    for (let md = 1; md <= 60; md++) if (matchdayEvent(1, md, ["X"])) fires++;
    // ~1 in 7 matchdays, so the meaningful beats carry the story.
    expect(fires).toBeGreaterThan(3);
    expect(fires).toBeLessThan(15);
  });
});

describe("seasonDiary", () => {
  const squad = [
    { name: "Goleador", position: "ST", prime_rating: 88 },
    { name: "Silent Sam", position: "LW", prime_rating: 85 },
    { name: "Rock CB", position: "CB", prime_rating: 84 },
  ];

  function mkMatches() {
    // MD1: 4-0 win, Goleador x3 → headline + (later) milestone progress
    // MD2: 3-3 (no headline), Goleador x2 → reaches 5 → milestone morale
    // MD3: 0-4 loss → big-loss headline
    return [
      { matchday: 1, ourScore: 4, theirScore: 0, outcome: "W" as const, scorers: [{ name: "Goleador" }, { name: "Goleador" }, { name: "Goleador" }, { name: "Rock CB" }] },
      { matchday: 2, ourScore: 3, theirScore: 3, outcome: "D" as const, scorers: [{ name: "Goleador" }, { name: "Goleador" }, { name: "Rock CB" }] },
      { matchday: 3, ourScore: 0, theirScore: 4, outcome: "L" as const, scorers: [] },
    ];
  }

  it("is deterministic", () => {
    const a = seasonDiary({ season: 1, matches: mkMatches(), squad });
    const b = seasonDiary({ season: 1, matches: mkMatches(), squad });
    expect(a).toEqual(b);
  });

  it("emits at most one beat per matchday", () => {
    const beats = seasonDiary({ season: 1, matches: mkMatches(), squad });
    const days = beats.map((x) => x.matchday);
    expect(new Set(days).size).toBe(days.length);
  });

  it("produces a big-win headline on the 4-0", () => {
    const beats = seasonDiary({ season: 1, matches: mkMatches(), squad });
    const md1 = beats.find((x) => x.matchday === 1);
    expect(md1?.kind).toBe("headline");
  });

  it("produces a big-loss headline on the 0-4", () => {
    const beats = seasonDiary({ season: 1, matches: mkMatches(), squad });
    const md3 = beats.find((x) => x.matchday === 3);
    expect(md3?.kind).toBe("headline");
  });

  it("fires a hot-striker morale beat at the 5-goal milestone", () => {
    const beats = seasonDiary({ season: 1, matches: mkMatches(), squad });
    const md2 = beats.find((x) => x.matchday === 2);
    expect(md2?.kind).toBe("morale");
    expect(md2?.text).toContain("Goleador");
    expect(md2?.text).toContain("5");
  });

  it("leaves no unfilled placeholders anywhere", () => {
    const beats = seasonDiary({ season: 7, matches: mkMatches(), squad });
    for (const b of beats) expect(b.text).not.toMatch(/\{\w+\}/);
  });

  it("grumbles about a high-rated forward who never scored", () => {
    // Long enough season (≥6) so the cold-forward beat is allowed.
    // Goleador (higher-rated FWD) scores so the cold-forward grumble lands
    // on Silent Sam, the next-best forward who never troubled the keeper.
    const matches = Array.from({ length: 8 }, (_, i) => ({
      matchday: i + 1,
      ourScore: 1,
      theirScore: 1,
      outcome: "D" as const,
      // Goleador grabs a single early goal — enough to take him out of the
      // cold-forward running, not enough to trigger a 5-goal milestone beat.
      scorers: [{ name: i === 0 ? "Goleador" : "Rock CB" }],
    }));
    const beats = seasonDiary({ season: 1, matches, squad });
    const grumble = beats.find((b) => b.kind === "morale" && b.text.includes("Silent Sam"));
    expect(grumble).toBeTruthy();
  });
});
