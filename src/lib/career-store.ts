/**
 * Career-mode state — separate Zustand slice from the one-match store.
 *
 * Career mode (the GOLAZO experience inside Unschlagbar) is multi-session:
 *   - You pick a founding club (sticky for the whole career)
 *   - Play repeated seasons against AI rivals
 *   - Form, transfers, demands, relegation carry between seasons
 *   - localStorage persistence so progress survives a refresh
 *
 * The single-game store (src/lib/store.ts) and this career store coexist;
 * they don't share state. A user can be mid-Career and mid-Quick-Match at
 * the same time without collision.
 *
 * Schema version is tracked so we can migrate save data later without
 * breaking active careers.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Player, FormationKey } from "./game-types";

/** Bump this when a non-backwards-compat change to CareerState ships. */
export const CAREER_SCHEMA_VERSION = 4;

/** Snapshot of a completed season — written to seasonHistory at the moment
 *  the season is finalized. Used by /career/history (Hall of Fame). */
export interface SeasonRecord {
  season: number;
  leagueId: string;
  foundingClubId: string;
  formation: FormationKey;
  finalPosition: number; // 1 = champion, 12 = bottom
  totalLeagueClubs: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Outcome in the cup competition (only meaningful if user qualified). */
  cupResult: "champion" | "runner-up" | "semi-final" | "quarter-final" | "did-not-qualify";
  relegated: boolean;
  /** List of trophy names earned this season (e.g. 'League Champion'). */
  trophies: string[];
  /** ISO timestamp when this season ended. */
  endedAt: string;
  /** Top scorer for the season — read on the recap screen. Optional so
   *  pre-existing saves don't fail schema validation. */
  topScorer?: { name: string; goals: number };
}

/** A rival manager snapshot — saved after the draft so the season knows
 *  who the user is playing against and what each rival's squad looks like. */
export interface RivalManagerSave {
  id: string;
  name: string;
  badge: string;
  color: string;
  archetypeName: string;
  archetypeStyle: string;
  foundingClubId: string;
  squad: Player[];
}

export interface CareerState {
  /** Schema version of the persisted save. */
  schemaVersion: number;
  /** ISO timestamp when the career was started. */
  startedAt: string | null;
  /** ID of the founding club (sticky throughout the career). */
  foundingClubId: string | null;
  /** Which league we're playing in (e.g. 'laliga' if Real Madrid is founding). */
  leagueId: string | null;
  /** Preferred formation — toggleable at the start of any draft. */
  formation: FormationKey;
  /** 1-indexed current season number. */
  currentSeason: number;
  /** The user's permanent squad — survives season boundaries. */
  squad: Player[];
  /** The 11 AI rivals you face this season. Saved post-draft. */
  rivals: RivalManagerSave[];
  /** Per-player form, indexed by composite key `${club}:${name}`. */
  form: Record<string, number>;
  /** Total trophies won so far (league titles + cups + UCLs etc.). */
  trophies: number;
  /** Append-only log of completed seasons — surface in Hall of Fame. */
  seasonHistory: SeasonRecord[];
  /** True if the user was relegated last season → next season is a rebuild. */
  relegatedLastSeason: boolean;
  /** Composite key `${club}:${name}` of the founding-pick player — can never
   *  be sold, swapped, or removed. Set on the user's first draft pick. */
  franchisePlayerKey: string | null;
  /** True after the mid-season swap window has been used or skipped this
   *  season. Reset to false at the start of each new season. */
  midSeasonSwapUsed: boolean;
  /** Rerolls available in the NEXT draft (defaults to 3). Reduced to 1 if
   *  the user chose to keep a demanding star at the end of last season. */
  rerollsNextSeason: number;
  /** Composite key of the star demanding to leave at season end. The player
   *  is removed from the squad at the start of the next draft. */
  pendingDeparture: string | null;
  /** Per-season flag — true once the user has answered "keep him" or "let
   *  him go" to the end-of-season star demand. Reset on new season. */
  starDemandResolved: boolean;
  /** Matchday starting XI — player keys (`club:name`) of the (up to) 11
   *  starters selected from the squad. null = auto-pick best XI by
   *  effective rating. Additive field: legacy 11-player saves never set
   *  it and resolve to "everyone starts" via auto-pick. */
  startingXI: string[] | null;
  /** Wonderkid icon ids claimed by ANYONE this career (you or a rival).
   *  The pool is finite — a claimed legend never reappears. Drives the
   *  scarcity/FOMO of the wonderkid lottery. See lib/wonderkids.ts. */
  claimedWonderkidIds: string[];
  /** Player keys (`club:name`) shopped around in a FAILED wonderkid bid
   *  last window — they start the coming season unsettled (a morale hit).
   *  Replaced each transfer window (a one-season sulk). */
  unsettledKeys: string[];
}

const initialCareerState: CareerState = {
  schemaVersion: CAREER_SCHEMA_VERSION,
  startedAt: null,
  foundingClubId: null,
  leagueId: null,
  formation: "4-3-3",
  currentSeason: 1,
  squad: [],
  rivals: [],
  form: {},
  trophies: 0,
  seasonHistory: [],
  relegatedLastSeason: false,
  franchisePlayerKey: null,
  midSeasonSwapUsed: false,
  rerollsNextSeason: 3,
  pendingDeparture: null,
  starDemandResolved: false,
  startingXI: null,
  claimedWonderkidIds: [],
  unsettledKeys: [],
};

interface CareerStore extends CareerState {
  /** True if a career has been started (founding club picked). */
  hasActiveCareer: () => boolean;
  /** Begin a new career — wipes any existing save. */
  startCareer: (foundingClubId: string, leagueId: string) => void;
  /** Abandon current career and wipe save. */
  abandonCareer: () => void;
  /** Append a player to the permanent squad. */
  addToSquad: (player: Player) => void;
  /** Save the draft result (user squad + AI rivals) atomically. */
  commitDraft: (userSquad: Player[], rivals: RivalManagerSave[]) => void;
  /** Update form value for a player (clamped externally). */
  setForm: (playerKey: string, value: number) => void;
  /** Persist the user's preferred formation. */
  setFormation: (formation: FormationKey) => void;
  /** Append a completed season to the Hall-of-Fame log. */
  recordSeason: (record: SeasonRecord) => void;
  /** Mark whether the just-finished season ended in relegation. */
  setRelegated: (flag: boolean) => void;
  /** Lock in the franchise player — called once when the founding pick is made. */
  setFranchisePlayer: (playerKey: string) => void;
  /** Replace squad player at index N with a new player. Use for swap windows.
   *  Refuses to operate on the franchise player (no-op). */
  swapSquadPlayer: (oldIndex: number, newPlayer: Player) => void;
  /** Mark the mid-season swap window as resolved (used or skipped). */
  setMidSeasonSwapUsed: (flag: boolean) => void;
  /** Set the reroll budget available in the next draft (default 3). */
  setRerollsNextSeason: (n: number) => void;
  /** Mark a star as departing — they're removed from squad at next draft start. */
  setPendingDeparture: (playerKey: string | null) => void;
  /** Mark the end-of-season star demand as resolved (keep or let go chosen). */
  setStarDemandResolved: (flag: boolean) => void;
  /** Persist the user's matchday XI selection (player keys). null = auto. */
  setStartingXI: (keys: string[] | null) => void;
  /** Mark wonderkid icon ids as claimed (you or a rival) — removes them from
   *  the lottery pool for the rest of the career. Idempotent (dedups). */
  claimWonderkids: (iconIds: string[]) => void;
  /** Apply one season's growth/decline to the wonderkids on the squad.
   *  `updates` keyed by playerKey (`club:name`) → new prime_rating + age. */
  growWonderkids: (updates: Record<string, { prime_rating: number; age: number }>) => void;
}

export const useCareer = create<CareerStore>()(
  persist(
    (set, get) => ({
      ...initialCareerState,

      hasActiveCareer: () => get().foundingClubId !== null,

      startCareer: (foundingClubId, leagueId) =>
        set({
          schemaVersion: CAREER_SCHEMA_VERSION,
          startedAt: new Date().toISOString(),
          foundingClubId,
          leagueId,
          formation: "4-3-3",
          currentSeason: 1,
          squad: [],
          rivals: [],
          form: {},
          trophies: 0,
          seasonHistory: [],
          relegatedLastSeason: false,
          franchisePlayerKey: null,
          midSeasonSwapUsed: false,
          rerollsNextSeason: 3,
          pendingDeparture: null,
          starDemandResolved: false,
          claimedWonderkidIds: [],
          unsettledKeys: [],
        }),

      abandonCareer: () => set({ ...initialCareerState }),

      addToSquad: (player) =>
        set((state) => ({
          squad: [...state.squad, player],
        })),

      commitDraft: (userSquad, rivals) =>
        set({
          squad: userSquad,
          rivals,
        }),

      setForm: (playerKey, value) =>
        set((state) => ({
          form: { ...state.form, [playerKey]: value },
        })),

      setFormation: (formation) => set({ formation }),

      recordSeason: (record) =>
        set((state) => ({
          seasonHistory: [...state.seasonHistory, record],
          trophies: state.trophies + record.trophies.length,
        })),

      setRelegated: (flag) => set({ relegatedLastSeason: flag }),

      setFranchisePlayer: (playerKey) => set({ franchisePlayerKey: playerKey }),

      swapSquadPlayer: (oldIndex, newPlayer) =>
        set((state) => {
          const target = state.squad[oldIndex];
          if (!target) return state;
          const targetKey = `${target.club}:${target.name}`;
          // Hard rule: franchise player is untouchable.
          if (targetKey === state.franchisePlayerKey) return state;
          return {
            squad: state.squad.map((p, i) => (i === oldIndex ? newPlayer : p)),
          };
        }),

      setMidSeasonSwapUsed: (flag) => set({ midSeasonSwapUsed: flag }),

      setRerollsNextSeason: (n) => set({ rerollsNextSeason: Math.max(0, n) }),

      setPendingDeparture: (playerKey) => set({ pendingDeparture: playerKey }),

      setStarDemandResolved: (flag) => set({ starDemandResolved: flag }),

      setStartingXI: (keys) => set({ startingXI: keys }),

      claimWonderkids: (iconIds) =>
        set((state) => ({
          claimedWonderkidIds: Array.from(new Set([...state.claimedWonderkidIds, ...iconIds])),
        })),

      growWonderkids: (updates) =>
        set((state) => ({
          squad: state.squad.map((p) => {
            const u = updates[`${p.club}:${p.name}`];
            return u ? { ...p, prime_rating: u.prime_rating, age: u.age } : p;
          }),
        })),
    }),
    {
      name: "unschlagbar:career:v1",
      storage: createJSONStorage(() => localStorage),
      // Persist only the data fields, not the action functions
      partialize: (state) => ({
        schemaVersion: state.schemaVersion,
        startedAt: state.startedAt,
        foundingClubId: state.foundingClubId,
        leagueId: state.leagueId,
        formation: state.formation,
        currentSeason: state.currentSeason,
        squad: state.squad,
        rivals: state.rivals,
        form: state.form,
        trophies: state.trophies,
        seasonHistory: state.seasonHistory,
        relegatedLastSeason: state.relegatedLastSeason,
        franchisePlayerKey: state.franchisePlayerKey,
        midSeasonSwapUsed: state.midSeasonSwapUsed,
        rerollsNextSeason: state.rerollsNextSeason,
        pendingDeparture: state.pendingDeparture,
        starDemandResolved: state.starDemandResolved,
        startingXI: state.startingXI,
        claimedWonderkidIds: state.claimedWonderkidIds,
        unsettledKeys: state.unsettledKeys,
      }),
    },
  ),
);
