import { describe, it, expect } from "vitest";
import { applyRatingEdits, editedRating } from "./edits";
import type { Player } from "./game-types";

const p = (club: string, name: string, rating: number): Player => ({
  name,
  position: "ST",
  prime_rating: rating,
  career_years: "2025-2026",
  nationality: "x",
  club,
});

describe("applyRatingEdits", () => {
  it("overlays edits by player key, leaving others untouched", () => {
    const squad = [p("bochum", "A", 80), p("bochum", "B", 75)];
    const out = applyRatingEdits(squad, { "bochum:A": 88 });
    expect(out[0].prime_rating).toBe(88);
    expect(out[1].prime_rating).toBe(75);
  });

  it("returns the same list reference when there are no edits", () => {
    const squad = [p("c", "A", 80)];
    expect(applyRatingEdits(squad, {})).toBe(squad);
  });
});

describe("editedRating", () => {
  it("prefers the edit, falls back to prime_rating", () => {
    expect(editedRating(p("c", "A", 80), { "c:A": 90 })).toBe(90);
    expect(editedRating(p("c", "A", 80), {})).toBe(80);
  });
});
