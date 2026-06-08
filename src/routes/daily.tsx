import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useGame } from "@/lib/store";
import {
  dailySeed,
  dailyDateLabel,
  getDaily,
  getDailyStreak,
  type DailyResult,
} from "@/lib/daily";

export const Route = createFileRoute("/daily")({
  head: () => ({
    meta: [
      { title: "Daily Challenge · UNSCHLAGBAR" },
      {
        name: "description",
        content:
          "Same wheel rolls for everyone today. Chase the unbeaten Champions League run and compare with the world.",
      },
    ],
  }),
  component: DailyScreen,
});

// Locked config for the Daily — every player gets the same constraints
// so scores are comparable. Picked UCL (13 matches, knockout = quick + dramatic)
// for v1. Future iteration could rotate league by day of week.
const DAILY_CONFIG = {
  league: "ucl" as const,
  formation: "4-3-3" as const,
  difficulty: "normal" as const,
  ratingMode: "prime" as const,
  draftMode: "squad" as const,
  showRatings: true,
};

function DailyScreen() {
  const navigate = useNavigate();
  const setConfig = useGame((s) => s.setConfig);
  const reset = useGame((s) => s.reset);

  // Read localStorage on mount only — render keeps a snapshot to avoid
  // SSR mismatch on first paint.
  const [today, setToday] = useState<{
    seed: number;
    label: string;
    result: DailyResult | null;
    streak: number;
  } | null>(null);

  useEffect(() => {
    const seed = dailySeed();
    setToday({
      seed,
      label: dailyDateLabel(seed),
      result: getDaily(seed),
      streak: getDailyStreak(),
    });
  }, []);

  function playDaily() {
    if (!today) return;
    setConfig({
      ...DAILY_CONFIG,
      challengeSeed: today.seed,
      // Wipe any leftover challenger score from a prior challenge URL —
      // Daily is a solo cohort play, not asymmetric H2H.
      challengerScore: undefined,
      foundingPlayer: undefined,
    });
    reset();
    navigate({ to: "/game", search: { new: true } });
  }

  return (
    <div className="min-h-screen px-4 py-12 max-w-xl mx-auto">
      <div className="text-center">
        <Link
          to="/"
          search={{ challenge: undefined as never }}
          className="text-[11px] text-muted-foreground hover:text-warning underline"
        >
          ← Home
        </Link>
        <div className="mt-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-warning/40 bg-warning/10 text-warning text-[10px] font-semibold tracking-widest uppercase">
          🗓️ Daily Challenge
        </div>
        <h1 className="mt-5 brand-mark text-5xl text-warning leading-none">
          {today?.label ?? "—"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Same wheel · Same fixtures · Everyone today.
          <br />
          🏆 Champions League · 4-3-3 · Normal difficulty
        </p>

        {/* Streak ribbon — survives until two consecutive missed days */}
        {today && today.streak > 0 && (
          <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-warning/30 bg-card/40">
            <span className="text-2xl">🔥</span>
            <div className="text-left">
              <div className="font-display text-xl leading-none">{today.streak}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                day streak
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Already-played state — first play wins, no replay */}
      {today?.result ? (
        <div className="mt-8 rounded-2xl border-2 border-warning/40 bg-warning/5 p-6 text-center">
          <div className="text-[10px] uppercase tracking-[0.25em] text-warning/80 mb-2">
            ✓ Played today
          </div>
          <div className="font-display text-4xl tabular-nums">
            <span className="text-success">{today.result.wins}</span>
            <span className="text-muted-foreground mx-1">·</span>
            <span className="text-warning">{today.result.draws}</span>
            <span className="text-muted-foreground mx-1">·</span>
            <span className="text-destructive">{today.result.losses}</span>
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {today.result.wins * 3 + today.result.draws} pts ·{" "}
            {today.result.goalsFor}:{today.result.goalsAgainst}
            {today.result.losses === 0 && today.result.wins + today.result.draws > 0 && (
              <span className="ml-2 text-warning">★ UNBEATEN</span>
            )}
          </div>
          {today.result.topScorer && (
            <div className="mt-3 text-xs text-muted-foreground">
              ⚽ Top scorer: {today.result.topScorer.name} ({today.result.topScorer.goals})
            </div>
          )}
          <p className="mt-5 text-xs text-muted-foreground italic">
            Come back tomorrow for a fresh seed.
          </p>
          <Link
            to="/"
            search={{ challenge: undefined as never }}
            className="mt-6 inline-block px-5 py-2.5 rounded-md border border-warning/40 text-warning text-sm hover:bg-warning/10 transition"
          >
            Play a regular run instead →
          </Link>
        </div>
      ) : (
        <div className="mt-8 flex flex-col items-stretch gap-3">
          <button
            onClick={playDaily}
            disabled={!today}
            className="px-6 py-5 rounded-md bg-primary text-primary-foreground font-display text-lg tracking-[0.15em] uppercase shadow-[0_18px_40px_-10px] shadow-primary/70 hover:brightness-110 hover:-translate-y-0.5 transition border border-primary-foreground/10 disabled:opacity-50"
          >
            ⚡ Play today's challenge
          </button>
          <p className="text-center text-[11px] text-muted-foreground italic">
            One attempt per day — make it count. Streak breaks after 2 missed days.
          </p>
        </div>
      )}
    </div>
  );
}
