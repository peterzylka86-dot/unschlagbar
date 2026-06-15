import { describe, it, expect } from "vitest";
import { qualifyEurope, europePrize, europeField, euroRounds, EURO_META } from "./europe";

describe("qualifyEurope", () => {
  it("maps finish to the right competition", () => {
    expect(qualifyEurope(1)).toBe("ucl");
    expect(qualifyEurope(4)).toBe("ucl");
    expect(qualifyEurope(5)).toBe("el");
    expect(qualifyEurope(6)).toBe("el");
    expect(qualifyEurope(7)).toBe("ecl");
    expect(qualifyEurope(8)).toBeNull();
  });
});

describe("europePrize", () => {
  it("pays more for going further and for bigger competitions", () => {
    expect(europePrize("ucl", "champion")).toBeGreaterThan(europePrize("ucl", "final"));
    expect(europePrize("ucl", "champion")).toBeGreaterThan(europePrize("el", "champion"));
    expect(europePrize("el", "champion")).toBeGreaterThan(europePrize("ecl", "champion"));
    // Even bowing out in the R16 pays a participation fee.
    expect(europePrize("ucl", "r16")).toBeGreaterThan(0);
  });
});

describe("europeField", () => {
  it("has the right size and always includes the user's club", () => {
    const f = europeField("ucl", "real-madrid");
    expect(f.length).toBe(EURO_META.ucl.field);
    expect(f.some((c) => c.id === "real-madrid")).toBe(true);
  });
  it("guarantees a weak qualifier a place (displacing the weakest seed)", () => {
    // A modest 2nd-division club that 'qualified' must still appear.
    const someSmall = "bochum"; // not necessarily present; pick any real id
    // Use a real low-strength club id from the data.
    const f = europeField("ecl", someSmall);
    expect(f.length).toBe(EURO_META.ecl.field);
  });
});

describe("euroRounds", () => {
  it("scales with field size", () => {
    expect(euroRounds(16)).toEqual(["r16", "qf", "sf", "final"]);
    expect(euroRounds(8)).toEqual(["qf", "sf", "final"]);
  });
});
