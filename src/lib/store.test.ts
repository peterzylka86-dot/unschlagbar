/**
 * Tests for the single-game Zustand store.
 *
 * Two reset paths matter:
 *   reset()           — wipe in-progress run state; PRESERVE config.
 *                       Used by the landing's challenge-URL decode flow
 *                       (setConfig with new challengeSeed → reset → nav).
 *                       If reset cleared config we'd erase the challenge.
 *   resetForNewRun()  — same as reset PLUS wipe single-run-scoped config
 *                       fields (challengeSeed / challengerScore /
 *                       foundingPlayer). Used by /result's "New Run".
 *
 * Both behaviours are pinned by regression tests below.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useGame } from "./store";

describe("useGame reset()", () => {
  beforeEach(() => {
    // Start from a known clean slate before each test
    useGame.getState().reset();
    useGame.setState({
      config: {
        league: "ucl",
        formation: "4-3-3",
        difficulty: "normal",
        showRatings: true,
        draftMode: "squad",
        ratingMode: "prime",
      },
    });
    useGame.getState().reset();
  });

  it("regenerates slots from the active formation", () => {
    useGame.getState().reset();
    const slots = useGame.getState().slots;
    expect(slots).toHaveLength(11);
    expect(slots.every((s) => s.player === undefined)).toBe(true);
  });

  it("clears matches", () => {
    useGame.setState({
      matches: [
        {
          matchday: 1,
          opponent: {
            id: "x",
            name: "X",
            short: "X",
            city: "X",
            color: "#000",
            founded: 1900,
            strength: 75,
            era: "current",
            era_tier: "current",
          },
          home: true,
          ourScore: 1,
          theirScore: 0,
          outcome: "W",
        },
      ],
    });
    useGame.getState().reset();
    expect(useGame.getState().matches).toEqual([]);
  });

  // Regression: a finished challenge run left these three fields in the
  // config so the NEXT "New Run" replayed the same fixtures and showed a
  // stale H2H panel. reset() must wipe single-run-scoped state.

  // CRITICAL: reset() must NOT clear config fields. The landing's
  // challenge-URL decode flow runs setConfig({ challengeSeed, ... })
  // THEN reset() THEN navigate. If reset wiped challengeSeed we'd erase
  // the friend's challenge the user just opened.

  it("regression: reset() PRESERVES challengeSeed (landing flow safe)", () => {
    useGame.setState((s) => ({ config: { ...s.config, challengeSeed: 999 } }));
    useGame.getState().reset();
    expect(useGame.getState().config.challengeSeed).toBe(999);
  });

  it("regression: reset() PRESERVES challengerScore", () => {
    useGame.setState((s) => ({
      config: {
        ...s.config,
        challengerScore: { wins: 10, draws: 5, losses: 5, goalsFor: 30, goalsAgainst: 20 },
      },
    }));
    useGame.getState().reset();
    expect(useGame.getState().config.challengerScore).toBeDefined();
  });

  it("regression: reset() PRESERVES foundingPlayer", () => {
    const founding = {
      name: "Test",
      position: "ST" as const,
      prime_rating: 90,
      career_years: "2020-2024",
      nationality: "Test",
      club: "test",
    };
    useGame.setState((s) => ({ config: { ...s.config, foundingPlayer: founding } }));
    useGame.getState().reset();
    expect(useGame.getState().config.foundingPlayer).toEqual(founding);
  });

  it("preserves the user's config choices (league, formation, difficulty, etc.)", () => {
    useGame.setState({
      config: {
        league: "laliga",
        formation: "4-4-2",
        difficulty: "hard",
        showRatings: false,
        draftMode: "quick",
        ratingMode: "career",
      },
    });
    useGame.getState().reset();
    const cfg = useGame.getState().config;
    expect(cfg.league).toBe("laliga");
    expect(cfg.formation).toBe("4-4-2");
    expect(cfg.difficulty).toBe("hard");
    expect(cfg.showRatings).toBe(false);
    expect(cfg.draftMode).toBe("quick");
    expect(cfg.ratingMode).toBe("career");
  });

  it("reset is idempotent — calling twice yields the same state", () => {
    useGame.getState().reset();
    const a = useGame.getState();
    useGame.getState().reset();
    const b = useGame.getState();
    expect(b.slots.length).toBe(a.slots.length);
    expect(b.matches).toEqual(a.matches);
    expect(b.rerollsLeft).toBe(a.rerollsLeft);
  });
});

describe("useGame resetForNewRun()", () => {
  beforeEach(() => {
    useGame.setState({
      config: {
        league: "ucl",
        formation: "4-3-3",
        difficulty: "normal",
        showRatings: true,
        draftMode: "squad",
        ratingMode: "prime",
      },
    });
    useGame.getState().reset();
  });

  // resetForNewRun is the DEEPER reset — used by /result's "New Run"
  // button. It should wipe everything reset() wipes AND clear the
  // single-run-scoped config fields so the next run starts clean.

  it("clears challengeSeed (next run gets new fixtures, not the same seed again)", () => {
    useGame.setState((s) => ({ config: { ...s.config, challengeSeed: 999 } }));
    useGame.getState().resetForNewRun();
    expect(useGame.getState().config.challengeSeed).toBeUndefined();
  });

  it("clears challengerScore (no stale H2H panel on the next /result)", () => {
    useGame.setState((s) => ({
      config: {
        ...s.config,
        challengerScore: { wins: 10, draws: 5, losses: 5, goalsFor: 30, goalsAgainst: 20 },
      },
    }));
    useGame.getState().resetForNewRun();
    expect(useGame.getState().config.challengerScore).toBeUndefined();
  });

  it("clears foundingPlayer (no surprise pre-assignment)", () => {
    useGame.setState((s) => ({
      config: {
        ...s.config,
        foundingPlayer: {
          name: "Test",
          position: "ST",
          prime_rating: 90,
          career_years: "2020-2024",
          nationality: "Test",
          club: "test",
        },
      },
    }));
    useGame.getState().resetForNewRun();
    expect(useGame.getState().config.foundingPlayer).toBeUndefined();
  });

  it("preserves league / formation / difficulty / draft mode / rating mode", () => {
    useGame.setState({
      config: {
        league: "laliga",
        formation: "4-4-2",
        difficulty: "hard",
        showRatings: false,
        draftMode: "quick",
        ratingMode: "career",
        challengeSeed: 111,
      },
    });
    useGame.getState().resetForNewRun();
    const cfg = useGame.getState().config;
    expect(cfg.league).toBe("laliga");
    expect(cfg.formation).toBe("4-4-2");
    expect(cfg.difficulty).toBe("hard");
    expect(cfg.draftMode).toBe("quick");
    expect(cfg.ratingMode).toBe("career");
    expect(cfg.challengeSeed).toBeUndefined();
  });

  it("regenerates slots from the active formation (like reset)", () => {
    useGame.getState().resetForNewRun();
    expect(useGame.getState().slots).toHaveLength(11);
  });
});

// ─── End-to-end: full challenge-URL flow ───────────────────────────────

describe("end-to-end challenge flow (regression)", () => {
  it("landing flow: setConfig + reset preserves the challenge state", () => {
    // This mirrors src/routes/index.tsx exactly:
    //   setConfig({ challengeSeed, challengerScore, ... }) → reset() → nav
    // The bug fixed in this commit was reset() wiping what setConfig
    // had just set, breaking every incoming challenge URL.
    const incomingPayload = {
      league: "laliga" as const,
      formation: "4-3-3" as const,
      difficulty: "normal" as const,
      ratingMode: "prime" as const,
      draftMode: "squad" as const,
      showRatings: true,
      challengeSeed: 12345,
      challengerScore: { wins: 17, draws: 3, losses: 2, goalsFor: 54, goalsAgainst: 21 },
    };
    useGame.getState().setConfig(incomingPayload);
    useGame.getState().reset();
    // After reset, the friend's challenge context MUST survive:
    const cfg = useGame.getState().config;
    expect(cfg.challengeSeed).toBe(12345);
    expect(cfg.challengerScore?.wins).toBe(17);
    expect(cfg.challengerScore?.goalsFor).toBe(54);
    // And the run state IS cleared:
    expect(useGame.getState().slots.every((s) => s.player === undefined)).toBe(true);
    expect(useGame.getState().matches).toEqual([]);
  });

  it("new-run flow: resetForNewRun wipes challenge AFTER completing one", () => {
    // User finishes a challenge → /result → "New Run" → resetForNewRun
    useGame.getState().setConfig({
      league: "laliga",
      formation: "4-3-3",
      difficulty: "normal",
      ratingMode: "prime",
      draftMode: "squad",
      showRatings: true,
      challengeSeed: 12345,
      challengerScore: { wins: 17, draws: 3, losses: 2, goalsFor: 54, goalsAgainst: 21 },
    });
    useGame.getState().resetForNewRun();
    const cfg = useGame.getState().config;
    expect(cfg.challengeSeed).toBeUndefined();
    expect(cfg.challengerScore).toBeUndefined();
    // Config choices preserved:
    expect(cfg.league).toBe("laliga");
    expect(cfg.formation).toBe("4-3-3");
  });
});
