import { describe, it, expect } from "vitest";
import { rivalryFor } from "./rivalries";

describe("rivalryFor", () => {
  it("names El Clásico both ways", () => {
    expect(rivalryFor("fc-barcelona", "real-madrid")).toBe("El Clásico");
    expect(rivalryFor("real-madrid", "fc-barcelona")).toBe("El Clásico");
  });

  it("works across modes — legends ids and real slugs map to the same club", () => {
    expect(rivalryFor("barcelona", "realmadrid")).toBe("El Clásico"); // legends ids
    expect(rivalryFor("dortmund", "fc-bayern-munchen")).toBe("Der Klassiker"); // mixed
    expect(rivalryFor("inter", "milan")).toBe("Derby della Madonnina");
  });

  it("returns null for non-rivals and unknown clubs", () => {
    expect(rivalryFor("fc-barcelona", "inter")).toBeNull();
    expect(rivalryFor("fc-barcelona", "some-random-club")).toBeNull();
    expect(rivalryFor("real-madrid", "real-madrid")).toBeNull();
    expect(rivalryFor(null, "fc-barcelona")).toBeNull();
  });
});
