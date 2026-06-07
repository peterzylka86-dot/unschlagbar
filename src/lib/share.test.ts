/**
 * Tests for challenge-link encode/decode.
 *
 * The viral hook of the product is the challenge URL — friend pastes it,
 * gets the same seed/config. If encode/decode is silently broken, the
 * core growth mechanic stops working with zero user-visible error.
 */
import { describe, it, expect } from "vitest";
import { encodeChallenge, decodeChallenge, buildShareText } from "./share";
import type { ChallengePayload } from "./share";
import type { RunConfig, Slot } from "./game-types";
import { LEAGUES } from "./leagues";

const samplePayload: ChallengePayload = {
  league: "ucl",
  formation: "4-3-3",
  difficulty: "normal",
  ratingMode: "prime",
  draftMode: "squad",
  showRatings: true,
  seed: 123456789,
};

describe("challenge encoding", () => {
  it("round-trips a payload", () => {
    const encoded = encodeChallenge(samplePayload);
    const decoded = decodeChallenge(encoded);
    expect(decoded).toEqual(samplePayload);
  });

  it("produces a URL-safe string (no +, /, or = chars)", () => {
    const encoded = encodeChallenge(samplePayload);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("decoding garbage returns null without throwing", () => {
    expect(decodeChallenge("not-base64-at-all-$$$")).toBeNull();
    expect(decodeChallenge("")).toBeNull();
    expect(decodeChallenge("aaaa")).toBeNull(); // valid b64 but not valid JSON
  });

  it("decoding a payload without seed returns null", () => {
    // craft a base64 of a missing-fields payload
    const malformed = btoa(JSON.stringify({ league: "ucl" }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeChallenge(malformed)).toBeNull();
  });

  it("preserves all RunConfig fields the player picked", () => {
    const variants: ChallengePayload[] = [
      { ...samplePayload, difficulty: "easy" },
      { ...samplePayload, difficulty: "hard" },
      { ...samplePayload, formation: "5-4-1" },
      { ...samplePayload, draftMode: "quick" },
      { ...samplePayload, showRatings: false },
      { ...samplePayload, ratingMode: "career" },
    ];
    for (const p of variants) {
      expect(decodeChallenge(encodeChallenge(p))).toEqual(p);
    }
  });
});

describe("buildShareText", () => {
  const config: RunConfig = {
    league: "ucl",
    formation: "4-3-3",
    difficulty: "normal",
    ratingMode: "prime",
    draftMode: "squad",
    showRatings: true,
  };
  const slots: Slot[] = [
    { id: "gk", position: "GK", x: 50, y: 90,
      player: { name: "Manuel Neuer", position: "GK", prime_rating: 90,
                career_years: "2011-2024", nationality: "Germany", club: "bayern" } },
    { id: "st", position: "ST", x: 50, y: 16, player: undefined },
  ];

  it("starts with the league brand mark (derived from LEAGUES so it survives copy edits)", () => {
    const text = buildShareText(config, slots, undefined, 42);
    expect(text.split("\n")[0]).toContain(LEAGUES[config.league].brandMark);
  });

  it("includes a Challenge URL line", () => {
    const text = buildShareText(config, slots, undefined, 42);
    expect(text).toMatch(/Challenge:\s*https?:\/\//);
  });

  it("includes the picked player's name", () => {
    const text = buildShareText(config, slots, undefined, 42);
    expect(text).toContain("Manuel Neuer");
  });

  it("with matches passed in, shows W/D/L line", () => {
    const text = buildShareText(config, slots, [
      { matchday: 1, opponent: { id: "c", name: "C", short: "C", city: "x",
        color: "#000", founded: 1900, strength: 75, era: "current", era_tier: "current" },
        home: true, ourScore: 3, theirScore: 0, outcome: "W" },
    ], 42);
    expect(text).toContain("1W 0D 0L");
    expect(text).toContain("3:0");
  });
});
