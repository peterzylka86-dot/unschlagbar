import { create } from "zustand";
import type { RunConfig, Slot, MatchResult, Player } from "./game-types";
import { FORMATIONS } from "./formations";

interface GameState {
  config: RunConfig;
  slots: Slot[];
  rerollsLeft: number;
  matches: MatchResult[];
  setConfig: (patch: Partial<RunConfig>) => void;
  reset: () => void;
  setSlots: (slots: Slot[]) => void;
  assignPlayer: (slotId: string, player: Player) => void;
  setMatches: (m: MatchResult[]) => void;
  consumeReroll: () => boolean;
}

const defaultConfig: RunConfig = {
  league: "bundesliga",
  formation: "4-3-3",
  difficulty: "normal",
  showRatings: true,
  draftMode: "squad",
  ratingMode: "prime",
};

function rerollsFor(d: RunConfig["difficulty"]) {
  return d === "easy" ? 3 : d === "normal" ? 1 : 0;
}

export const useGame = create<GameState>((set, get) => ({
  config: defaultConfig,
  slots: FORMATIONS[defaultConfig.formation].slots.map((s) => ({ ...s })),
  rerollsLeft: rerollsFor(defaultConfig.difficulty),
  matches: [],
  setConfig: (patch) =>
    set((state) => {
      const config = { ...state.config, ...patch };
      const slots = patch.formation
        ? FORMATIONS[patch.formation].slots.map((s) => ({ ...s }))
        : state.slots;
      return {
        config,
        slots,
        rerollsLeft: patch.difficulty ? rerollsFor(patch.difficulty) : state.rerollsLeft,
      };
    }),
  reset: () =>
    set({
      slots: FORMATIONS[get().config.formation].slots.map((s) => ({ ...s })),
      rerollsLeft: rerollsFor(get().config.difficulty),
      matches: [],
    }),
  setSlots: (slots) => set({ slots }),
  assignPlayer: (slotId, player) =>
    set((state) => ({
      slots: state.slots.map((s) => (s.id === slotId ? { ...s, player } : s)),
    })),
  setMatches: (matches) => set({ matches }),
  consumeReroll: () => {
    const left = get().rerollsLeft;
    if (left <= 0) return false;
    set({ rerollsLeft: left - 1 });
    return true;
  },
}));
