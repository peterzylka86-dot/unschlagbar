/**
 * Tests for the formation slot tables.
 *
 * Formations are static data, but invariants must hold:
 *   - Every formation has exactly 11 slots
 *   - Every formation has exactly 1 GK
 *   - All slot IDs within a formation are unique (used as React keys)
 *   - All positions are members of the 10-position taxonomy
 */
import { describe, it, expect } from "vitest";
import { FORMATIONS, FORMATION_KEYS } from "./formations";
import type { Position } from "./game-types";

const VALID_POSITIONS: Set<Position> = new Set([
  "GK",
  "CB",
  "LB",
  "RB",
  "CDM",
  "CM",
  "CAM",
  "LW",
  "RW",
  "ST",
]);

describe("FORMATIONS table", () => {
  it("exports at least 5 formations", () => {
    expect(FORMATION_KEYS.length).toBeGreaterThanOrEqual(5);
  });

  describe.each(FORMATION_KEYS)("formation %s", (key) => {
    const f = FORMATIONS[key];

    it("has exactly 11 slots", () => {
      expect(f.slots).toHaveLength(11);
    });

    it("has exactly 1 GK slot", () => {
      const gks = f.slots.filter((s) => s.position === "GK");
      expect(gks).toHaveLength(1);
    });

    it("has unique slot IDs", () => {
      const ids = f.slots.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("every slot position is in the valid taxonomy", () => {
      f.slots.forEach((s) => expect(VALID_POSITIONS.has(s.position)).toBe(true));
    });

    it("every slot has x,y coords in 0-100 range", () => {
      f.slots.forEach((s) => {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(100);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(100);
      });
    });

    it("GK is positioned in the defensive third (y > 70)", () => {
      const gk = f.slots.find((s) => s.position === "GK")!;
      expect(gk.y).toBeGreaterThan(70);
    });

    it("STs are positioned in the attacking third (y < 40)", () => {
      f.slots.filter((s) => s.position === "ST").forEach((s) => expect(s.y).toBeLessThan(40));
    });

    it("LW/RW (wingers, sometimes deep wide-mids) are above the defensive third (y < 60)", () => {
      f.slots
        .filter((s) => s.position === "LW" || s.position === "RW")
        .forEach((s) => expect(s.y).toBeLessThan(60));
    });
  });

  it("3-4-3 and 5-4-1 (extremes) both exist", () => {
    expect(FORMATIONS["3-4-3"]).toBeDefined();
    expect(FORMATIONS["5-4-1"]).toBeDefined();
  });
});
