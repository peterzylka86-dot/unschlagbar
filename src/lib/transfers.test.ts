import { describe, it, expect } from "vitest";
import { clubReputation, askingPrice, playerWillJoin, signStatus } from "./transfers";

describe("clubReputation", () => {
  it("rises with strength and silverware", () => {
    expect(clubReputation(85, 0, 0)).toBe(85);
    expect(clubReputation(64, 3, 1)).toBe(64 + 6 + 4);
    expect(clubReputation(64, 5, 2)).toBeGreaterThan(clubReputation(64, 0, 0));
  });
});

describe("askingPrice", () => {
  it("makes an elite player at an elite club far pricier than market", () => {
    const star = askingPrice(94, 26, 86); // Mbappé at Real
    const squad = askingPrice(78, 26, 70); // a journeyman
    expect(star).toBeGreaterThan(squad * 10);
  });
  it("an ordinary player stays near market value", () => {
    // No rating/club premium → roughly the base fee.
    expect(askingPrice(76, 25, 72)).toBeLessThan(askingPrice(90, 25, 85));
  });
});

describe("playerWillJoin", () => {
  it("a superstar won't drop to a minnow no matter what", () => {
    // Thun-ish reputation 64 vs Haaland (92) at a strong club (86).
    expect(playerWillJoin(64, 86, 92)).toBe(false);
  });
  it("a big club lands a star comfortably", () => {
    expect(playerWillJoin(90, 86, 92)).toBe(true);
  });
  it("reputation growth eventually unlocks bigger names", () => {
    const before = playerWillJoin(64, 80, 88);
    const after = playerWillJoin(64 + 30, 80, 88); // many trophies later
    expect(before).toBe(false);
    expect(after).toBe(true);
  });
});

describe("signStatus", () => {
  const base = {
    rating: 84,
    age: 25,
    sellingClubStrength: 80,
    yourReputation: 82,
    remainingBudget: 9999,
    signingsLeft: 4,
  };
  it("ok when reputation, money and window all allow", () => {
    expect(signStatus(base).status).toBe("ok");
  });
  it("flags wont-join over a reputation gap", () => {
    expect(signStatus({ ...base, yourReputation: 60, rating: 92, sellingClubStrength: 88 }).status).toBe(
      "wont-join",
    );
  });
  it("flags cant-afford on a thin budget", () => {
    expect(signStatus({ ...base, remainingBudget: 0 }).status).toBe("cant-afford");
  });
  it("flags the window limit", () => {
    expect(signStatus({ ...base, signingsLeft: 0 }).status).toBe("limit");
  });
});
