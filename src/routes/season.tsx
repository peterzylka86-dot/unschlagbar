import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGame } from "@/lib/store";
import { simulateSeason, squadRating } from "@/lib/sim";
import { ClubBadge } from "@/components/ClubBadge";
import clubsData from "@/data/clubs.json";
import type { Club, MatchResult } from "@/lib/game-types";

const CLUBS = clubsData as Club[];

export const Route = createFileRoute("/season")({
  head: () => ({ meta: [{ title: "Saison · UNSCHLAGBAR 34:0" }] }),
  component: SeasonScreen,
});

function pickOpponents(): Club[] {
  // 17 opponents: prefer current Bundesliga, top by strength
  const ranked = CLUBS
    .slice()
    .sort((a, b) => {
      const era = (e: string) => e === "current" ? 0 : e === "classic" ? 1 : 2;
      const ea = era(a.era), eb = era(b.era);
      if (ea !== eb) return ea - eb;
      return b.strength - a.strength;
    });
  return ranked.slice(0, 17);
}

function SeasonScreen() {
  const { slots, matches, setMatches, config } = useGame();
  const navigate = useNavigate();
  const ourRating = useMemo(() => squadRating(slots), [slots]);
  const [revealCount, setRevealCount] = useState(0);

  useEffect(() => {
    if (slots.every(s => !s.player)) {
      navigate({ to: "/" });
      return;
    }
    const opponents = pickOpponents();
    const sim = simulateSeason(opponents, ourRating, Math.floor(Math.random() * 1e9), config.difficulty);
    setMatches(sim);
    setRevealCount(0);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!matches.length) return;
    if (revealCount >= matches.length) return;
    const t = setTimeout(() => setRevealCount(c => c + 1), 220);
    return () => clearTimeout(t);
  }, [matches, revealCount]);

  const shown = matches.slice(0, revealCount);
  const firstNonWinIdx = matches.findIndex(m => m.outcome !== "W");
  const streakBroken = firstNonWinIdx !== -1 && revealCount > firstNonWinIdx;
  const wins = shown.filter(m => m.outcome === "W").length;
  const draws = shown.filter(m => m.outcome === "D").length;
  const losses = shown.filter(m => m.outcome === "L").length;
  const goalsFor = shown.reduce((a, m) => a + m.ourScore, 0);
  const goalsAgainst = shown.reduce((a, m) => a + m.theirScore, 0);
  const seasonOver = revealCount >= matches.length;
  const isUnbeaten = seasonOver && losses === 0 && draws === 0;

  return (
    <div className="min-h-screen pb-16">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 backdrop-blur-md bg-background/75 border-b border-border/60">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link to="/" className="brand-mark text-3xl inline-flex items-baseline gap-0.5 leading-none shrink-0">
            <span>34</span><span className="text-primary">:</span><span>0</span>
          </Link>
          <div className="flex items-center gap-1.5 text-xs flex-wrap justify-end">
            <Stat label="OVR" value={String(ourRating)} />
            <Stat label="W" value={String(wins)} color="success" />
            <Stat label="D" value={String(draws)} color="warning" />
            <Stat label="L" value={String(losses)} color="destructive" />
            <Stat label="GF" value={String(goalsFor)} />
            <Stat label="GA" value={String(goalsAgainst)} />
            <Stat label="MD" value={`${revealCount}/${matches.length}`} />
          </div>
        </div>
      </div>

      <div className="px-4 max-w-5xl mx-auto">
        {/* Live current matchday card */}
        <AnimatePresence mode="wait">
          {!seasonOver && revealCount > 0 && shown[shown.length - 1] && (
            <LiveCard key={revealCount} match={shown[shown.length - 1]!} />
          )}
        </AnimatePresence>

        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {matches.map((m, i) => {
            const isStreakBreaker = i === firstNonWinIdx;
            const afterStreak = firstNonWinIdx !== -1 && i > firstNonWinIdx;
            return (
              <MatchCard
                key={i}
                match={m}
                revealed={i < revealCount}
                isStreakBreaker={isStreakBreaker && i < revealCount}
                dimmed={afterStreak && i < revealCount}
              />
            );
          })}
        </div>

        <AnimatePresence>
          {streakBroken && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-6 px-4 py-3 rounded-xl border border-destructive/50 bg-destructive/10 text-center"
            >
              <div className="text-xs uppercase tracking-widest text-destructive font-display">
                Unbeaten run ended · Matchday {matches[firstNonWinIdx]!.matchday}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {seasonOver && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 text-center"
          >
            <button
              onClick={() => navigate({ to: "/result", search: { unbeaten: isUnbeaten } })}
              className="px-7 py-3 rounded-xl bg-primary text-primary-foreground font-display tracking-wide hover:brightness-110 shadow-[0_10px_30px_-10px] shadow-primary/60"
            >
              See result →
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function LiveCard({ match }: { match: MatchResult }) {
  const tone = match.outcome === "W" ? "from-success/30 via-success/10 border-success/50"
    : match.outcome === "D" ? "from-warning/30 via-warning/10 border-warning/50"
    : "from-destructive/40 via-destructive/15 border-destructive/60";
  const badge = match.outcome === "W" ? "bg-success text-success-foreground"
    : match.outcome === "D" ? "bg-warning text-warning-foreground"
    : "bg-destructive text-destructive-foreground";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: -8 }}
      transition={{ type: "spring", stiffness: 280, damping: 22 }}
      className={`mt-4 relative overflow-hidden rounded-xl border-2 bg-gradient-to-br ${tone} px-4 py-3`}
    >
      {/* halftone stripes */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
           style={{ background: "repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 8px)" }} />
      <div className="relative flex items-center gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          MD {String(match.matchday).padStart(2, "0")} · {match.home ? "Heim" : "Auswärts"}
        </div>
        <motion.span
          initial={{ scale: 0.6 }}
          animate={{ scale: [0.6, 1.15, 1] }}
          transition={{ duration: 0.4 }}
          className={`ml-auto px-2 py-0.5 rounded text-[10px] font-display tracking-widest ${badge}`}
        >
          {match.outcome === "W" ? "SIEG" : match.outcome === "D" ? "REMIS" : "PLEITE"}
        </motion.span>
      </div>
      <div className="relative mt-2 flex items-center gap-3">
        <div className="flex-1 text-right">
          <div className="text-xs text-muted-foreground">UNSCHLAGBAR</div>
          <div className="font-display text-lg leading-none">Your XI</div>
        </div>
        <div className="scoreboard rounded-md px-4 py-2 text-3xl tabular-nums font-display tracking-wider shadow-[0_0_24px_-4px_rgba(0,0,0,0.6)]">
          {match.ourScore} <span className="opacity-50">:</span> {match.theirScore}
        </div>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <ClubBadge club={match.opponent} size={36} />
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground truncate">{match.opponent.short}</div>
            <div className="font-display text-lg leading-none truncate">{match.opponent.name}</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: "success"|"warning"|"destructive" }) {
  const c = color === "success" ? "text-success border-success/30 bg-success/10"
    : color === "warning" ? "text-warning border-warning/30 bg-warning/10"
    : color === "destructive" ? "text-destructive border-destructive/30 bg-destructive/10"
    : "text-foreground border-border bg-card";
  return (
    <div className={`px-2 py-1 rounded border ${c} tabular-nums`}>
      <span className="text-[10px] uppercase tracking-wider opacity-70 mr-1">{label}</span>
      <span className="font-display">{value}</span>
    </div>
  );
}

function MatchCard({ match, revealed, isStreakBreaker, dimmed }: {
  match: MatchResult;
  revealed: boolean;
  isStreakBreaker: boolean;
  dimmed: boolean;
}) {
  const accent = match.outcome === "W" ? "border-success/40 bg-success/5"
    : match.outcome === "D" ? "border-warning/40 bg-warning/5"
    : "border-destructive/40 bg-destructive/5";
  const bar = match.outcome === "W" ? "bg-success"
    : match.outcome === "D" ? "bg-warning"
    : "bg-destructive";
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={revealed ? { opacity: dimmed ? 0.45 : 1, x: 0 } : { opacity: 0.15, x: -6 }}
      transition={{ duration: 0.25 }}
      className={`relative overflow-hidden flex items-center gap-3 p-3 rounded-lg border ${revealed ? accent : "border-border bg-card/30"} ${isStreakBreaker ? "ring-2 ring-destructive shadow-[0_0_24px_-4px] shadow-destructive/60" : ""}`}
    >
      {revealed && <span className={`absolute left-0 top-0 bottom-0 w-1 ${bar}`} />}
      <div className="w-7 text-[11px] text-muted-foreground font-mono pl-1">{String(match.matchday).padStart(2, "0")}</div>
      <ClubBadge club={match.opponent} size={32} />
      <div className="flex-1 min-w-0">
        <div className="text-xs truncate">
          <span className="text-muted-foreground">{match.home ? "vs" : "@"}</span> {match.opponent.short}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">{match.opponent.name}</div>
      </div>
      <div className="font-display text-lg tabular-nums">
        {revealed ? `${match.ourScore}-${match.theirScore}` : "— —"}
      </div>
      <div className={`w-5 text-center font-display text-sm ${
        match.outcome === "W" ? "text-success" : match.outcome === "D" ? "text-warning" : "text-destructive"
      }`}>
        {revealed ? match.outcome : ""}
      </div>
    </motion.div>
  );
}
