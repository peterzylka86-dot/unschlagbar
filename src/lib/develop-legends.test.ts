import { describe, it, expect } from "vitest";
import { youthifyLegend, LEGEND_TALENT_FLOOR } from "./develop-legends";
import type { Player } from "./game-types";

const legend = (over: Partial<Player> = {}): Player => ({
  name: "Pelé",
  position: "ST",
  prime_rating: 96,
  career_years: "1957-1977",
  nationality: "Brazil",
  club: "santos",
  ...over,
});

describe("youthifyLegend", () => {
  it("drops a peak legend to a developing talent with his peak as the ceiling", () => {
    const y = youthifyLegend(legend());
    expect(y.prime_rating).toBe(82); // 96 - 14
    expect(y.targetRating).toBe(96);
    expect(y.potential).toBe(96);
    expect(y.age).toBeGreaterThanOrEqual(16);
    expect(y.age).toBeLessThanOrEqual(19);
  });

  it("floors a modest legend so he's still a great talent, never below his peak", () => {
    const y = youthifyLegend(legend({ prime_rating: 78 }));
    expect(y.prime_rating).toBe(LEGEND_TALENT_FLOOR); // max(70, 78-14=64) = 70
    expect(y.prime_rating).toBeLessThanOrEqual(78);
    expect(y.targetRating).toBe(78);
  });

  it("never starts a prospect above his own peak", () => {
    const y = youthifyLegend(legend({ prime_rating: 72 }));
    expect(y.prime_rating).toBeLessThanOrEqual(72);
  });

  it("leaves an already-aged player untouched (idempotent across seasons)", () => {
    const aged = legend({ age: 23, prime_rating: 88, targetRating: 96 });
    expect(youthifyLegend(aged)).toEqual(aged);
  });

  it("is deterministic", () => {
    expect(youthifyLegend(legend())).toEqual(youthifyLegend(legend()));
  });
});
