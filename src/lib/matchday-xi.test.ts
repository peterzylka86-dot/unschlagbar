/**
 * Tests for matchday XI selection (squad-of-14 benching).
 */
import { describe, it, expect } from "vitest";
import {
  autoPickXI,
  resolveXI,
  canSwapIntoXI,
  xiToSlots,
  effectiveRating,
  playerKey,
  formKey,
  MATCHDAY_XI_SIZE,
} from "./matchday-xi";
import type { Player, Position } from "./game-types";

let counter = 0;
function mk(position: Position, rating: number, name?: string): Player {
  counter += 1;
  return {
    name: name ?? `P${counter}-${position}${rating}`,
    position,
    prime_rating: rating,
    career_years: "2020-2026",
    nationality: "Test",
    club: "testclub",
  };
}

/** A balanced 14-player squad that can fill a 4-3-3:
 *  2 GK, 5 DEF (2 CB needed +LB+RB), 4 MID, 3 FWD wide+ST. */
function squad14(): Player[] {
  return [
    mk("GK", 88, "GK One"),
    mk("GK", 80, "GK Two"),
    mk("CB", 87, "CB One"),
    mk("CB", 85, "CB Two"),
    mk("CB", 78, "CB Three"),
    mk("LB", 84, "LB One"),
    mk("RB", 83, "RB One"),
    mk("CM", 89, "CM One"),
    mk("CM", 86, "CM Two"),
    mk("CDM", 84, "DM One"),
    mk("CAM", 82, "AM One"),
    mk("LW", 90, "LW One"),
    mk("RW", 87, "RW One"),
    mk("ST", 91, "ST One"),
  ];
}

describe("autoPickXI", () => {
  it("selects exactly 11 from a balanced 14", () => {
    const xi = autoPickXI(squad14(), "4-3-3");
    expect(xi).toHaveLength(11);
  });

  it("prefers higher-rated players at the same position", () => {
    const xi = autoPickXI(squad14(), "4-3-3");
    // GK One (88) starts over GK Two (80)
    expect(xi).toContain("testclub:GK One");
    expect(xi).not.toContain("testclub:GK Two");
  });

  it("form flips a selection — hot bench player beats cold starter", () => {
    const squad = squad14();
    // CB Three (78) vs CB Two (85): +2 form on Three, -2 on Two → still
    // 80 vs 83, Two keeps the spot. But CB Two at -2 (83) vs CB Three
    // at +2 with higher base... use closer ratings to flip:
    // Give CB Three form +2 → 80; CB Two form -2 → 83. Not enough.
    // The real check: form IS included in ranking.
    const form: Record<string, number> = {};
    form[formKey(squad[3])] = -2; // CB Two: 85 → 83
    form[formKey(squad[4])] = 2; //  CB Three: 78 → 80
    // 83 > 80 — CB Two still starts. Now exaggerate via rating proximity:
    const close = [
      mk("GK", 80, "K1"),
      mk("CB", 84, "D1"),
      mk("CB", 83, "D2"), // cold
      mk("CB", 82, "D3"), // hot — effective 84 beats D2's 81
      mk("LB", 80, "D4"),
      mk("RB", 80, "D5"),
      mk("CM", 80, "M1"),
      mk("CM", 80, "M2"),
      mk("CM", 80, "M3"),
      mk("LW", 80, "F1"),
      mk("RW", 80, "F2"),
      mk("ST", 80, "F3"),
    ];
    const f2: Record<string, number> = {
      [formKey(close[2])]: -2,
      [formKey(close[3])]: 2,
    };
    const xi = autoPickXI(close, "4-3-3", f2);
    expect(xi).toContain("testclub:D3"); // hot starter
    // D2 cold — with only 2 CB slots in 4-3-3, D1 + D3 take them
    expect(xi).not.toContain("testclub:D2");
  });

  it("squad of 11 (legacy save) → everyone starts", () => {
    // A BALANCED legacy-XI (1 GK, 4 DEF, 3 MID, 3 FWD) — drop the
    // backup GK / 3rd CB / spare mid from the 14.
    const squad = squad14().filter(
      (p) => !["GK Two", "CB Three", "AM One"].includes(p.name),
    );
    expect(squad).toHaveLength(11);
    const xi = autoPickXI(squad, "4-3-3");
    expect(xi).toHaveLength(11);
  });

  it("never selects more than 11", () => {
    const xi = autoPickXI(squad14(), "4-3-3");
    expect(xi.length).toBeLessThanOrEqual(MATCHDAY_XI_SIZE);
  });
});

describe("resolveXI", () => {
  it("returns stored keys when all valid", () => {
    const squad = squad14();
    const stored = autoPickXI(squad, "4-3-3");
    expect(resolveXI(squad, stored, "4-3-3")).toEqual(stored);
  });

  it("drops departed players; refills only with COMPATIBLE bench players", () => {
    const squad = squad14();
    const stored = autoPickXI(squad, "4-3-3");
    // ST One departs. The bench (GK Two, CB Three, AM One) has nobody
    // who can fill the ST slot under the strict matrix — so the honest
    // result is 10 starters + an empty ST slot, not a mis-assignment.
    const without = squad.filter((p) => p.name !== "ST One");
    const resolved = resolveXI(without, stored, "4-3-3");
    expect(resolved).toHaveLength(10);
    expect(resolved).not.toContain("testclub:ST One");

    // Now with a compatible bench striker available, the hole DOES fill.
    const withBackupSt = [...without, mk("ST", 75, "ST Backup")];
    const refilled = resolveXI(withBackupSt, stored, "4-3-3");
    expect(refilled).toHaveLength(11);
    expect(refilled).toContain("testclub:ST Backup");
  });

  it("null stored → full auto-pick", () => {
    const squad = squad14();
    const resolved = resolveXI(squad, null, "4-3-3");
    expect(resolved).toHaveLength(11);
  });
});

describe("canSwapIntoXI", () => {
  it("allows same-position bench swap", () => {
    const squad = squad14();
    const xi = autoPickXI(squad, "4-3-3");
    // GK Two (bench) for GK One (starter)
    expect(canSwapIntoXI(squad, xi, "testclub:GK One", "testclub:GK Two", "4-3-3")).toBe(true);
  });

  it("rejects a swap that breaks formation coverage", () => {
    const squad = squad14();
    const xi = autoPickXI(squad, "4-3-3");
    // Bench GK Two for the STARTING ST? GK can't fill ST slot → XI would
    // have a hole. (GK Two CAN only play GK; GK slot already filled by
    // GK One... wait GK One is the starter being kept.) Swapping ST One
    // out and GK Two in → two GKs, no ST. Greedy can't place 2nd GK.
    expect(canSwapIntoXI(squad, xi, "testclub:ST One", "testclub:GK Two", "4-3-3")).toBe(false);
  });

  it("rejects swapping in a player already in the XI", () => {
    const squad = squad14();
    const xi = autoPickXI(squad, "4-3-3");
    expect(canSwapIntoXI(squad, xi, "testclub:GK One", "testclub:CM One", "4-3-3")).toBe(false);
  });

  it("rejects outgoing player not in the XI", () => {
    const squad = squad14();
    const xi = autoPickXI(squad, "4-3-3");
    expect(canSwapIntoXI(squad, xi, "testclub:GK Two", "testclub:CB Three", "4-3-3")).toBe(false);
  });
});

describe("xiToSlots", () => {
  it("assigns the XI into formation slots with players attached", () => {
    const squad = squad14();
    const xi = autoPickXI(squad, "4-3-3");
    const slots = xiToSlots(squad, xi, "4-3-3");
    expect(slots).toHaveLength(11);
    const filled = slots.filter((s) => s.player);
    expect(filled).toHaveLength(11);
  });

  it("leaves slots empty rather than mis-assigning", () => {
    // XI of 11 strikers — only the ST/LW/RW slots can fill
    const sts = Array.from({ length: 11 }, (_, i) => mk("ST", 80 + i));
    const keys = sts.map(playerKey);
    const slots = xiToSlots(sts, keys, "4-3-3");
    const filled = slots.filter((s) => s.player);
    // 4-3-3 has ST + LW + RW (ST fits only ST slot strictly)
    expect(filled.length).toBeLessThan(11);
  });
});

describe("effectiveRating", () => {
  it("adds form to prime rating", () => {
    const p = mk("ST", 85, "Former");
    expect(effectiveRating(p, { [formKey(p)]: 2 })).toBe(87);
    expect(effectiveRating(p, { [formKey(p)]: -1.5 })).toBe(83.5);
    expect(effectiveRating(p, {})).toBe(85);
  });
});
