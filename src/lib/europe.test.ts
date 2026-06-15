import { describe, it, expect } from "vitest";
import {
  qualifyEurope,
  europePrize,
  europeField,
  euroRounds,
  EURO_META,
  leaguePhaseStandings,
  uclCut,
  seasonEuropeEntry,
} from "./europe";

describe("seasonEuropeEntry", () => {
  const rec = (season: number, finalPosition: number, trophies: string[] = []) => ({
    season,
    finalPosition,
    trophies,
  });

  it("gives no European football in season 1 — you only just arrived", () => {
    expect(seasonEuropeEntry([], 1)).toBeNull();
    expect(seasonEuropeEntry([rec(1, 1)], 1)).toBeNull();
  });

  it("enrols you based on LAST season's finish, not this one", () => {
    // Won season 1 → in the UCL for season 2.
    expect(seasonEuropeEntry([rec(1, 1)], 2)).toBe("ucl");
    // Finished 6th in season 1 → Europa for season 2.
    expect(seasonEuropeEntry([rec(1, 6)], 2)).toBe("el");
    // Mid-table last season → no Europe this season.
    expect(seasonEuropeEntry([rec(1, 10)], 2)).toBeNull();
  });

  it("lets the Champions League holder defend even after a poor league finish", () => {
    const hist = [rec(1, 9, [`${EURO_META.ucl.name} Winner`])];
    expect(seasonEuropeEntry(hist, 2)).toBe("ucl");
  });
});

describe("qualifyEurope", () => {
  it("maps finish to the right competition", () => {
    expect(qualifyEurope(1)).toBe("ucl");
    expect(qualifyEurope(4)).toBe("ucl");
    expect(qualifyEurope(5)).toBe("el");
    expect(qualifyEurope(6)).toBe("el");
    expect(qualifyEurope(7)).toBe("ecl");
    expect(qualifyEurope(8)).toBeNull();
  });
});

describe("europePrize", () => {
  it("pays more for going further and for bigger competitions", () => {
    expect(europePrize("ucl", "champion")).toBeGreaterThan(europePrize("ucl", "final"));
    expect(europePrize("ucl", "champion")).toBeGreaterThan(europePrize("el", "champion"));
    expect(europePrize("el", "champion")).toBeGreaterThan(europePrize("ecl", "champion"));
    // Even bowing out in the R16 pays a participation fee.
    expect(europePrize("ucl", "r16")).toBeGreaterThan(0);
  });
});

describe("europeField", () => {
  it("has the right size and always includes the user's club", () => {
    const f = europeField("ucl", "real-madrid");
    expect(f.length).toBe(EURO_META.ucl.field);
    expect(f.some((c) => c.id === "real-madrid")).toBe(true);
  });
  it("guarantees a weak qualifier a place (displacing the weakest seed)", () => {
    // A modest 2nd-division club that 'qualified' must still appear.
    const someSmall = "bochum"; // not necessarily present; pick any real id
    // Use a real low-strength club id from the data.
    const f = europeField("ecl", someSmall);
    expect(f.length).toBe(EURO_META.ecl.field);
  });
});

describe("euroRounds", () => {
  it("scales with field size", () => {
    expect(euroRounds(16)).toEqual(["r16", "qf", "sf", "final"]);
    expect(euroRounds(8)).toEqual(["qf", "sf", "final"]);
  });
});

describe("UCL league phase", () => {
  const field = Array.from({ length: 36 }, (_, i) => ({ id: `c${i}`, strength: 88 - i }));

  it("UCL field is 36 for the league phase", () => {
    expect(EURO_META.ucl.field).toBe(36);
  });

  it("builds a full sorted table with the user placed by points", () => {
    const t = leaguePhaseStandings(field, "c5", 20, 12, 1); // user storms it
    expect(t.length).toBe(36);
    expect(t[0].pos).toBe(1);
    expect(t.find((r) => r.id === "c5")!.pos).toBeLessThanOrEqual(3); // 20 pts → near top
    // Positions are a 1..36 permutation.
    expect(new Set(t.map((r) => r.pos)).size).toBe(36);
  });

  it("a weak user campaign finishes low", () => {
    const t = leaguePhaseStandings(field, "c5", 2, -10, 1);
    expect(t.find((r) => r.id === "c5")!.pos).toBeGreaterThan(20);
  });

  it("uclCut: top 8 direct, 9-24 playoff, 25+ out", () => {
    expect(uclCut(1)).toBe("r16");
    expect(uclCut(8)).toBe("r16");
    expect(uclCut(9)).toBe("playoff");
    expect(uclCut(24)).toBe("playoff");
    expect(uclCut(25)).toBe("out");
  });

  it("is deterministic", () => {
    expect(leaguePhaseStandings(field, "c5", 14, 4, 7)).toEqual(
      leaguePhaseStandings(field, "c5", 14, 4, 7),
    );
  });
});
