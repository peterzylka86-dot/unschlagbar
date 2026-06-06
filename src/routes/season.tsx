import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/store";
import { simulateSeason, squadRating } from "@/lib/sim";
import { ClubBadge } from "@/components/ClubBadge";
import clubsData from "@/data/clubs.json";
import type { Club, MatchResult } from "@/lib/game-types";

const CLUBS = clubsData as Club[];

export const Route = createFileRoute("/season")({
  head: () => ({ meta: [{ title: "Season — 34-0" }] }),
  component: SeasonScreen,
});

function pickOpponents(slots: ReturnType<typeof useGame.getState>["slots"]): Club[] {
  // Pick 17 opponents: prefer current Bundesliga + a handful of historic giants
  const filledClubIds = new Set(slots.map(s => s.player?.club).filter(Boolean) as string[]);
  const ranked = CLUBS
    .slice()
    .sort((a, b) => {
      // current first, then by strength desc
      const era = (e: string) => e === "current" ? 0 : e === "classic" ? 1 : 2;
      const ea = era(a.era), eb = era(b.era);
      if (ea !== eb) return ea - eb;
      return b.strength - a.strength;
    });
  const opps: Club[] = [];
  for (const c of ranked) {
    if (filledClubIds.has(c.id) && opps.length < 5) {
      // your own clubs can appear as opponents too, fine
    }
    opps.push(c);
    if (opps.length >= 17) break;
  }
  return opps;
}

function SeasonScreen() {
  const { slots, matches, setMatches } = useGame();
  const navigate = useNavigate();
  const ourRating = useMemo(() => squadRating(slots), [slots]);
  const [revealCount, setRevealCount] = useState(0);

  useEffect(() => {
    if (slots.every(s => !s.player)) {
      navigate({ to: "/" });
      return;
    }
    const opponents = pickOpponents(slots);
    const sim = simulateSeason(opponents, ourRating, Math.floor(Math.random() * 1e9));
    setMatches(sim);
    setRevealCount(0);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!matches.length) return;
    if (revealCount >= matches.length) return;
    const losingMatchIdx = matches.findIndex(m => m.outcome !== "W");
    const stopAt = losingMatchIdx === -1 ? matches.length : losingMatchIdx + 1;
    if (revealCount >= stopAt) return;
    const t = setTimeout(() => setRevealCount(c => c + 1), 380);
    return () => clearTimeout(t);
  }, [matches, revealCount]);

  const shown = matches.slice(0, revealCount);
  const wins = shown.filter(m => m.outcome === "W").length;
  const draws = shown.filter(m => m.outcome === "D").length;
  const losses = shown.filter(m => m.outcome === "L").length;
  const goalsFor = shown.reduce((a, m) => a + m.ourScore, 0);
  const goalsAgainst = shown.reduce((a, m) => a + m.theirScore, 0);
  const lostRun = shown.some(m => m.outcome !== "W");
  const seasonOver = lostRun || revealCount >= matches.length;
  const isUnbeaten = revealCount >= matches.length && losses === 0 && draws === 0;

  return (
    <div className="min-h-screen px-4 py-8 max-w-5xl mx-auto">
      <header className="flex items-center justify-between">
        <Link to="/" className="font-display text-2xl">
          34<span className="inline-block align-middle mx-0.5 w-4 h-1.5 bg-primary rounded-sm" />0
        </Link>
        <div className="flex items-center gap-2 text-xs">
          <Stat label="Rating" value={String(ourRating)} />
          <Stat label="W" value={String(wins)} color="success" />
          <Stat label="D" value={String(draws)} color="warning" />
          <Stat label="L" value={String(losses)} color="destructive" />
          <Stat label="GF" value={String(goalsFor)} />
          <Stat label="GA" value={String(goalsAgainst)} />
        </div>
      </header>

      <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {matches.map((m, i) => (
          <MatchCard key={i} match={m} revealed={i < revealCount} />
        ))}
      </div>

      {seasonOver && (
        <div className="mt-8 text-center">
          <button
            onClick={() => navigate({ to: "/result", search: { unbeaten: isUnbeaten } })}
            className="px-6 py-3 rounded-xl bg-success text-success-foreground font-display tracking-wide hover:brightness-110"
          >
            See result →
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: "success"|"warning"|"destructive" }) {
  const c = color === "success" ? "text-success border-success/30 bg-success/10"
    : color === "warning" ? "text-warning border-warning/30 bg-warning/10"
    : color === "destructive" ? "text-destructive border-destructive/30 bg-destructive/10"
    : "text-foreground border-border bg-card";
  return (
    <div className={`px-2 py-1 rounded border ${c}`}>
      <span className="text-[10px] uppercase tracking-wider opacity-70 mr-1">{label}</span>
      <span className="font-display">{value}</span>
    </div>
  );
}

function MatchCard({ match, revealed }: { match: MatchResult; revealed: boolean }) {
  const accent = match.outcome === "W" ? "border-success/40 bg-success/5"
    : match.outcome === "D" ? "border-warning/40 bg-warning/5"
    : "border-destructive/40 bg-destructive/5";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0.3, y: 8 }}
      transition={{ duration: 0.25 }}
      className={`flex items-center gap-3 p-3 rounded-lg border ${revealed ? accent : "border-border bg-card/40"}`}
    >
      <div className="w-7 text-[11px] text-muted-foreground font-mono">{String(match.matchday).padStart(2, "0")}</div>
      <ClubBadge club={match.opponent} size={32} />
      <div className="flex-1 min-w-0">
        <div className="text-xs truncate">
          <span className="text-muted-foreground">{match.home ? "vs" : "@"}</span> {match.opponent.short}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">{match.opponent.name}</div>
      </div>
      <div className="font-display text-lg tabular-nums">
        {revealed ? `${match.ourScore} - ${match.theirScore}` : "— —"}
      </div>
      <div className={`w-5 text-center font-display text-sm ${
        match.outcome === "W" ? "text-success" : match.outcome === "D" ? "text-warning" : "text-destructive"
      }`}>
        {revealed ? match.outcome : ""}
      </div>
    </motion.div>
  );
}
