import { describe, it, expect } from "vitest";
import { unrestReason, departureFee } from "./unrest";

describe("unrestReason", () => {
  it("flags a deeply unhappy player regardless of class", () => {
    expect(unrestReason(78, 20, 80)).toBe("unhappy");
    expect(unrestReason(92, 18, 95)).toBe("unhappy"); // unhappiness beats ambition
  });

  it("a star above the club's level agitates for a move", () => {
    expect(unrestReason(90, 60, 70)).toBe("ambition"); // big fish, small club
  });

  it("a star at a club of matching reputation stays put", () => {
    expect(unrestReason(90, 60, 92)).toBeNull();
  });

  it("a happy squad player is settled", () => {
    expect(unrestReason(78, 60, 75)).toBeNull();
  });
});

describe("departureFee", () => {
  it("an ambitious star fetches a premium over an unhappy sale", () => {
    expect(departureFee(90, 26, "ambition")).toBeGreaterThan(departureFee(90, 26, "unhappy"));
  });
  it("is always positive", () => {
    expect(departureFee(70, 33, "unhappy")).toBeGreaterThan(0);
  });
});
