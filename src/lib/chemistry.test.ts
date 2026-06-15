import { describe, it, expect } from "vitest";
import { squadChemistry } from "./chemistry";
import type { Player } from "./game-types";

const p = (nat: string, rating: number): Player => ({
  name: `${nat}-${rating}`,
  position: "CM",
  prime_rating: rating,
  career_years: "x",
  nationality: nat,
  club: "c",
});

describe("squadChemistry", () => {
  it("is zero for a cosmopolitan, modest XI", () => {
    const xi = ["BRA", "ESP", "FRA", "GER", "ITA", "ENG", "ARG", "POR", "NED", "BEL", "CRO"].map((n) =>
      p(n, 80),
    );
    expect(squadChemistry(xi).bonus).toBe(0);
  });

  it("rewards a national spine and a bigger national core", () => {
    const spine = [...Array(5)].map(() => p("Brazil", 82)).concat([...Array(6)].map(() => p("X", 80)));
    expect(squadChemistry(spine).bonus).toBeGreaterThanOrEqual(1);
    const core = [...Array(8)].map(() => p("Brazil", 82)).concat([...Array(3)].map(() => p("X", 80)));
    expect(squadChemistry(core).bonus).toBeGreaterThanOrEqual(2);
    expect(squadChemistry(core).label).toContain("Brazil");
  });

  it("rewards a galáctico core and caps at +3", () => {
    const allStars = [...Array(11)].map((_, i) => p(`N${i}`, 92)); // all 90+, all diff nat
    expect(squadChemistry(allStars).bonus).toBe(1); // 4+ galácticos, no national spine
    const both = [...Array(8)].map(() => p("Brazil", 93)).concat([...Array(3)].map(() => p("X", 93)));
    expect(squadChemistry(both).bonus).toBe(3); // 2 (core) + 1 (galácticos), capped
  });

  it("handles an empty XI", () => {
    expect(squadChemistry([]).bonus).toBe(0);
  });
});
