import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/store";
import { ClubBadge } from "@/components/ClubBadge";
import clubsData from "@/data/clubs.json";
import type { Club } from "@/lib/game-types";
import { squadRating, computeLeagueTable } from "@/lib/sim";

const CLUBS = clubsData as Club[];

export const Route = createFileRoute("/result")({
  validateSearch: (s: Record<string, unknown>) => ({ unbeaten: s.unbeaten === true || s.unbeaten === "true" }),
  head: () => ({ meta: [{ title: "Ergebnis · UNSCHLAGBAR 34:0" }] }),
  component: ResultScreen,
});

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function ResultScreen() {
  const { unbeaten } = Route.useSearch();
  const { slots, matches, reset } = useGame();
  const navigate = useNavigate();
  const rating = squadRating(slots);
  const wins = matches.filter(m => m.outcome === "W").length;
  const draws = matches.filter(m => m.outcome === "D").length;
  const losses = matches.filter(m => m.outcome === "L").length;
  const points = wins * 3 + draws;
  const firstLoss = matches.find(m => m.outcome !== "W");

  const { table, ourPosition } = useMemo(() => {
    if (!matches.length) return { table: [], ourPosition: 0 };
    // unique opponents in order of first appearance
    const seen = new Set<string>();
    const opps: Club[] = [];
    for (const m of matches) {
      if (!seen.has(m.opponent.id)) {
        seen.add(m.opponent.id);
        opps.push(m.opponent);
      }
    }
    return computeLeagueTable(matches, opps, rating);
  }, [matches, rating]);

  const positionTone =
    ourPosition === 1 ? "text-warning"
    : ourPosition <= 4 ? "text-success"
    : ourPosition <= 10 ? "text-foreground"
    : "text-destructive";

  return (
    <div className="min-h-screen px-4 py-12 max-w-3xl mx-auto text-center">
      {unbeaten ? (
        <>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-success/40 bg-success/10 text-success text-xs font-semibold tracking-widest uppercase">
            ★ Invincible ★
          </div>
          <h1 className="mt-6 brand-mark text-8xl text-success">34<span className="text-warning">:</span>0</h1>
          <p className="mt-4 text-xl">Your XI went unbeaten.</p>
        </>
      ) : (
        <>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-destructive/40 bg-destructive/10 text-destructive text-xs font-semibold tracking-widest uppercase">
            Run ended
          </div>
          <h1 className="mt-6 font-display text-6xl">{wins}-{draws}-{losses}</h1>
          {firstLoss && (
            <p className="mt-4 text-muted-foreground">
              Dropped points on matchday {firstLoss.matchday} {firstLoss.home ? "vs" : "@"} {firstLoss.opponent.name} ({firstLoss.ourScore}-{firstLoss.theirScore}).
            </p>
          )}
        </>
      )}

      {/* Final position scoreboard */}
      {ourPosition > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-8 inline-flex items-stretch gap-0 rounded-xl overflow-hidden border-2 border-warning/40 shadow-[0_0_40px_-12px] shadow-warning/40"
        >
          <div className="px-5 py-3 bg-card/70 text-left">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Final position</div>
            <div className={`font-display text-4xl leading-none mt-1 ${positionTone}`}>
              {ordinal(ourPosition)}
              <span className="text-sm text-muted-foreground ml-1">/ {table.length}</span>
            </div>
          </div>
          <div className="px-5 py-3 scoreboard text-left tabular-nums flex flex-col justify-center">
            <div className="text-[10px] opacity-70">PTS</div>
            <div className="text-2xl">{points}</div>
          </div>
        </motion.div>
      )}

      {/* League table */}
      {table.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mt-8 text-left rounded-xl border bg-card/40 overflow-hidden"
        >
          <div className="px-3 py-2 border-b text-[10px] uppercase tracking-[0.2em] text-muted-foreground bg-background/50">
            Abschlusstabelle
          </div>
          <div className="divide-y divide-border/50">
            {table.map((row, i) => {
              const pos = i + 1;
              const zone =
                pos === 1 ? "border-l-warning"
                : pos <= 4 ? "border-l-success"
                : pos <= 6 ? "border-l-success/50"
                : pos >= table.length - 2 ? "border-l-destructive"
                : "border-l-transparent";
              return (
                <div
                  key={row.short + i}
                  className={`grid grid-cols-[28px_1fr_28px_28px_28px_44px_36px] sm:grid-cols-[28px_1fr_28px_28px_28px_60px_44px] items-center gap-2 px-3 py-1.5 text-xs tabular-nums border-l-4 ${zone} ${
                    row.isUs ? "bg-warning/10 font-semibold" : ""
                  }`}
                >
                  <div className="text-muted-foreground font-mono">{pos}</div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: row.color }} />
                    <span className="truncate">{row.name}</span>
                  </div>
                  <div className="text-success/80">{row.w}</div>
                  <div className="text-warning/80">{row.d}</div>
                  <div className="text-destructive/80">{row.l}</div>
                  <div className="text-muted-foreground hidden sm:block">{row.gf}:{row.ga}</div>
                  <div className="font-display text-sm text-right">{row.pts}</div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <div className="mt-10">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Your XI · {rating} overall</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {slots.map(s => {
            const club = s.player ? CLUBS.find(c => c.id === s.player!.club) : null;
            return (
              <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg border bg-card text-left">
                {club && <ClubBadge club={club} size={32} />}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">{s.position}</div>
                  <div className="text-sm truncate">{s.player?.name ?? "—"}</div>
                </div>
                {s.player && (
                  <div className="font-display text-base text-warning">{s.player.prime_rating}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-10 flex justify-center gap-3 flex-wrap">
        <button
          onClick={() => { reset(); navigate({ to: "/game", search: { new: true } }); }}
          className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-display tracking-wide hover:brightness-110"
        >
          New Run
        </button>
        <Link to="/" className="px-6 py-3 rounded-xl border hover:bg-card font-display tracking-wide">
          Home
        </Link>
      </div>
    </div>
  );
}
