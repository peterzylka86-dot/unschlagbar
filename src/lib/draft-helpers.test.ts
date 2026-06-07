/**
 * Tests for the draft-time placement helpers.
 *
 * The Founding Player feature lets a user anchor their XI around a specific
 * player BEFORE the wheel takes over. These tests pin the pure-logic
 * behavior so a regression couldn't silently break it.
 */
import { describe, it, expect } from "vitest";
import {
  placeFoundingPlayer,
  isPositionMatch,
  isPositionCompatible,
  POSITION_FAMILIES,
} from "./draft-helpers";
import type { Player, Position, Slot } from "./game-types";

function mockSlot(id: string, position: Position, player?: Player): Slot {
  return { id, position, x: 50, y: 50, player };
}

function mockPlayer(name: string, position: Position, club = "test"): Player {
  return {
    name,
    position,
    prime_rating: 85,
    career_years: "2010-2020",
    nationality: "Test",
    club,
  };
}

describe("isPositionMatch (strict equality)", () => {
  it("returns true when positions match", () => {
    expect(isPositionMatch("CB", "CB")).toBe(true);
    expect(isPositionMatch("CAM", "CAM")).toBe(true);
  });
  it("returns false when positions differ", () => {
    expect(isPositionMatch("CB", "ST")).toBe(false);
    expect(isPositionMatch("CAM", "CM")).toBe(false); // strict, not bucketed
  });
});

describe("isPositionCompatible (family-aware)", () => {
  it("returns true when positions match exactly", () => {
    expect(isPositionCompatible("CB", "CB")).toBe(true);
    expect(isPositionCompatible("ST", "ST")).toBe(true);
  });

  it("central-midfield family: CDM ↔ CM ↔ CAM are interchangeable", () => {
    expect(isPositionCompatible("CM", "CAM")).toBe(true);
    expect(isPositionCompatible("CAM", "CM")).toBe(true); // symmetric
    expect(isPositionCompatible("CM", "CDM")).toBe(true);
    expect(isPositionCompatible("CDM", "CM")).toBe(true); // symmetric
    expect(isPositionCompatible("CAM", "CDM")).toBe(true);
    expect(isPositionCompatible("CDM", "CAM")).toBe(true); // symmetric
  });

  it("side-specific positions do NOT cross sides", () => {
    expect(isPositionCompatible("LB", "RB")).toBe(false);
    expect(isPositionCompatible("LW", "RW")).toBe(false);
  });

  it("position families are NOT lumped across role boundaries", () => {
    // A CB is not a fullback (different role, different physical demand)
    expect(isPositionCompatible("CB", "LB")).toBe(false);
    expect(isPositionCompatible("LB", "CB")).toBe(false);
    // A winger is not a striker (different role)
    expect(isPositionCompatible("LW", "ST")).toBe(false);
    expect(isPositionCompatible("ST", "LW")).toBe(false);
    // A central mid is not a wide forward
    expect(isPositionCompatible("CM", "LW")).toBe(false);
    expect(isPositionCompatible("CAM", "ST")).toBe(false);
  });

  it("GK only matches GK", () => {
    expect(isPositionCompatible("GK", "GK")).toBe(true);
    expect(isPositionCompatible("GK", "CB")).toBe(false);
    expect(isPositionCompatible("CB", "GK")).toBe(false);
  });

  it("every position belongs to exactly one family", () => {
    const allPositions: Position[] = ["GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"];
    for (const p of allPositions) {
      const familyCount = POSITION_FAMILIES.filter((f) => f.includes(p)).length;
      expect(familyCount).toBe(1);
    }
  });
});

describe("placeFoundingPlayer", () => {
  it("returns slots unchanged when no founding player given", () => {
    const slots = [mockSlot("a", "GK"), mockSlot("b", "CB")];
    const result = placeFoundingPlayer(slots, undefined);
    expect(result.placedSlotId).toBeNull();
    expect(result.placedPlayerKey).toBeNull();
    expect(result.placedClubId).toBeNull();
    expect(result.slots).toBe(slots); // same reference — no copy needed
  });

  it("places founding player into the first empty compatible slot", () => {
    const slots = [
      mockSlot("gk-1", "GK"),
      mockSlot("cb-1", "CB"),
      mockSlot("cb-2", "CB"),
      mockSlot("st-1", "ST"),
    ];
    const fp = mockPlayer("Per Mertesacker", "CB", "werder");
    const result = placeFoundingPlayer(slots, fp);

    expect(result.placedSlotId).toBe("cb-1");
    expect(result.placedPlayerKey).toBe("werder:Per Mertesacker");
    expect(result.placedClubId).toBe("werder");
    expect(result.slots[1].player).toEqual(fp);
    expect(result.slots[2].player).toBeUndefined(); // 2nd CB still empty
    expect(result.slots[0].player).toBeUndefined(); // GK still empty
  });

  it("returns null target when no compatible slot exists in formation", () => {
    // 4-4-2 has no CAM slot; user picked a CAM as founding player
    const slots = [
      mockSlot("gk", "GK"),
      mockSlot("cb-1", "CB"),
      mockSlot("cb-2", "CB"),
      mockSlot("st-1", "ST"),
      mockSlot("st-2", "ST"),
    ];
    const fp = mockPlayer("Dariusz Wosz", "CAM", "bochum");
    const result = placeFoundingPlayer(slots, fp);
    expect(result.placedSlotId).toBeNull();
    expect(result.slots).toBe(slots);
  });

  it("skips already-filled slots and uses the next empty compatible one", () => {
    const existing = mockPlayer("Some Other CB", "CB", "elsewhere");
    const slots = [
      mockSlot("cb-1", "CB", existing),
      mockSlot("cb-2", "CB"),
      mockSlot("st-1", "ST"),
    ];
    const fp = mockPlayer("Per Mertesacker", "CB", "werder");
    const result = placeFoundingPlayer(slots, fp);
    expect(result.placedSlotId).toBe("cb-2");
    expect(result.slots[0].player).toEqual(existing); // first CB unchanged
    expect(result.slots[1].player).toEqual(fp); // second CB placed
  });

  it("does not mutate the input slots array or its members", () => {
    const slots = [mockSlot("cb-1", "CB"), mockSlot("st-1", "ST")];
    const slotsCopy = JSON.parse(JSON.stringify(slots));
    const fp = mockPlayer("Per Mertesacker", "CB");
    placeFoundingPlayer(slots, fp);
    expect(slots).toEqual(slotsCopy); // input untouched
    expect(slots[0].player).toBeUndefined();
  });

  it("does not place when all compatible slots are filled", () => {
    const cb1 = mockPlayer("Defender A", "CB");
    const cb2 = mockPlayer("Defender B", "CB");
    const slots = [
      mockSlot("cb-1", "CB", cb1),
      mockSlot("cb-2", "CB", cb2),
      mockSlot("st-1", "ST"),
    ];
    const fp = mockPlayer("Per Mertesacker", "CB");
    const result = placeFoundingPlayer(slots, fp);
    expect(result.placedSlotId).toBeNull();
    // input remains valid
    expect(result.slots[0].player?.name).toBe("Defender A");
    expect(result.slots[1].player?.name).toBe("Defender B");
  });

  it("works with a custom compatibility function (position-bucket flexible)", () => {
    // Accept any-FB into a generic DEF slot
    const flexCompat = (slotPos: Position, playerPos: Position) => {
      if (slotPos === "CB" && (playerPos === "CB" || playerPos === "LB" || playerPos === "RB"))
        return true;
      return slotPos === playerPos;
    };
    const slots = [mockSlot("cb-1", "CB"), mockSlot("st-1", "ST")];
    const fp = mockPlayer("Stéphane Henchoz", "LB", "liverpool"); // LB into CB slot
    const result = placeFoundingPlayer(slots, fp, flexCompat);
    expect(result.placedSlotId).toBe("cb-1");
    expect(result.slots[0].player).toEqual(fp);
  });

  it("composite key matches the format used by draft.tsx usedPlayers Set", () => {
    // draft.tsx tracks used players as `${p.club}:${p.name}` — must match
    // exactly so the wheel filter doesn't double-pick.
    const fp = mockPlayer("Dariusz Wosz", "CAM", "bochum");
    const slots = [mockSlot("cam", "CAM")];
    const result = placeFoundingPlayer(slots, fp);
    expect(result.placedPlayerKey).toBe("bochum:Dariusz Wosz");
  });

  it("Wosz (CAM) now places into 4-3-3's first CM slot via family compatibility", () => {
    // The fix for the user-reported issue: CDM/CM/CAM are the same family,
    // so a CAM player slots gracefully into a CM slot in 4-3-3.
    const slots = [
      mockSlot("gk", "GK"),
      mockSlot("lb", "LB"),
      mockSlot("cb-1", "CB"),
      mockSlot("cb-2", "CB"),
      mockSlot("rb", "RB"),
      mockSlot("cm-1", "CM"),
      mockSlot("cm-2", "CM"),
      mockSlot("cm-3", "CM"),
      mockSlot("lw", "LW"),
      mockSlot("st", "ST"),
      mockSlot("rw", "RW"),
    ];
    const fp = mockPlayer("Dariusz Wosz", "CAM", "bochum");
    const result = placeFoundingPlayer(slots, fp);
    expect(result.placedSlotId).toBe("cm-1");
    expect(result.slots[5].player?.name).toBe("Dariusz Wosz");
  });

  it("CAM founding player into a CDM-only formation slot", () => {
    // Pep Guardiola's CDM accepting a CAM-tagged player (defensive 10 → 8 swap)
    const slots = [mockSlot("gk", "GK"), mockSlot("cdm-1", "CDM"), mockSlot("cdm-2", "CDM")];
    const fp = mockPlayer("Mikel Arteta", "CAM", "arsenal");
    expect(placeFoundingPlayer(slots, fp).placedSlotId).toBe("cdm-1");
  });
});
