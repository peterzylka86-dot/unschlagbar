import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGame } from "@/lib/store";
import { simulateSeason, simulateKnockout, squadRating } from "@/lib/sim";
import { ClubBadge } from "@/components/ClubBadge";
import { getClubs } from "@/lib/data";
import { LEAGUES } from "@/lib/leagues";
import type { Club, MatchResult } from "@/lib/game-types";

export const Route = createFileRoute("/season")({
  head: () => ({ meta: [{ title: "Season · UNSCHLAGBAR" }] }),
  component: SeasonScreen,
});

function pickOpponents(clubs: Club[], count: number): Club[] {
  const ranked = clubs
    .slice()
    .sort((a, b) => {
      const era = (e: string) => e === "current" ? 0 : e === "classic" ? 1 : 2;
      const ea = era(a.era), eb = era(b.era);
      if (ea !== eb) return ea - eb;
      return b.strength - a.strength;
    });
  return ranked.slice(0, count);
}

/**
 * For knockouts: builds the per-match opponent sequence so that:
 * - Group entries are paired (home/away vs same opponent twice in a row when
 *   the group has 6 matches; 3 distinct opponents for 3-match groups).
 * - Consecutive non-Group entries with the same round name represent legs of
 *   one tie and reuse the same opponent (2-leg ties).
 */
function buildKnockoutOpponents(clubs: Club[], rounds: string[], seedNum: number): Club[] {
  const pool = clubs.slice().sort((a, b) => b.strength - a.strength);
  const rng = (s: { v: number }) => {
    let x = s.v | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    s.v = x;
    return ((x >>> 0) % 10000) / 10000;
  };
  const rs = { v: seedNum || 4242 };
  const used = new Set<string>();
  const pickFrom = (candidates: Club[]): Club => {
    const fresh = candidates.filter(c => !used.has(c.id));
    const fallback = pool.filter(c => !used.has(c.id));
    const list = fresh.length ? fresh : (fallback.length ? fallback : pool);
    const pick = list[Math.floor(rng(rs) * list.length)]!;
    used.add(pick.id);
    return pick;
  };

  // Step 1: group consecutive identical round names into "ties" (or group-pairs).
  // For "Group", we treat the entire span of Group entries as ONE block,
  // with N distinct opponents where N = matches / 2 if even (home & away) else N = matches.
  // For KO rounds, consecutive same-name entries are legs of one tie (same opponent).
  type Tie = { round: string; legs: number; isGroup: boolean };
  const groupBlocks: { startIdx: number; matches: number }[] = [];
  let groupStartIdx = -1;
  let groupCount = 0;
  const ties: Tie[] = [];
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i]!;
    const isGroup = r === "Group";
    if (isGroup) {
      if (groupStartIdx === -1) groupStartIdx = i;
      groupCount++;
      if (i === rounds.length - 1 || rounds[i + 1] !== "Group") {
        groupBlocks.push({ startIdx: groupStartIdx, matches: groupCount });
        ties.push({ round: "Group", legs: groupCount, isGroup: true });
        groupStartIdx = -1;
        groupCount = 0;
      }
    } else if (i > 0 && rounds[i - 1] === r) {
      ties[ties.length - 1]!.legs += 1;
    } else {
      ties.push({ round: r, legs: 1, isGroup: false });
    }
  }
  void groupBlocks;

  // Step 2: progressively harder buckets for KO ties; weaker bucket for group opponents.
  const koTies = ties.filter(t => !t.isGroup);
  const nKO = koTies.length;
  const bucketSize = Math.max(1, Math.floor(pool.length / Math.max(nKO + 1, 1)));
  // group draws from the weakest bucket
  const groupBucket = pool.slice(nKO * bucketSize);

  const opponents: Club[] = [];
  let koIdx = 0;
  for (const tie of ties) {
    if (tie.isGroup) {
      // 3 distinct group opponents if 6 group matches (home & away), else 1 per match.
      const distinct = tie.legs % 2 === 0 ? tie.legs / 2 : tie.legs;
      const groupOpps: Club[] = [];
      for (let k = 0; k < distinct; k++) groupOpps.push(pickFrom(groupBucket.length ? groupBucket : pool));
      if (distinct * 2 === tie.legs) {
        // Pair home/away
        for (const o of groupOpps) {
          opponents.push(o, o);
        }
      } else {
        for (const o of groupOpps) opponents.push(o);
      }
    } else {
      // Pick one opponent from the bucket for this round; later rounds = stronger pool
      const bucketStart = (nKO - 1 - koIdx) * bucketSize;
      const bucket = pool.slice(bucketStart, koIdx === nKO - 1 ? pool.length : bucketStart + bucketSize);
      const opp = pickFrom(bucket.length ? bucket : pool);
      for (let leg = 0; leg < tie.legs; leg++) opponents.push(opp);
      koIdx++;
    }
  }
  return opponents;
}

function SeasonScreen() {
  const { slots, matches, setMatches, config } = useGame();
  const navigate = useNavigate();
  const league = LEAGUES[config.league];
  const isKO = league.kind !== "league";
  const CLUBS = useMemo(() => getClubs(config.league), [config.league]);
  const ourRating = useMemo(() => squadRating(slots), [slots]);
  const [revealCount, setRevealCount] = useState(0);

  useEffect(() => {
    if (slots.every(s => !s.player)) {
      navigate({ to: "/" });
      return;
    }
    const seed = config.challengeSeed ?? Math.floor(Math.random() * 1e9);
    let sim: MatchResult[];
    if (isKO) {
      const rounds = league.rounds ?? ["Final"];
      const opps = buildKnockoutOpponents(CLUBS, rounds, seed);
      sim = simulateKnockout(opps, rounds, ourRating, seed, config.difficulty);
    } else {
      const opponents = pickOpponents(CLUBS, league.opponentsCount);
      sim = simulateSeason(opponents, league.matches, ourRating, seed, config.difficulty);
    }
    setMatches(sim);
    setRevealCount(0);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!matches.length) return;
    if (revealCount >= matches.length) return;
    const last = matches[revealCount - 1];
    const base = isKO ? 600 : 380;
    const extra = !last ? 120
      : last.outcome === "L" ? 320
      : last.outcome === "D" ? 200
      : isKO ? 180 : 0;
    const t = setTimeout(() => setRevealCount(c => c + 1), base + extra);
    return () => clearTimeout(t);
  }, [matches, revealCount, isKO]);

  const shown = matches.slice(0, revealCount);
  const firstNonWinIdx = matches.findIndex(m => m.outcome === "L");
  const streakBroken = firstNonWinIdx !== -1 && revealCount > firstNonWinIdx;
  const wins = shown.filter(m => m.outcome === "W").length;
  const draws = shown.filter(m => m.outcome === "D").length;
  const losses = shown.filter(m => m.outcome === "L").length;
  const goalsFor = shown.reduce((a, m) => a + m.ourScore, 0);
  const goalsAgainst = shown.reduce((a, m) => a + m.theirScore, 0);
  const seasonOver = revealCount >= matches.length;
  const isUnbeaten = seasonOver && losses === 0;

  const [brandA, brandB] = league.brandMark.split(":");

  return (
    <div className="min-h-screen pb-16">
      <div className="sticky top-0 z-20 backdrop-blur-md bg-background/75 border-b border-border/60">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link to="/" className="brand-mark text-3xl inline-flex items-baseline gap-0.5 leading-none shrink-0">
            <span>{brandA}</span><span className="text-primary">:</span><span>{brandB}</span>
            <span className="ml-2 text-[10px] tracking-[0.25em] text-warning/80 hidden sm:inline">{league.flag} {league.name}</span>
          </Link>
          <div className="flex items-center gap-1.5 text-xs flex-wrap justify-end">
            <Stat label="OVR" value={String(ourRating)} />
            <Stat label="W" value={String(wins)} color="success" />
            <Stat label="D" value={String(draws)} color="warning" />
            <Stat label="L" value={String(losses)} color="destructive" />
            <span className="hidden sm:contents">
              <Stat label="GF" value={String(goalsFor)} />
              <Stat label="GA" value={String(goalsAgainst)} />
            </span>
            <Stat label={isKO ? "RD" : "MD"} value={`${revealCount}/${matches.length}`} />
            {!seasonOver && revealCount > 0 && (
              <button
                onClick={() => setRevealCount(matches.length)}
                className="ml-1 px-2 py-1 rounded border border-warning/40 bg-warning/10 text-warning text-[10px] uppercase tracking-wider font-display hover:bg-warning/20"
              >
                Skip ⏭
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 max-w-5xl mx-auto">
        <AnimatePresence mode="wait">
          {!seasonOver && revealCount > 0 && shown[shown.length - 1] && (
            <LiveCard key={revealCount} match={shown[shown.length - 1]!} league={league} />
          )}
        </AnimatePresence>

        {isKO ? (
          <BracketView matches={matches} revealCount={revealCount} allRounds={league.rounds ?? []} />
        ) : (
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
        )}

        <AnimatePresence>
          {streakBroken && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-6 px-4 py-3 rounded-xl border border-destructive/50 bg-destructive/10 text-center"
            >
              <div className="text-xs uppercase tracking-widest text-destructive font-display">
                {isKO
                  ? `Eliminated · ${matches[firstNonWinIdx]!.round ?? `Match ${matches[firstNonWinIdx]!.matchday}`}`
                  : `Unbeaten run ended · Matchday ${matches[firstNonWinIdx]!.matchday}`}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {seasonOver && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 flex justify-center gap-3 flex-wrap"
          >
            <button
              onClick={async () => {
                const { buildShareText, shareOrCopy } = await import("@/lib/share");
                const text = buildShareText(config, slots, matches, config.challengeSeed);
                await shareOrCopy(text, `${league.brandMark} ${league.tagline}`);
              }}
              className="px-5 py-3 rounded-xl border border-warning/50 bg-warning/10 text-warning font-display tracking-wide hover:bg-warning/20"
            >
              📋 Share recap
            </button>
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

function BracketView({ matches, revealCount, allRounds }: { matches: MatchResult[]; revealCount: number; allRounds: string[] }) {
  // Group played matches by round, preserving order
  const groups: { round: string; items: { m: MatchResult; idx: number }[]; played: boolean }[] = [];
  matches.forEach((m, idx) => {
    const r = m.round ?? "Match";
    const last = groups[groups.length - 1];
    if (last && last.round === r) last.items.push({ m, idx });
    else groups.push({ round: r, items: [{ m, idx }], played: true });
  });

  // Append ghost rounds for any rounds in the bracket that were never reached
  const playedRoundsCount: Record<string, number> = {};
  matches.forEach(m => { const r = m.round ?? "Match"; playedRoundsCount[r] = (playedRoundsCount[r] ?? 0) + 1; });
  const expectedCount: Record<string, number> = {};
  allRounds.forEach(r => { expectedCount[r] = (expectedCount[r] ?? 0) + 1; });
  // Find first round in allRounds that wasn't fully played, render rest as ghosts
  const seenInAll: Record<string, number> = {};
  const ghostRounds: { round: string; slots: number }[] = [];
  let cutoff = false;
  for (const r of allRounds) {
    seenInAll[r] = (seenInAll[r] ?? 0) + 1;
    if (cutoff) {
      const last = ghostRounds[ghostRounds.length - 1];
      if (last && last.round === r) last.slots += 1;
      else ghostRounds.push({ round: r, slots: 1 });
      continue;
    }
    if ((playedRoundsCount[r] ?? 0) < (expectedCount[r] ?? 0)) {
      // Once we encounter an under-played round, mark cutoff for any later rounds
      // (this round itself: if partially played it stays in `groups`; everything AFTER becomes ghost)
      // We only add ghost entries for rounds that come AFTER any played match.
      const lastPlayedRoundIdx = groups.length - 1;
      const currentRoundAlreadyShown = lastPlayedRoundIdx >= 0 && groups[lastPlayedRoundIdx]!.round === r;
      if (!currentRoundAlreadyShown && (playedRoundsCount[r] ?? 0) === 0) {
        ghostRounds.push({ round: r, slots: expectedCount[r] ?? 1 });
      }
      cutoff = true;
    }
  }

  return (
    <div className="mt-6 space-y-5">
      {groups.map((g) => {
        const anyRevealed = g.items.some(it => it.idx < revealCount);
        return (
          <div key={g.round + g.items[0]!.idx} className={`rounded-xl border ${anyRevealed ? "border-warning/40 bg-warning/5" : "border-border bg-card/30"} p-3`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.25em] text-warning/90 font-display">{g.round}</div>
              <div className="text-[10px] text-muted-foreground">{g.items.length} match{g.items.length > 1 ? "es" : ""}</div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {g.items.map(({ m, idx }) => (
                <MatchCard
                  key={idx}
                  match={m}
                  revealed={idx < revealCount}
                  isStreakBreaker={!!m.eliminates && idx < revealCount}
                  dimmed={false}
                />
              ))}
            </div>
          </div>
        );
      })}
      {ghostRounds.map((g, gi) => (
        <div key={`ghost-${gi}-${g.round}`} className="rounded-xl border border-dashed border-muted-foreground/20 bg-card/10 p-3 opacity-60">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-display">{g.round}</div>
            <div className="text-[10px] text-destructive/80 uppercase tracking-widest">Not reached</div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {Array.from({ length: g.slots }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-muted-foreground/20 bg-card/20">
                <div className="w-7 text-[11px] text-muted-foreground font-mono pl-1">—</div>
                <div className="w-8 h-8 rounded-full border border-dashed border-muted-foreground/30" />
                <div className="flex-1 text-xs text-muted-foreground italic">Eliminated in group stage</div>
                <div className="font-display text-lg tabular-nums text-muted-foreground">— —</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveCard({ match, league }: { match: MatchResult; league: typeof LEAGUES[keyof typeof LEAGUES] }) {
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
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
           style={{ background: "repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 8px)" }} />
      <div className="relative flex items-center gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          {match.round
            ? `${match.round} · ${match.home ? "Home" : "Away"}`
            : `MD ${String(match.matchday).padStart(2, "0")} · ${match.home ? "Home" : "Away"}`}
        </div>
        <motion.span
          initial={{ scale: 0.6 }}
          animate={{ scale: [0.6, 1.15, 1] }}
          transition={{ duration: 0.4 }}
          className={`ml-auto px-2 py-0.5 rounded text-[10px] font-display tracking-widest ${badge}`}
        >
          {match.outcome === "W" ? league.winWord : match.outcome === "D" ? league.drawWord : league.lossWord}
        </motion.span>
      </div>
      <div className="relative mt-2 flex items-center gap-3">
        <div className="flex-1 text-right">
          <div className="text-xs text-muted-foreground">{league.tagline}</div>
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
