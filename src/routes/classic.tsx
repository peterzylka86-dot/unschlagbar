/**
 * /classic — Classic Squads picker (Option B prototype).
 *
 * Lists the curated historical real teams. Picking one loads its XI into
 * the single-match game store and jumps straight to the season sim — the
 * user inherits a real squad and chases its real-life achievement.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useGame } from "@/lib/store";
import { LEAGUES } from "@/lib/leagues";
import { CLASSIC_SQUADS, classicToSlots, type ClassicSquad } from "@/lib/classics";

export const Route = createFileRoute("/classic")({
  head: () => ({
    meta: [
      { title: "Classic Squads · UNSCHLAGBAR" },
      {
        name: "description",
        content:
          "Play the legendary real teams of football history — the Invincibles, Pep's Barça, cult Bundesliga sides. Inherit the XI, chase the achievement.",
      },
    ],
  }),
  component: ClassicPicker,
});

function ClassicPicker() {
  const navigate = useNavigate();
  const setConfig = useGame((s) => s.setConfig);
  const setSlots = useGame((s) => s.setSlots);
  const reset = useGame((s) => s.reset);

  function play(squad: ClassicSquad) {
    // Clear any in-flight run, set this classic's config, then overwrite
    // the (now-empty) formation slots with the real XI and kick off.
    reset();
    setConfig({
      league: squad.league,
      formation: squad.formation,
      difficulty: "normal",
      showRatings: true,
      draftMode: "squad",
      ratingMode: "prime",
      challengeSeed: undefined,
      challengerScore: undefined,
      foundingPlayer: undefined,
    });
    setSlots(classicToSlots(squad));
    navigate({ to: "/season" });
  }

  return (
    <div className="min-h-screen px-4 py-10 max-w-2xl mx-auto">
      <header className="text-center">
        <Link to="/" search={{ challenge: undefined as never }} className="inline-block">
          <h1 className="brand-mark text-4xl text-warning leading-none">CLASSIC SQUADS</h1>
          <div className="text-[10px] tracking-[0.3em] text-warning/80 mt-1">
            REAL TEAMS · REAL HISTORY
          </div>
        </Link>
        <p className="mt-4 text-sm text-muted-foreground max-w-md mx-auto">
          Inherit a legendary real squad and chase its real-life feat. No drafting — the XI is
          history, the result is up to you.
        </p>
      </header>

      <div className="mt-8 space-y-3">
        {CLASSIC_SQUADS.map((sq) => (
          <button
            key={sq.slug}
            onClick={() => play(sq)}
            className="group w-full text-left rounded-2xl border-2 p-5 transition hover:-translate-y-0.5 hover:brightness-110"
            style={{
              borderColor: `${sq.accent}66`,
              background: `linear-gradient(135deg, ${sq.accent}22, transparent 70%)`,
            }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-display text-lg" style={{ color: sq.accent }}>
                {sq.name}
              </div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground shrink-0">
                {sq.season}
              </div>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {sq.manager} · {sq.formation} · {LEAGUES[sq.league].name} all-timers as opponents
            </div>
            <p className="mt-2 text-sm text-foreground/85">{sq.blurb}</p>
            <div className="mt-3 inline-flex items-center gap-2 text-xs font-display tracking-wide text-warning">
              ▶ Take charge →
            </div>
          </button>
        ))}
      </div>

      <p className="mt-8 text-center text-[11px] text-muted-foreground italic">
        A prototype. These are hand-curated fan recreations — names &amp; ratings are our own
        interpretation, not affiliated with any club or ratings provider.
      </p>

      <footer className="mt-8 text-center">
        <Link
          to="/"
          search={{ challenge: undefined as never }}
          className="text-[11px] text-muted-foreground hover:text-warning underline"
        >
          ← back to home
        </Link>
      </footer>
    </div>
  );
}
