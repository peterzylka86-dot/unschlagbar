/**
 * Tests for challenge-link encode/decode + multiplayer ping-pong logic.
 *
 * The viral hook of the product is the challenge URL — friend pastes it,
 * gets the same seed/config. If encode/decode is silently broken, the
 * core growth mechanic stops working with zero user-visible error.
 *
 * shareImage (native share + download fallback) is NOT unit-tested here
 * — it depends on browser APIs (navigator.share, document.createElement,
 * fetch on data URLs) that aren't wired in our node test env. It's
 * exercised manually in the browser via the live recap/result screens.
 */
import { describe, it, expect } from "vitest";
import { encodeChallenge, decodeChallenge, buildShareText, challengeUrl } from "./share";
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
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
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
    {
      id: "gk",
      position: "GK",
      x: 50,
      y: 90,
      player: {
        name: "Manuel Neuer",
        position: "GK",
        prime_rating: 90,
        career_years: "2011-2024",
        nationality: "Germany",
        club: "bayern",
      },
    },
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

  it("regression: roundtrips an extended payload with challenger context", () => {
    // Path B async-multiplayer payload — the challenger's score travels
    // with the URL so the receiver can see what to beat.
    const extended: ChallengePayload = {
      ...samplePayload,
      challenger: {
        name: "Friend",
        wins: 17,
        draws: 3,
        losses: 2,
        goalsFor: 54,
        goalsAgainst: 21,
      },
    };
    const roundtripped = decodeChallenge(encodeChallenge(extended));
    expect(roundtripped).toEqual(extended);
    expect(roundtripped?.challenger?.wins).toBe(17);
  });

  it("challenger field is optional — old URLs (no challenger) still decode", () => {
    const oldStyle = encodeChallenge(samplePayload); // no challenger
    const decoded = decodeChallenge(oldStyle);
    expect(decoded).not.toBeNull();
    expect(decoded?.challenger).toBeUndefined();
  });

  it("regression: malformed challenger field doesn't corrupt the payload", () => {
    // If someone hand-edits a URL and breaks challenger.wins, the rest
    // of the payload should still decode (we trust the URL — minor field
    // garbage is acceptable; the comparison panel just won't render).
    const partial = { ...samplePayload, challenger: { wins: "oops" } };
    const encoded = btoa(JSON.stringify(partial))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const decoded = decodeChallenge(encoded);
    // Core fields preserved
    expect(decoded?.seed).toBe(samplePayload.seed);
    expect(decoded?.league).toBe(samplePayload.league);
  });
});

describe("challengeUrl", () => {
  it("produces a URL starting with the base origin + /?challenge=", () => {
    const url = challengeUrl(samplePayload);
    expect(url).toMatch(/\/\?challenge=[A-Za-z0-9_-]+$/);
  });

  it("the encoded query param is decode-able back to the same payload", () => {
    const url = challengeUrl(samplePayload);
    const queryPart = url.split("?challenge=")[1];
    expect(decodeChallenge(queryPart)).toEqual(samplePayload);
  });

  it("a challenger-embedded URL roundtrips through the query param", () => {
    const withScore: ChallengePayload = {
      ...samplePayload,
      challenger: { wins: 12, draws: 5, losses: 5, goalsFor: 40, goalsAgainst: 28 },
    };
    const url = challengeUrl(withScore);
    const queryPart = url.split("?challenge=")[1];
    const decoded = decodeChallenge(queryPart);
    expect(decoded?.challenger).toEqual(withScore.challenger);
  });
});

// ─── Full async-multiplayer ping-pong roundtrip ───────────────────────

describe("multiplayer ping-pong loop (end-to-end)", () => {
  // Simulates the full Path B flow: A finishes → A's URL → B opens →
  // B finishes → B's URL → A opens. Both directions must preserve
  // configuration AND each player's score for the head-to-head panel
  // to render correctly.

  it("preserves seed across both hops (same fixtures both ways)", () => {
    const aPayload: ChallengePayload = {
      league: "laliga",
      formation: "4-3-3",
      difficulty: "normal",
      ratingMode: "prime",
      draftMode: "squad",
      showRatings: true,
      seed: 555_123,
      challenger: { wins: 17, draws: 3, losses: 2, goalsFor: 54, goalsAgainst: 21 },
    };
    // A → URL → B decodes
    const aUrl = challengeUrl(aPayload);
    const aReceived = decodeChallenge(aUrl.split("?challenge=")[1]);
    expect(aReceived?.seed).toBe(aPayload.seed);
    expect(aReceived?.league).toBe("laliga");

    // B plays, returns fire with their own score (different wins, same seed)
    const bPayload: ChallengePayload = {
      ...aPayload,
      challenger: { wins: 15, draws: 5, losses: 2, goalsFor: 48, goalsAgainst: 19 },
    };
    const bUrl = challengeUrl(bPayload);
    const bReceived = decodeChallenge(bUrl.split("?challenge=")[1]);

    // Seed survives — A would replay the same fixtures
    expect(bReceived?.seed).toBe(aPayload.seed);
    // B's score made it through — A's /result will render the H2H panel
    expect(bReceived?.challenger?.wins).toBe(15);
    expect(bReceived?.challenger?.goalsFor).toBe(48);
  });

  it("seed-stability: same payload encoded twice produces identical URLs (deterministic)", () => {
    // The URL is the share token. If encoding were non-deterministic
    // (e.g. JSON.stringify with key reordering), the same friend could
    // get TWO different URLs for the same challenge — confusing.
    const url1 = challengeUrl(samplePayload);
    const url2 = challengeUrl(samplePayload);
    expect(url1).toBe(url2);
  });

  it("the receiver's view of the challenger score matches what was encoded", () => {
    // Critical: B's /result panel must show A's exact W/D/L. Numbers can't drift.
    const sent: ChallengePayload["challenger"] = {
      wins: 18,
      draws: 1,
      losses: 3,
      goalsFor: 62,
      goalsAgainst: 24,
    };
    const url = challengeUrl({ ...samplePayload, challenger: sent });
    const received = decodeChallenge(url.split("?challenge=")[1])?.challenger;
    expect(received).toEqual(sent);
    // Points derive identically on both sides
    const sentPts = sent.wins * 3 + sent.draws;
    const recvPts = (received?.wins ?? 0) * 3 + (received?.draws ?? 0);
    expect(recvPts).toBe(sentPts);
  });

  it("optional name field travels through encode/decode", () => {
    const url = challengeUrl({
      ...samplePayload,
      challenger: { name: "Anna", wins: 12, draws: 5, losses: 5, goalsFor: 40, goalsAgainst: 28 },
    });
    const decoded = decodeChallenge(url.split("?challenge=")[1]);
    expect(decoded?.challenger?.name).toBe("Anna");
  });
});

// ─── Head-to-head outcome logic (pure, /result panel) ─────────────────

describe("head-to-head outcome (multiplayer comparison)", () => {
  // This mirrors the inline logic in /result so the comparison panel
  // can never silently flip a win/loss. Computed as `userPts vs themPts`
  // where pts = W*3 + D.
  function outcome(
    you: { w: number; d: number },
    them: { w: number; d: number },
  ): "win" | "loss" | "tie" {
    const u = you.w * 3 + you.d;
    const t = them.w * 3 + them.d;
    if (u > t) return "win";
    if (u < t) return "loss";
    return "tie";
  }

  it("higher pts wins", () => {
    expect(outcome({ w: 18, d: 1 }, { w: 17, d: 2 })).toBe("win");
    expect(outcome({ w: 17, d: 2 }, { w: 18, d: 1 })).toBe("loss");
  });

  it("equal pts is a tie even with different W/D mixes", () => {
    // 17W 3D = 54 pts. 16W 6D = 54 pts. Same points, different paths.
    expect(outcome({ w: 17, d: 3 }, { w: 16, d: 6 })).toBe("tie");
  });

  it("zero-pts edge case (both teams winless)", () => {
    expect(outcome({ w: 0, d: 0 }, { w: 0, d: 0 })).toBe("tie");
  });

  it("a single draw beats zero", () => {
    expect(outcome({ w: 0, d: 1 }, { w: 0, d: 0 })).toBe("win");
  });
});

describe("buildShareText with matches", () => {
  const config: RunConfig = {
    league: "ucl",
    formation: "4-3-3",
    difficulty: "normal",
    ratingMode: "prime",
    draftMode: "squad",
    showRatings: true,
  };
  const slots: Slot[] = [
    {
      id: "gk",
      position: "GK",
      x: 50,
      y: 90,
      player: {
        name: "Manuel Neuer",
        position: "GK",
        prime_rating: 90,
        career_years: "2011-2024",
        nationality: "Germany",
        club: "bayern",
      },
    },
    { id: "st", position: "ST", x: 50, y: 16, player: undefined },
  ];

  it("with matches passed in, shows W/D/L line", () => {
    const text = buildShareText(
      config,
      slots,
      [
        {
          matchday: 1,
          opponent: {
            id: "c",
            name: "C",
            short: "C",
            city: "x",
            color: "#000",
            founded: 1900,
            strength: 75,
            era: "current",
            era_tier: "current",
          },
          home: true,
          ourScore: 3,
          theirScore: 0,
          outcome: "W",
        },
      ],
      42,
    );
    expect(text).toContain("1W 0D 0L");
    expect(text).toContain("3:0");
  });
});
