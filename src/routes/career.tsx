/**
 * /career — GOLAZO hub
 *
 * Entry point for the multi-season Career mode. Three states:
 *   1. No active career → "Start new" full-width CTA + explainer
 *   2. Active career → "Continue" + "Abandon" affordances
 *   3. Hall of Fame placeholder for cross-mode achievements (built later)
 *
 * Career mode logic lives in src/lib/career-core.ts (already ported from
 * GOLAZO with 86 tests). This hub is the UI shell; the founding-club
 * picker is in /career/found.
 */
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useCareer } from "@/lib/career-store";
import { LEAGUES, type LeagueId } from "@/lib/leagues";
import { realLeagueName } from "@/lib/real-data";
import { getCareerClubs } from "@/lib/data";
import { dynastyStatus } from "@/lib/dynasty";
import { OnzeCard } from "@/components/OnzePromo";

export const Route = createFileRoute("/career")({
  head: () => ({ meta: [{ title: "GOLAZO · Career Mode" }] }),
  component: CareerHub,
});

function CareerHub() {
  // ALL hooks first, then conditional rendering. React's rules-of-hooks
  // requires the same hook count + order every render — never early-return
  // before subsequent hook calls.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const career = useCareer();

  // /career/{found,draft,season} are file-based children of this route.
  // When user navigates to one of them, render JUST the child (no hub
  // shell around it). When the path is exactly /career, render the hub.
  const onChildRoute = pathname !== "/career" && pathname !== "/career/";
  if (onChildRoute) return <Outlet />;

  const hasActive = career.foundingClubId !== null;
  const club = hasActive
    ? getCareerClubs(career.foundingClubId, career.careerMode).find((c) => c.id === career.foundingClubId)
    : null;

  return (
    <div className="min-h-screen px-4 py-10 max-w-2xl mx-auto">
      <header className="text-center">
        <Link to="/" search={{ challenge: undefined as never }} className="inline-block">
          <h1 className="brand-mark text-5xl inline-flex items-baseline gap-1 leading-none">
            <span>GOLAZO</span>
          </h1>
          <div className="text-[10px] tracking-[0.3em] text-warning/80 mt-1">
            CAREER MODE · MULTI-SEASON LEGACY
          </div>
        </Link>
        <p className="mt-4 text-muted-foreground max-w-md mx-auto text-sm">
          Pick a founding club. Build a squad season after season. Win the league. Win the cup.
          Transfer. Rebuild. Score a GOLAZO.
        </p>
      </header>

      <div className="mt-10 space-y-4">
        {career.seasonHistory.length > 0 && (
          <Link
            to="/career/history"
            className="block p-4 rounded-xl border border-warning/40 bg-warning/5 hover:bg-warning/10 transition text-center"
          >
            <span className="text-warning font-display text-sm">🏆 Hall of Fame</span>
            <span className="text-muted-foreground text-xs ml-2">
              · {career.seasonHistory.length} season{career.seasonHistory.length === 1 ? "" : "s"} ·{" "}
              {career.trophies} {career.trophies === 1 ? "trophy" : "trophies"}
            </span>
          </Link>
        )}

        {hasActive && club ? (
          <ActiveCareerCard
            clubName={club.name}
            leagueName={
              career.careerMode === "real"
                ? (realLeagueName(career.leagueId) ?? "Real")
                : LEAGUES[(career.leagueId ?? "ucl") as LeagueId].name
            }
            currentSeason={career.currentSeason}
            trophies={career.trophies}
            hasSquad={career.squad.length > 0}
            onAbandon={() => {
              if (confirm("Abandon current career? This wipes your save.")) {
                career.abandonCareer();
              }
            }}
          />
        ) : (
          <StartCareerCard />
        )}

        {/* Dynasty Objectives — career-spanning goals. Shown for any
            career with at least one season played; gives the multi-season
            grind something to build toward ("win 3 in a row"). Pure
            derived data from seasonHistory — no store changes. */}
        {career.seasonHistory.length > 0 && (
          <DynastyCard history={career.seasonHistory} />
        )}

        <HowItWorksCard />

        <OnzeCard />
      </div>

      <footer className="mt-12 text-center text-[11px] text-muted-foreground">
        <Link
          to="/"
          search={{ challenge: undefined as never }}
          className="underline hover:text-warning"
        >
          ← back to home
        </Link>
      </footer>
    </div>
  );
}

function StartCareerCard() {
  return (
    <div className="p-6 rounded-2xl border border-warning bg-warning/10 text-center">
      <div className="text-3xl mb-1">🌟</div>
      <div className="font-display text-2xl text-warning mb-2">Start a Career</div>
      <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
        Pick one founding club from any league. Your career starts there — and every season builds
        on the last.
      </p>
      <Link
        to="/career/found"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning text-warning-foreground font-display text-lg tracking-[0.15em] uppercase hover:brightness-110 transition"
      >
        Pick Your Club →
      </Link>
    </div>
  );
}

function ActiveCareerCard({
  clubName,
  leagueName,
  currentSeason,
  trophies,
  hasSquad,
  onAbandon,
}: {
  clubName: string;
  leagueName: string;
  currentSeason: number;
  trophies: number;
  hasSquad: boolean;
  onAbandon: () => void;
}) {
  return (
    <div className="p-6 rounded-2xl border border-warning bg-warning/10">
      <div className="text-xs uppercase tracking-[0.18em] text-warning/80 mb-1">Active career</div>
      <div className="font-display text-2xl text-warning">{clubName}</div>
      <div className="text-sm text-muted-foreground mt-0.5">{leagueName}</div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-center">
        <div className="rounded-lg border border-warning/30 py-3">
          <div className="font-display text-2xl text-warning">{currentSeason}</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1">
            Season
          </div>
        </div>
        <div className="rounded-lg border border-warning/30 py-3">
          <div className="font-display text-2xl text-warning">{trophies}</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1">
            Trophies
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col sm:flex-row gap-2">
        {/* Previously this was a permanently-disabled "Coming soon" button
            — leftover scaffolding from before the season flow existed.
            Career users returning to the hub couldn't continue at all.
            Route: squad drafted → play the season; no squad yet → draft. */}
        <Link
          to={hasSquad ? "/career/season" : "/career/draft"}
          className="flex-1 px-4 py-3 rounded-md bg-warning text-warning-foreground font-display text-base tracking-wide text-center hover:brightness-110 transition"
        >
          Continue Season {currentSeason} →
        </Link>
        <button
          onClick={onAbandon}
          className="px-4 py-3 rounded-md border border-muted-foreground/40 text-muted-foreground text-sm hover:bg-muted/30 transition"
        >
          Abandon
        </button>
      </div>
    </div>
  );
}

function DynastyCard({ history }: { history: import("@/lib/career-store").SeasonRecord[] }) {
  const statuses = dynastyStatus(history);
  const unlockedCount = statuses.filter((s) => s.unlocked).length;
  return (
    <div className="p-5 rounded-2xl border border-border bg-card/40">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Dynasty Objectives
        </div>
        <div className="text-[11px] font-display text-warning">
          {unlockedCount} / {statuses.length}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {statuses.map(({ objective, progress, unlocked }) => (
          <div
            key={objective.id}
            className={`p-3 rounded-lg border transition ${
              unlocked
                ? "border-warning/60 bg-warning/10"
                : "border-border/60 bg-background/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`text-base ${unlocked ? "" : "grayscale opacity-50"}`}>
                {objective.icon}
              </span>
              <span
                className={`font-display text-xs tracking-wide ${
                  unlocked ? "text-warning" : "text-foreground/70"
                }`}
              >
                {objective.title}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
              {objective.description}
            </div>
            {/* Progress bar — only for in-progress (not 0, not unlocked) */}
            {!unlocked && progress > 0 && (
              <div className="mt-2 h-1 rounded-full bg-border/60 overflow-hidden">
                <div
                  className="h-full bg-warning/70 transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HowItWorksCard() {
  return (
    <div className="p-5 rounded-2xl border border-border bg-card/40">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-3">
        How GOLAZO works
      </div>
      <ol className="space-y-2 text-sm text-foreground/85">
        <li className="flex gap-3">
          <span className="font-display text-warning shrink-0">1.</span>
          <span>
            <span className="text-warning">Pick a founding club</span> — Real Madrid, Bayern,
            Liverpool, whichever fits your taste.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-display text-warning shrink-0">2.</span>
          <span>
            <span className="text-warning">Draft against AI rivals</span> — each rival has an
            archetype (Galáctico, Pragmatist, Romantic, …) and competes for the legends you want.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-display text-warning shrink-0">3.</span>
          <span>
            <span className="text-warning">Play a full season</span> — 22 matchdays + a knockout
            cup. Top 8 qualify; bottom 2 relegate.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-display text-warning shrink-0">4.</span>
          <span>
            <span className="text-warning">Transfer window</span> — hot-form players demand moves,
            cold players can be sold, you fill gaps for next season.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-display text-warning shrink-0">5.</span>
          <span>
            <span className="text-warning">Repeat. Build a legacy.</span> Win the league. Win the
            cup. Score a GOLAZO.
          </span>
        </li>
      </ol>
    </div>
  );
}
