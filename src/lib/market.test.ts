import { describe, it, expect } from "vitest";
import { playerFee, sellValue, seasonTransferBudget } from "./market";

describe("playerFee", () => {
  it("rises steeply with rating", () => {
    expect(playerFee(90, 26)).toBeGreaterThan(playerFee(80, 26));
    expect(playerFee(80, 26)).toBeGreaterThan(playerFee(70, 26));
    // Top-end superstar should be a serious outlay vs a squad player.
    expect(playerFee(90, 26)).toBeGreaterThan(playerFee(72, 26) * 5);
  });

  it("pays a youth premium and discounts the old", () => {
    expect(playerFee(85, 21)).toBeGreaterThan(playerFee(85, 27));
    expect(playerFee(85, 34)).toBeLessThan(playerFee(85, 27));
  });

  it("never goes below 1", () => {
    expect(playerFee(60, 36)).toBeGreaterThanOrEqual(1);
  });
});

describe("sellValue", () => {
  it("is a notch under the buy fee", () => {
    expect(sellValue(85, 26)).toBeLessThan(playerFee(85, 26));
    expect(sellValue(85, 26)).toBeGreaterThan(playerFee(85, 26) * 0.8);
  });
});

describe("seasonTransferBudget", () => {
  it("scales with club wealth", () => {
    expect(seasonTransferBudget(88, 20, 10)).toBeGreaterThan(seasonTransferBudget(66, 20, 10));
  });
  it("rewards a higher finish", () => {
    expect(seasonTransferBudget(80, 20, 1)).toBeGreaterThan(seasonTransferBudget(80, 20, 18));
  });
  it("stays positive for a weak, relegated club", () => {
    expect(seasonTransferBudget(60, 20, 20)).toBeGreaterThan(0);
  });
});
