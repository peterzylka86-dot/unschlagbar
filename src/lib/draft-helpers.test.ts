/**
 * Tests for the draft-time placement helpers.
 *
 * The Founding Player feature lets a user anchor their XI around a specific
 * player BEFORE the wheel takes over. These tests pin the pure-logic
 * behavior so a regression couldn't silently break it.
 */
import { describe, it, expect } from "vitest";
import { placeFoundingPlayer, isPositionMatch } from "./draft-helpers";
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

describe("isPositionMatch", () => {
  it("returns true when positions match", () => {
    expect(isPositionMatch("CB", "CB")).toBe(true);
    expect(isPositionMatch("CAM", "CAM")).toBe(true);
  });
  it("returns false when positions differ", () => {
    expect(isPositionMatch("CB", "ST")).toBe(false);
    expect(isPositionMatch("CAM", "CM")).toBe(false);  // strict, not bucketed
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
    expect(result.slots[2].player).toBeUndefined();  // 2nd CB still empty
    expect(result.slots[0].player).toBeUndefined();  // GK still empty
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
    expect(result.slots[0].player).toEqual(existing);  // first CB unchanged
    expect(result.slots[1].player).toEqual(fp);        // second CB placed
  });

  it("does not mutate the input slots array or its members", () => {
    const slots = [mockSlot("cb-1", "CB"), mockSlot("st-1", "ST")];
    const slotsCopy = JSON.parse(JSON.stringify(slots));
    const fp = mockPlayer("Per Mertesacker", "CB");
    placeFoundingPlayer(slots, fp);
    expect(slots).toEqual(slotsCopy);  // input untouched
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
      if (slotPos === "CB" && (playerPos === "CB" || playerPos === "LB" || playerPos === "RB")) return true;
      return slotPos === playerPos;
    };
    const slots = [mockSlot("cb-1", "CB"), mockSlot("st-1", "ST")];
    const fp = mockPlayer("Stéphane Henchoz", "LB", "liverpool");  // LB into CB slot
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

  it("regression: founding player at the FIRST slot of correct position", () => {
    // The bug we're guarding against: the placement somehow skips the first
    // valid empty slot. Cover the canonical formation-shape case.
    const slots = [
      mockSlot("gk",   "GK"),
      mockSlot("lb",   "LB"),
      mockSlot("cb-1", "CB"),
      mockSlot("cb-2", "CB"),
      mockSlot("rb",   "RB"),
      mockSlot("cm-1", "CM"),
      mockSlot("cm-2", "CM"),
      mockSlot("cm-3", "CM"),
      mockSlot("lw",   "LW"),
      mockSlot("st",   "ST"),
      mockSlot("rw",   "RW"),
    ];
    const fp = mockPlayer("Dariusz Wosz", "CAM", "bochum");
    // 4-3-3 has no CAM — should NOT place
    expect(placeFoundingPlayer(slots, fp).placedSlotId).toBeNull();

    // But same player as CM should place
    const fpCM = mockPlayer("Dariusz Wosz", "CM", "bochum");
    expect(placeFoundingPlayer(slots, fpCM).placedSlotId).toBe("cm-1");
  });
});
