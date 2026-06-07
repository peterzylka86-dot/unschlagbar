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
import type { Player } from "./game-types";

/** Bump this when a non-backwards-compat change to CareerState ships. */
export const CAREER_SCHEMA_VERSION = 1;

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
}

const initialCareerState: CareerState = {
  schemaVersion: CAREER_SCHEMA_VERSION,
  startedAt: null,
  foundingClubId: null,
  leagueId: null,
  currentSeason: 1,
  squad: [],
  rivals: [],
  form: {},
  trophies: 0,
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
}

export const useCareer = create<CareerStore>()(
  persist(
    (set, get) => ({
      ...initialCareerState,

      hasActiveCareer: () => get().foundingClubId !== null,

      startCareer: (foundingClubId, leagueId) => set({
        schemaVersion: CAREER_SCHEMA_VERSION,
        startedAt: new Date().toISOString(),
        foundingClubId,
        leagueId,
        currentSeason: 1,
        squad: [],
        rivals: [],
        form: {},
        trophies: 0,
      }),

      abandonCareer: () => set({ ...initialCareerState }),

      addToSquad: (player) => set(state => ({
        squad: [...state.squad, player],
      })),

      commitDraft: (userSquad, rivals) => set({
        squad: userSquad,
        rivals,
      }),

      setForm: (playerKey, value) => set(state => ({
        form: { ...state.form, [playerKey]: value },
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
        currentSeason: state.currentSeason,
        squad: state.squad,
        rivals: state.rivals,
        form: state.form,
        trophies: state.trophies,
      }),
    },
  ),
);
