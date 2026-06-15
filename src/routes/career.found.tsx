/**
 * /career/found — founding club picker
 *
 * The first decision in a GOLAZO career. The user picks ONE club from any
 * league, and that club anchors the entire career: AI rivals are drawn
 * from the same league, season fixtures are built against them, and the
 * draft starts with this club's legends as the first-pick options.
 *
 * Showing all ~340 clubs at once is overwhelming — group by league so the
 * mental model is "pick a vibe (Spanish football / German football / etc.)
 * then pick your club within it."
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";
import { getClubs } from "@/lib/data";
import { realLeagues } from "@/lib/real-data";
import { useCareer } from "@/lib/career-store";

export const Route = createFileRoute("/career/found")({
  head: () => ({ meta: [{ title: "Pick a founding club · GOLAZO" }] }),
  component: FoundingClubPicker,
});

/** Leagues that make sense as a Career-mode home. WC modes excluded — your
 *  career is anchored to a club, not a national team. */
const CAREER_LEAGUES: LeagueId[] = [
  "ucl", // top European clubs, most prestigious career
  "bundesliga",
  "laliga",
  "seriea",
  "swiss",
  "womens",
];

function FoundingClubPicker() {
  const startCareer = useCareer((s) => s.startCareer);
  const navigate = useNavigate();
  const [mode, setMode] = useState<"real" | "legends">("legends");
  const [activeLegends, setActiveLegends] = useState<LeagueId>("ucl");
  const realLgs = realLeagues();
  const [activeReal, setActiveReal] = useState<string>(realLgs[0]?.slug ?? "es1");

  const activeLeague = mode === "real" ? activeReal : activeLegends;
  // Strongest clubs first — what most newcomers expect.
  const sortedClubs =
    mode === "real"
      ? (realLgs.find((l) => l.slug === activeReal)?.clubs ?? [])
      : [...getClubs(activeLegends)].sort((a, b) => b.strength - a.strength);

  function pick(clubId: string) {
    startCareer(clubId, activeLeague, mode);
    navigate({ to: "/career/draft" });
  }

  return (
    <div className="min-h-screen px-4 py-10 max-w-3xl mx-auto">
      <header className="text-center">
        <Link
          to="/career"
          className="text-[11px] text-muted-foreground hover:text-warning underline"
        >
          ← back to GOLAZO
        </Link>
        <h1 className="mt-3 font-display text-3xl text-warning">Pick your founding club</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          One choice that anchors your entire career. Your founding club shapes the league, the AI
          rivals you face, and the legends available in your first draft.
        </p>
      </header>

      <section className="mt-8">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Mode</div>
        <div className="grid grid-cols-2 gap-2">
          {([
            { id: "real", icon: "📅", title: "Real", blurb: "Today's players & current squads" },
            { id: "legends", icon: "🏆", title: "Legends", blurb: "Six decades of all-time greats + wonderkids" },
          ] as const).map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`p-4 rounded-xl border text-left transition ${
                mode === m.id
                  ? "border-warning bg-warning/15"
                  : "border-border bg-card hover:border-foreground/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{m.icon}</span>
                <span className={`font-display text-base ${mode === m.id ? "text-warning" : ""}`}>
                  {m.title}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">{m.blurb}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">League</div>
        {mode === "real" ? (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {realLgs.map((lg) => (
              <button
                key={lg.slug}
                onClick={() => setActiveReal(lg.slug)}
                className={`p-3 rounded-xl border text-center transition ${
                  activeReal === lg.slug
                    ? "border-warning bg-warning/15 text-warning"
                    : "border-border bg-card hover:border-foreground/30"
                }`}
              >
                <div className="text-[11px] font-display leading-tight">{lg.name}</div>
                <div className="mt-0.5 text-[9px] text-muted-foreground">{lg.country}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {CAREER_LEAGUES.map((lid) => (
              <button
                key={lid}
                onClick={() => setActiveLegends(lid)}
                className={`p-3 rounded-xl border text-center transition ${
                  activeLegends === lid
                    ? "border-warning bg-warning/15 text-warning"
                    : "border-border bg-card hover:border-foreground/30"
                }`}
              >
                <div className="text-lg leading-none">{LEAGUES[lid].flag}</div>
                <div className="mt-1 text-[11px] font-display">{LEAGUES[lid].name}</div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          {sortedClubs.length} clubs
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {sortedClubs.map((club) => (
            <button
              key={club.id}
              onClick={() => pick(club.id)}
              className="group p-3 rounded-xl border border-border bg-card hover:border-warning hover:bg-warning/5 transition text-left"
              style={{ borderTopColor: club.color, borderTopWidth: 3 }}
            >
              <div className="font-display text-sm truncate">{club.name}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {club.city ? `${club.city} · ` : ""}Strength {club.strength}
              </div>
            </button>
          ))}
        </div>
      </section>

      <footer className="mt-10 text-center text-[11px] text-muted-foreground">
        You can abandon and restart any time. localStorage saves your progress.
      </footer>
    </div>
  );
}
