import { describe, it, expect } from "vitest";
import { playerFee, sellValue, seasonTransferBudget, startingBalance, prizeMoney } from "./market";

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

describe("startingBalance", () => {
  it("is steep — small clubs poor, elite clubs rich", () => {
    expect(startingBalance(94)).toBeGreaterThan(startingBalance(80));
    expect(startingBalance(80)).toBeGreaterThan(startingBalance(70));
    // A tiny club has almost nothing (floor 3), never below it.
    expect(startingBalance(40)).toBeGreaterThanOrEqual(3);
    expect(startingBalance(40)).toBeLessThan(10);
  });
  it("leaves a small club unable to buy a finished superstar", () => {
    // Bochum-ish (≈70) is nowhere near a peak-90 fee.
    expect(startingBalance(70)).toBeLessThan(playerFee(90, 26));
  });
});

describe("prizeMoney", () => {
  it("winning the league + cup banks more than mid-table", () => {
    const champ = prizeMoney({ finishPosition: 1, leagueSize: 20, champion: true, cupResult: "champion" });
    const mid = prizeMoney({ finishPosition: 10, leagueSize: 20, champion: false, cupResult: "did-not-qualify" });
    expect(champ).toBeGreaterThan(mid);
  });
  it("a bigger club draws bigger TV money", () => {
    const big = prizeMoney({ finishPosition: 5, leagueSize: 20, champion: false, cupResult: "did-not-qualify", clubStrength: 90 });
    const small = prizeMoney({ finishPosition: 5, leagueSize: 20, champion: false, cupResult: "did-not-qualify", clubStrength: 70 });
    expect(big).toBeGreaterThan(small);
  });
  it("stays modest — a small club's title doesn't bankroll a superstar", () => {
    const title = prizeMoney({ finishPosition: 1, leagueSize: 18, champion: true, cupResult: "did-not-qualify", clubStrength: 70 });
    expect(title).toBeLessThan(playerFee(90, 26)); // can't simply buy a peak star
  });
  it("pays a baseline even to a relegated club", () => {
    expect(
      prizeMoney({ finishPosition: 20, leagueSize: 20, champion: false, cupResult: "did-not-qualify" }),
    ).toBeGreaterThan(0);
  });
});
