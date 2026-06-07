/**
 * /career/season — play through the full 22-matchday season.
 *
 * 12-manager league (user + 11 AI rivals). The user plays each rival
 * home + away → 22 matches. AI-vs-AI results are not simulated match by
 * match; instead their standings come from computeLeagueTable's
 * strength-jittered formula (same approach as the one-match Season screen
 * — keeps the simulation honest while not requiring 132 background
 * matches per season).
 *
 * Match feed shows scorers + assisters and the goal-by-goal flow. End of
 * season → final table + 'Continue to post-season' CTA.
 *
 * Form deltas are computed per match and persisted to the career store
 * so the post-season transfer screen can read them.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useCareer } from "@/lib/career-store";
import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";
import { getClubs } from "@/lib/data";
import { simulateSeason, squadRating, computeLeagueTable } from "@/lib/sim";
import {
  computeFormDelta, clampForm, normalizeName, pickScorer, pickAssister,
  simplifyPosition,
} from "@/lib/career-core";
import type { Club, MatchResult, Player, Slot } from "@/lib/game-types";

export const Route = createFileRoute("/career/season")({
  head: () => ({ meta: [{ title: "Season · GOLAZO" }] }),
  component: CareerSeason,
});

const MATCHES_PER_SEASON = 22;

interface MatchWithScorers extends MatchResult {
  scorers: { name: string; assister?: string }[];
}

function CareerSeason() {
  const career = useCareer();
  const navigate = useNavigate();

  // Guard: bounce to /career if no draft completed. CRITICAL: this useEffect
  // runs unconditionally — DO NOT early-return before the hooks below it
  // (rules-of-hooks violation; React crashes the page).
  useEffect(() => {
    if (career.squad.length === 0 || career.rivals.length === 0) {
      navigate({ to: "/career" });
    }
  }, [career.squad, career.rivals, navigate]);

  // Safe fallback so getClubs() doesn't throw when career.leagueId is null
  // (which happens transiently during the redirect window).
  const leagueId = (career.leagueId ?? "ucl") as LeagueId;
  const clubs = useMemo(() => getClubs(leagueId), [leagueId]);

  // Build the opponent list: 11 AI rivals × their founding clubs
  const opponents = useMemo(() => {
    return career.rivals.map(r => {
      const club = clubs.find(c => c.id === r.foundingClubId);
      if (club) return club;
      // Fallback (shouldn't happen but be safe)
      return {
        id: r.foundingClubId, name: r.archetypeName, short: r.badge.slice(0, 3),
        city: "—", color: r.color, founded: 1900,
        strength: 75 + Math.floor(r.squad.reduce((a, p) => a + p.prime_rating, 0) / Math.max(1, r.squad.length) - 75),
        era: "current" as const, era_tier: "current" as const,
      };
    });
  }, [career.rivals, clubs]);

  // Slots representation for squadRating + scorer-picking
  const userSlots: Slot[] = useMemo(() => {
    return career.squad.map((p, i) => ({
      id: `slot-${i}`, position: p.position, x: 50, y: 50, player: p,
    }));
  }, [career.squad]);

  const userRating = useMemo(() => squadRating(userSlots), [userSlots]);

  // ─── Simulate the season once on mount ────────────────────────────
  const [matches, setMatches] = useState<MatchWithScorers[]>([]);
  const [shown, setShown] = useState(0);  // index of last revealed match
  const [tableComputed, setTableComputed] = useState(false);
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    if (matches.length > 0) return;
    const seed = hashString(`${career.startedAt}-s${career.currentSeason}`);
    const raw = simulateSeason(opponents, MATCHES_PER_SEASON, userRating, seed, "normal");

    // Attach scorers using our match-rng so order is reproducible
    const rand = mulberry32(seed + 1);
    const enriched: MatchWithScorers[] = raw.map(m => {
      const scorers: { name: string; assister?: string }[] = [];
      const xi = career.squad;
      for (let g = 0; g < m.ourScore; g++) {
        const s = pickScorer(xi, null, rand);
        if (!s) continue;
        const a = pickAssister(xi, s, rand);
        scorers.push({ name: s.name, assister: a?.name });
      }
      return { ...m, scorers };
    });
    setMatches(enriched);
  }, [matches.length, opponents, userRating, career.squad, career.startedAt, career.currentSeason]);

  // ─── Reveal matchdays one by one (or all at once on "Skip") ───────
  function playNext() {
    setShown(s => Math.min(s + 1, matches.length));
  }
  function playAll() {
    setShown(matches.length);
    setPlayed(true);
  }

  // When all matches revealed, compute form deltas + write to store
  useEffect(() => {
    if (shown < matches.length || matches.length === 0) return;
    if (tableComputed) return;
    setTableComputed(true);

    // Apply form deltas per match per player. Each player picks up ~1 match
    // of form influence (involved? goals for/against?). Aggregate over season.
    const formNext: Record<string, number> = { ...career.form };
    matches.forEach(m => {
      career.squad.forEach(p => {
        const key = `${p.club}:${normalizeName(p.name)}`;
        const current = formNext[key] ?? 0;
        const wasInvolved = m.scorers.some(s => normalizeName(s.name) === normalizeName(p.name)
          || (s.assister && normalizeName(s.assister) === normalizeName(p.name)));
        const delta = computeFormDelta(p, {
          wasInvolved, gf: m.ourScore, ga: m.theirScore, currentForm: current,
        });
        formNext[key] = clampForm(current + delta);
      });
    });
    // Single batched write
    Object.entries(formNext).forEach(([k, v]) => career.setForm(k, v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, matches.length]);

  const { table, ourPosition } = useMemo(() => {
    if (shown < matches.length) return { table: [], ourPosition: 0 };
    return computeLeagueTable(matches.slice(0, shown), opponents, userRating, MATCHES_PER_SEASON);
  }, [shown, matches, opponents, userRating]);

  // ─── Render ───────────────────────────────────────────────────────
  // Career not yet drafted — bail (the redirect runs from the useEffect above).
  if (career.squad.length === 0 || career.rivals.length === 0) return null;

  if (matches.length === 0) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Generating fixtures…</div>;
  }

  const seasonDone = shown >= matches.length;
  const wins = matches.slice(0, shown).filter(m => m.outcome === "W").length;
  const draws = matches.slice(0, shown).filter(m => m.outcome === "D").length;
  const losses = matches.slice(0, shown).filter(m => m.outcome === "L").length;

  return (
    <div className="min-h-screen px-4 py-8 max-w-4xl mx-auto">
      <header className="flex items-center justify-between gap-3">
        <Link to="/career" className="text-[11px] text-muted-foreground hover:text-warning underline">
          ← GOLAZO hub
        </Link>
        <div className="text-right">
          <div className="font-display text-2xl text-warning">Season {career.currentSeason}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            Played {shown} / {matches.length}
          </div>
        </div>
      </header>

      {/* Scoreboard */}
      <div className="mt-6 grid grid-cols-4 gap-2 text-center">
        <ScoreboardStat label="W" value={wins} accent="text-success" />
        <ScoreboardStat label="D" value={draws} accent="text-muted-foreground" />
        <ScoreboardStat label="L" value={losses} accent="text-primary" />
        <ScoreboardStat label="OVR" value={Math.round(userRating)} accent="text-warning" />
      </div>

      {/* Action row */}
      {!seasonDone && (
        <div className="mt-6 flex gap-2">
          <button
            onClick={playNext}
            className="flex-1 px-4 py-3 rounded-md bg-success text-success-foreground font-display tracking-wide hover:brightness-110 transition"
          >
            Play matchday {shown + 1} →
          </button>
          <button
            onClick={playAll}
            className="px-4 py-3 rounded-md border border-warning/40 text-warning text-sm hover:bg-warning/10 transition"
            title="Simulate all remaining matchdays at once"
          >
            ⏩ Skip
          </button>
        </div>
      )}

      {/* Match feed (newest first) */}
      <div className="mt-6">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Match feed
        </div>
        {matches.slice(0, shown).slice().reverse().map((m, i) => (
          <MatchRow key={`md-${m.matchday}`} match={m} />
        ))}
        {shown === 0 && (
          <p className="text-sm text-muted-foreground italic py-6 text-center">
            Click "Play matchday 1" to start the season.
          </p>
        )}
      </div>

      {/* End-of-season — final table + next step */}
      {seasonDone && (
        <>
          <FinalTable table={table} />
          <PostSeasonCTA ourPosition={ourPosition} />
        </>
      )}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function hashString(s: string | null): number {
  if (!s) return 12345;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── sub-components ──────────────────────────────────────────────────

function ScoreboardStat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 py-3">
      <div className={`font-display text-2xl ${accent}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function MatchRow({ match }: { match: MatchWithScorers }) {
  const outcomeColor =
    match.outcome === "W" ? "text-success" :
    match.outcome === "L" ? "text-primary" :
    "text-muted-foreground";
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg border border-border bg-card/40 mb-1.5">
      <div className="w-10 shrink-0 text-[11px] text-muted-foreground font-mono">
        MD {String(match.matchday).padStart(2, "0")}
      </div>
      <div className={`font-display text-base shrink-0 w-7 text-center ${outcomeColor}`}>
        {match.outcome}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-display text-sm truncate">
          {match.home ? "vs" : "@"} {match.opponent.name}{" "}
          <span className="font-display text-warning">{match.ourScore}-{match.theirScore}</span>
        </div>
        {match.scorers.length > 0 && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            ⚽ {match.scorers.map((s, i) =>
              s.assister ? `${s.name} (${s.assister})` : s.name
            ).join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}

function FinalTable({ table }: { table: ReturnType<typeof computeLeagueTable>["table"] }) {
  return (
    <div className="mt-8">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Final table</div>
      <div className="rounded-2xl border border-border bg-card/40 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-3 py-2 text-left w-8">#</th>
              <th className="px-3 py-2 text-left">Team</th>
              <th className="px-3 py-2 text-center w-10">P</th>
              <th className="px-3 py-2 text-center w-10">W</th>
              <th className="px-3 py-2 text-center w-10">D</th>
              <th className="px-3 py-2 text-center w-10">L</th>
              <th className="px-3 py-2 text-center w-14">GF:GA</th>
              <th className="px-3 py-2 text-center w-12">Pts</th>
            </tr>
          </thead>
          <tbody>
            {table.map((row, i) => (
              <tr
                key={`${row.name}-${i}`}
                className={`border-b border-border last:border-b-0 ${
                  row.isUs ? "bg-warning/10 text-warning font-display" : ""
                } ${i < 8 ? "" : i >= table.length - 2 ? "text-muted-foreground/60" : ""}`}
              >
                <td className="px-3 py-1.5 text-left tabular-nums">{i + 1}</td>
                <td className="px-3 py-1.5 text-left truncate">
                  {row.isUs ? "Your XI" : row.short || row.name}
                  {i < 8 && <span className="text-[9px] ml-1 opacity-60">CUP</span>}
                </td>
                <td className="px-3 py-1.5 text-center tabular-nums">{row.played}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{row.w}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{row.d}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{row.l}</td>
                <td className="px-3 py-1.5 text-center tabular-nums text-[11px]">{row.gf}:{row.ga}</td>
                <td className="px-3 py-1.5 text-center tabular-nums font-display">{row.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground flex justify-between px-1">
        <span><span className="text-warning">CUP</span> = top 8 qualify for knockout</span>
        <span><span className="opacity-60">Bottom 2</span> = relegation zone</span>
      </div>
    </div>
  );
}

function PostSeasonCTA({ ourPosition }: { ourPosition: number }) {
  const isCupQualifier = ourPosition <= 8;
  const isRelegated = ourPosition >= 11;
  const isChampion = ourPosition === 1;
  return (
    <div className="mt-8 rounded-2xl border-2 border-warning bg-warning/10 p-6 text-center">
      <div className="text-4xl mb-2">
        {isChampion ? "🏆" : isCupQualifier ? "⚽" : isRelegated ? "📉" : "🎯"}
      </div>
      <div className="font-display text-2xl text-warning mb-2">
        {isChampion
          ? "Champions!"
          : isCupQualifier
            ? `Finished ${ourPosition}${ordinal(ourPosition)} · cup qualifier`
            : isRelegated
              ? `Relegated · finished ${ourPosition}${ordinal(ourPosition)}`
              : `Finished ${ourPosition}${ordinal(ourPosition)}`}
      </div>
      <div className="text-xs text-muted-foreground mb-5">
        Transfer window next: hot-form players demand moves, cold-form players auto-sell,
        you fill any open slots.
      </div>
      <Link
        to="/career/postseason"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning text-warning-foreground font-display text-base tracking-wide hover:brightness-110 transition"
      >
        Transfer window →
      </Link>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
