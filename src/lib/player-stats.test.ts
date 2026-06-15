import { describe, it, expect } from "vitest";
import { playerSeasonStats, positionAttributes } from "./player-stats";

describe("playerSeasonStats", () => {
  const matches = [
    // MD1: won 2-0, our striker scored both, midfielder assisted one.
    {
      ourScore: 2,
      theirScore: 0,
      scorers: [
        { name: "Striker", assister: "Maestro" },
        { name: "Striker" },
      ],
    },
    // MD2: lost 1-3, striker scored.
    { ourScore: 1, theirScore: 3, scorers: [{ name: "Striker" }] },
  ];
  const lineups = [
    ["FC:Striker", "FC:Maestro", "FC:Keeper"],
    ["FC:Striker", "FC:Keeper"], // Maestro benched MD2
  ];

  it("counts goals across the season", () => {
    expect(playerSeasonStats({ name: "Striker" }, matches, lineups, "FC:Striker").goals).toBe(3);
  });

  it("counts assists", () => {
    expect(playerSeasonStats({ name: "Maestro" }, matches, lineups, "FC:Maestro").assists).toBe(1);
  });

  it("counts apps only for matchdays started", () => {
    expect(playerSeasonStats({ name: "Maestro" }, matches, lineups, "FC:Maestro").apps).toBe(1);
    expect(playerSeasonStats({ name: "Striker" }, matches, lineups, "FC:Striker").apps).toBe(2);
  });

  it("counts clean sheets only when started AND conceded zero", () => {
    // Keeper started both; only MD1 was a clean sheet.
    expect(playerSeasonStats({ name: "Keeper" }, matches, lineups, "FC:Keeper").cleanSheets).toBe(1);
  });

  it("matches names case- and accent-insensitively", () => {
    const m = [{ ourScore: 1, theirScore: 0, scorers: [{ name: "Müller" }] }];
    // normalizeName lowercases; ü stays ü but case folds — exercise the path.
    expect(playerSeasonStats({ name: "müller" }, m, [["X:müller"]], "X:müller").goals).toBe(1);
  });
});

describe("positionAttributes", () => {
  it("gives an outfielder the six standard attributes", () => {
    const attrs = positionAttributes({ name: "Wing", position: "RW", prime_rating: 85 });
    expect(attrs.map((a) => a.short)).toEqual(["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"]);
  });

  it("gives a keeper keeper attributes", () => {
    const attrs = positionAttributes({ name: "Cat", position: "GK", prime_rating: 85 });
    expect(attrs.map((a) => a.short)).toEqual(["REF", "HAN", "POS", "KIC", "AER", "SPD"]);
  });

  it("shapes the profile by position — a CB defends, a striker shoots", () => {
    const cb = positionAttributes({ name: "Rock", position: "CB", prime_rating: 82 });
    const st = positionAttributes({ name: "Goal", position: "ST", prime_rating: 82 });
    const cbDef = cb.find((a) => a.short === "DEF")!.value;
    const stDef = st.find((a) => a.short === "DEF")!.value;
    const cbSho = cb.find((a) => a.short === "SHO")!.value;
    const stSho = st.find((a) => a.short === "SHO")!.value;
    expect(cbDef).toBeGreaterThan(stDef);
    expect(stSho).toBeGreaterThan(cbSho);
  });

  it("clamps into 20..99 and is deterministic", () => {
    const a1 = positionAttributes({ name: "Star", position: "ST", prime_rating: 99 });
    const a2 = positionAttributes({ name: "Star", position: "ST", prime_rating: 99 });
    expect(a1).toEqual(a2);
    for (const a of a1) {
      expect(a.value).toBeGreaterThanOrEqual(20);
      expect(a.value).toBeLessThanOrEqual(99);
    }
  });
});
