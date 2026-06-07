/**
 * /career/history — Hall of Fame.
 *
 * Surfaces every completed season the user has played, plus aggregate
 * stats across the whole career. Driven entirely by career.seasonHistory
 * — the append-only log /career/season writes to at the end of each season.
 *
 * Read-only: no actions, just the trophy cabinet + season-by-season recap.
 * Reached via the GOLAZO hub's "Hall of Fame" link (added in this commit).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useCareer } from "@/lib/career-store";
import type { SeasonRecord } from "@/lib/career-store";

export const Route = createFileRoute("/career/history")({
  head: () => ({ meta: [{ title: "Hall of Fame · GOLAZO" }] }),
  component: CareerHistory,
});

function CareerHistory() {
  const career = useCareer();
  const seasons = career.seasonHistory;

  // Aggregate stats (computed before render guard so hooks run unconditionally)
  const aggregate = useMemo(() => {
    const totalWins = seasons.reduce((a, s) => a + s.wins, 0);
    const totalDraws = seasons.reduce((a, s) => a + s.draws, 0);
    const totalLosses = seasons.reduce((a, s) => a + s.losses, 0);
    const totalGF = seasons.reduce((a, s) => a + s.goalsFor, 0);
    const totalGA = seasons.reduce((a, s) => a + s.goalsAgainst, 0);
    const leagueTitles = seasons.filter(s => s.finalPosition === 1).length;
    const cupWins = seasons.filter(s => s.cupResult === "champion").length;
    const relegations = seasons.filter(s => s.relegated).length;
    const bestPosition = seasons.length > 0
      ? Math.min(...seasons.map(s => s.finalPosition))
      : null;
    return {
      totalWins, totalDraws, totalLosses, totalGF, totalGA,
      leagueTitles, cupWins, relegations, bestPosition,
    };
  }, [seasons]);

  return (
    <div className="min-h-screen px-4 py-8 max-w-3xl mx-auto">
      <header className="text-center">
        <Link to="/career" className="text-[11px] text-muted-foreground hover:text-warning underline">
          ← GOLAZO hub
        </Link>
        <h1 className="mt-3 font-display text-3xl text-warning">🏆 Hall of Fame</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every season you've played. Every trophy you've won.
        </p>
      </header>

      {seasons.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-border bg-card/40 p-8 text-center">
          <div className="text-5xl mb-3">🥇</div>
          <div className="font-display text-xl mb-2">No seasons yet</div>
          <p className="text-sm text-muted-foreground mb-5">
            Finish a season — league or cup — and it shows up here.
          </p>
          <Link
            to="/career"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning text-warning-foreground font-display text-base tracking-wide hover:brightness-110 transition"
          >
            Back to hub →
          </Link>
        </div>
      ) : (
        <>
          {/* Career totals */}
          <section className="mt-8">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Career totals</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Seasons" value={seasons.length} />
              <Stat label="🏆 League" value={aggregate.leagueTitles} accent="text-warning" />
              <Stat label="🏆 Cup" value={aggregate.cupWins} accent="text-warning" />
              <Stat label="📉 Relegated" value={aggregate.relegations} accent="text-primary" />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <Stat label="W" value={aggregate.totalWins} accent="text-success" />
              <Stat label="D" value={aggregate.totalDraws} />
              <Stat label="L" value={aggregate.totalLosses} accent="text-primary" />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <Stat label="Best finish" value={aggregate.bestPosition !== null ? `${aggregate.bestPosition}${ordinal(aggregate.bestPosition)}` : "—"} accent="text-warning" />
              <Stat label="Goals for" value={aggregate.totalGF} />
              <Stat label="Goals against" value={aggregate.totalGA} />
            </div>
          </section>

          {/* Season-by-season */}
          <section className="mt-8">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Season by season</div>
            <ul className="space-y-2">
              {[...seasons].reverse().map(s => (
                <SeasonRow key={s.season} record={s} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 py-3 px-2 text-center">
      <div className={`font-display text-2xl ${accent ?? "text-foreground"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function SeasonRow({ record }: { record: SeasonRecord }) {
  const isChampion = record.finalPosition === 1;
  const isCupWinner = record.cupResult === "champion";
  return (
    <li className={`rounded-xl border p-4 ${
      isChampion ? "border-warning bg-warning/15" :
      record.relegated ? "border-primary/40 bg-primary/5" :
      "border-border bg-card/40"
    }`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-display text-lg">
          Season {record.season}
          {isChampion && <span className="ml-2 text-warning">🏆 Champion</span>}
          {isCupWinner && <span className="ml-2 text-warning">🏆 Cup</span>}
          {record.relegated && <span className="ml-2 text-primary">📉 Relegated</span>}
        </div>
        <div className="text-xs text-muted-foreground">{record.formation}</div>
      </div>

      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Mini label="Position" value={`${record.finalPosition}${ordinal(record.finalPosition)} / ${record.totalLeagueClubs}`} />
        <Mini label="W·D·L" value={`${record.wins}·${record.draws}·${record.losses}`} />
        <Mini label="Goals" value={`${record.goalsFor}:${record.goalsAgainst}`} />
        <Mini label="Cup" value={cupLabel(record.cupResult)} />
      </div>

      {record.trophies.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {record.trophies.map((t, i) => (
            <span key={i} className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider bg-warning/20 text-warning border border-warning/40">
              🏆 {t}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-sm">{value}</div>
    </div>
  );
}

function cupLabel(r: SeasonRecord["cupResult"]): string {
  switch (r) {
    case "champion": return "🏆 Winner";
    case "runner-up": return "🥈 Final";
    case "semi-final": return "🥉 SF";
    case "quarter-final": return "QF";
    default: return "—";
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
