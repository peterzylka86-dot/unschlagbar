/**
 * Tests for the single-game Zustand store.
 *
 * Most surface is mechanical (set this, read that). The behaviour worth
 * pinning down is `reset()` — it has to wipe ALL single-run state so a
 * fresh "New Run" doesn't carry over a finished challenge.
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

  it("regression: clears challengeSeed (next run gets new fixtures)", () => {
    useGame.setState((s) => ({ config: { ...s.config, challengeSeed: 999 } }));
    expect(useGame.getState().config.challengeSeed).toBe(999);
    useGame.getState().reset();
    expect(useGame.getState().config.challengeSeed).toBeUndefined();
  });

  it("regression: clears challengerScore (no stale H2H comparison panel)", () => {
    useGame.setState((s) => ({
      config: {
        ...s.config,
        challengerScore: { wins: 10, draws: 5, losses: 5, goalsFor: 30, goalsAgainst: 20 },
      },
    }));
    expect(useGame.getState().config.challengerScore).toBeDefined();
    useGame.getState().reset();
    expect(useGame.getState().config.challengerScore).toBeUndefined();
  });

  it("regression: clears foundingPlayer (no surprise pre-assignment)", () => {
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
    expect(useGame.getState().config.foundingPlayer).toBeDefined();
    useGame.getState().reset();
    expect(useGame.getState().config.foundingPlayer).toBeUndefined();
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
