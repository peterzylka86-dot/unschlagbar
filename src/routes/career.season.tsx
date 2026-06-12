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
import { getCareerClubs, getCareerPlayers } from "@/lib/data";
import { buildSeasonFixtures, simulateOneMatch, squadRating, computeLeagueTable } from "@/lib/sim";
import { isPositionCompatible, playerFitsSlot } from "@/lib/draft-helpers";
import {
  computeFormDelta,
  clampForm,
  normalizeName,
  pickScorer,
  pickAssister,
  simplifyPosition,
} from "@/lib/career-core";
import { resolveXI, xiToSlots, canSwapIntoXI, playerKey, effectiveRating } from "@/lib/matchday-xi";
import type { Club, MatchResult, Player, Slot } from "@/lib/game-types";

export const Route = createFileRoute("/career/season")({
  head: () => ({ meta: [{ title: "Season · GOLAZO" }] }),
  component: CareerSeason,
});

const MATCHES_PER_SEASON = 22;
// Mid-season swap window opens AFTER this many matchdays have been played.
// At MATCHES_PER_SEASON=22, that's after MD11 — halfway through.
const MID_SEASON_GATE = Math.floor(MATCHES_PER_SEASON / 2);

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

  // Safe fallback for HUD label; the actual pool is the cross-league super-pool.
  const leagueId = (career.leagueId ?? "ucl") as LeagueId;
  void leagueId; // still referenced for the HUD subtitle below
  const clubs = useMemo(() => getCareerClubs(), []);

  // Build the opponent list: 11 AI rivals × their founding clubs.
  //
  // RIVAL ESCALATION: each season beyond the first, every rival gains
  // +1 strength (capped at +8). Fixes the flat difficulty curve — season
  // 5 should be harder than season 1 because the league caught up to
  // you. The bump is announced in the transfer-news card on
  // /career/postseason so it never feels arbitrary.
  // NOTE: clubs from the data cache are shared objects — always clone
  // before bumping, never mutate.
  const escalation = Math.min(8, Math.max(0, career.currentSeason - 1));
  const opponents = useMemo(() => {
    return career.rivals.map((r) => {
      const club = clubs.find((c) => c.id === r.foundingClubId);
      if (club) return { ...club, strength: club.strength + escalation };
      // Fallback (shouldn't happen but be safe)
      return {
        id: r.foundingClubId,
        name: r.archetypeName,
        short: r.badge.slice(0, 3),
        city: "—",
        color: r.color,
        founded: 1900,
        strength:
          75 +
          Math.floor(
            r.squad.reduce((a, p) => a + p.prime_rating, 0) / Math.max(1, r.squad.length) - 75,
          ) +
          escalation,
        era: "current" as const,
        era_tier: "current" as const,
      };
    });
  }, [career.rivals, clubs, escalation]);

  // ─── Per-matchday simulation (benching) ─────────────────────────────
  //
  // Previously the whole season was pre-simulated at mount with ONE
  // squad rating, then revealed matchday by matchday. With the squad-of-14
  // bench system, each matchday simulates ON PLAY using the rating of the
  // CURRENT starting XI — so rotating a hot bench player in genuinely
  // changes the next result. Fixture list stays precomputed (deterministic
  // schedule); only the match outcomes are rolled per matchday with a
  // per-matchday derived seed (stable on re-render / resume).
  const seasonSeed = useMemo(
    () => hashString(`${career.startedAt}-s${career.currentSeason}`),
    [career.startedAt, career.currentSeason],
  );
  const fixtures = useMemo(
    () => buildSeasonFixtures(opponents, MATCHES_PER_SEASON, seasonSeed),
    [opponents, seasonSeed],
  );

  const [matches, setMatches] = useState<MatchWithScorers[]>([]);
  const shown = matches.length;
  const [tableComputed, setTableComputed] = useState(false);

  // Form computed from PLAYED matches — drives both the 🔥/❄️ badges and
  // the XI auto-pick ranking, so a cold streak genuinely costs a starter
  // their place if the user (or auto-pick) reacts.
  const liveForm = useMemo(() => {
    const f: Record<string, number> = {};
    matches.forEach((m) => {
      career.squad.forEach((p) => {
        const key = `${p.club}:${normalizeName(p.name)}`;
        const current = f[key] ?? 0;
        const wasInvolved = m.scorers.some(
          (s) =>
            normalizeName(s.name) === normalizeName(p.name) ||
            (s.assister && normalizeName(s.assister) === normalizeName(p.name)),
        );
        const delta = computeFormDelta(p, {
          wasInvolved,
          gf: m.ourScore,
          ga: m.theirScore,
          currentForm: current,
        });
        f[key] = clampForm(current + delta);
      });
    });
    return f;
  }, [matches, career.squad]);

  // The starting XI — stored selection resolved against the live squad
  // (departed players dropped, holes auto-filled from compatible bench).
  const xiKeys = useMemo(
    () => resolveXI(career.squad, career.startingXI, career.formation, liveForm),
    [career.squad, career.startingXI, career.formation, liveForm],
  );
  const xiSlots: Slot[] = useMemo(
    () => xiToSlots(career.squad, xiKeys, career.formation),
    [career.squad, xiKeys, career.formation],
  );
  const xiPlayers = useMemo(
    () => xiSlots.map((s) => s.player).filter((p): p is Player => !!p),
    [xiSlots],
  );

  // Rating of the SELECTED XI (not the full 14) + a small form kicker:
  // average XI form in [-2, 2] rounds to a ±2 rating swing. This is what
  // makes rotation strategic rather than cosmetic.
  const userRating = useMemo(() => {
    const base = squadRating(xiSlots);
    if (xiPlayers.length === 0) return base;
    const avgForm =
      xiPlayers.reduce(
        (sum, p) => sum + (liveForm[`${p.club}:${normalizeName(p.name)}`] ?? 0),
        0,
      ) / xiPlayers.length;
    return base + Math.round(Math.max(-2, Math.min(2, avgForm)));
  }, [xiSlots, xiPlayers, liveForm]);

  // Stable rating for the AI table jitter — must NOT change with XI
  // rotation or the rival W/D/L sequences would reshuffle every matchday.
  const tableSeedRating = useMemo(() => {
    const fullSlots: Slot[] = career.squad.map((p, i) => ({
      id: `slot-${i}`,
      position: p.position,
      x: 50,
      y: 50,
      player: p,
    }));
    return squadRating(fullSlots.slice(0, 11));
  }, [career.squad]);

  // ─── Play matchdays — simulate with the CURRENT XI on each click ────
  function simulateNext(prev: MatchWithScorers[], rating: number): MatchWithScorers | null {
    const idx = prev.length;
    if (idx >= fixtures.length) return null;
    const m = simulateOneMatch(fixtures[idx], idx + 1, rating, seasonSeed, "normal");
    // Scorers from the players ON THE PITCH (the XI), not the bench.
    const rand = mulberry32(seasonSeed + (idx + 1) * 7919);
    const scorers: { name: string; assister?: string }[] = [];
    for (let g = 0; g < m.ourScore; g++) {
      const s = pickScorer(xiPlayers, liveForm, rand);
      if (!s) continue;
      const a = pickAssister(xiPlayers, s, rand);
      scorers.push({ name: s.name, assister: a?.name });
    }
    return { ...m, scorers };
  }

  function playNext() {
    setMatches((prev) => {
      const next = simulateNext(prev, userRating);
      return next ? [...prev, next] : prev;
    });
  }
  function playAll() {
    // Sim the remaining matchdays with the CURRENT XI (no further
    // rotation once you hit skip — that's the tradeoff of skipping).
    setMatches((prev) => {
      const out = [...prev];
      while (out.length < fixtures.length) {
        const next = simulateNext(out, userRating);
        if (!next) break;
        out.push(next);
      }
      return out;
    });
  }

  // When all matchdays are played, persist the final form snapshot to the
  // store so /career/postseason can read it. Run exactly once.
  useEffect(() => {
    if (shown < MATCHES_PER_SEASON || matches.length === 0) return;
    if (tableComputed) return;
    setTableComputed(true);
    Object.entries(liveForm).forEach(([k, v]) => career.setForm(k, v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, matches.length]);

  // Live league table — recomputes after every matchday played.
  const { table, ourPosition } = useMemo(() => {
    if (shown === 0) {
      return { table: [] as ReturnType<typeof computeLeagueTable>["table"], ourPosition: 0 };
    }
    return computeLeagueTable(matches, opponents, tableSeedRating, MATCHES_PER_SEASON);
  }, [shown, matches, opponents, tableSeedRating]);

  // ─── Render ───────────────────────────────────────────────────────
  // Career not yet drafted — bail (the redirect runs from the useEffect above).
  if (career.squad.length === 0 || career.rivals.length === 0) return null;

  // Matches accumulate as the user plays — matchday 0 is a valid state
  // ("season hasn't kicked off"), no loading gate needed since fixtures
  // are computed synchronously.
  const seasonDone = shown >= MATCHES_PER_SEASON;
  const wins = matches.filter((m) => m.outcome === "W").length;
  const draws = matches.filter((m) => m.outcome === "D").length;
  const losses = matches.filter((m) => m.outcome === "L").length;
  const hasBench = career.squad.length > xiKeys.length;

  return (
    <div className="min-h-screen px-4 py-8 max-w-4xl mx-auto">
      <header className="flex items-center justify-between gap-3">
        <Link
          to="/career"
          className="text-[11px] text-muted-foreground hover:text-warning underline"
        >
          ← GOLAZO hub
        </Link>
        <div className="text-right">
          <div className="font-display text-2xl text-warning">Season {career.currentSeason}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            Matchday {shown} of {MATCHES_PER_SEASON}
          </div>
        </div>
      </header>

      {/* Season progress bar — visual matchday timeline (more readable than raw "3/22") */}
      <div className="mt-4">
        <div className="h-2 rounded-full bg-card/60 overflow-hidden border border-border/60">
          <div
            className="h-full bg-gradient-to-r from-warning/80 to-warning transition-all duration-500 ease-out"
            style={{ width: `${(shown / MATCHES_PER_SEASON) * 100}%` }}
          />
        </div>
      </div>

      {/* Scoreboard */}
      <div className="mt-5 grid grid-cols-4 gap-2 text-center">
        <ScoreboardStat label="W" value={wins} accent="text-success" />
        <ScoreboardStat label="D" value={draws} accent="text-muted-foreground" />
        <ScoreboardStat label="L" value={losses} accent="text-primary" />
        <ScoreboardStat label="OVR" value={Math.round(userRating)} accent="text-warning" />
      </div>

      {/* Matchday Squad — the benching system. Only shown when the squad
          actually has a bench (squad of 14); legacy 11-player careers
          skip it entirely. Collapsed by default to keep the play loop
          one tap; opens for users who want to rotate. */}
      {!seasonDone && hasBench && (
        <MatchdaySquadPanel
          squad={career.squad}
          xiKeys={xiKeys}
          form={liveForm}
          formation={career.formation}
          franchiseKey={career.franchisePlayerKey}
          onSwap={(outKey, inKey) => {
            if (!canSwapIntoXI(career.squad, xiKeys, outKey, inKey, career.formation)) return;
            const next = xiKeys.filter((k) => k !== outKey).concat(inKey);
            career.setStartingXI(next);
          }}
        />
      )}

      {/* Mid-season swap window — gates progression until used or skipped.
          Triggers exactly once per season, after MD11. */}
      {!seasonDone && shown >= MID_SEASON_GATE && !career.midSeasonSwapUsed && (
        <MidSeasonSwapCard />
      )}

      {/* Action row — hidden while the mid-season swap window is open */}
      {!seasonDone && !(shown >= MID_SEASON_GATE && !career.midSeasonSwapUsed) && (
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

      {/* Match feed (newest first) — surfaces immediately so the player
          sees the result of the click they just made. Table + form below. */}
      <div className="mt-6">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Match feed
        </div>
        {matches
          .slice()
          .reverse()
          .map((m) => (
            <MatchRow key={`md-${m.matchday}`} match={m} />
          ))}
        {shown === 0 && (
          <p className="text-sm text-muted-foreground italic py-6 text-center">
            Click "Play matchday 1" to start the season.
          </p>
        )}
      </div>

      {/* Squad form — 🔥 on a run, ❄️ cold streak */}
      {shown > 0 && <SquadForm squad={career.squad} form={liveForm} />}

      {/* Live league table — updates after every matchday */}
      {shown > 0 && <LiveTable table={table} matchday={shown} totalMatchdays={MATCHES_PER_SEASON} />}

      {/* End-of-season — next-step CTA (final table already shown live above) */}
      {seasonDone && (
        <PostSeasonCTA
          ourPosition={ourPosition}
          matches={matches}
          userRating={userRating}
          opponents={opponents}
          liveForm={liveForm}
        />
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
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── sub-components ──────────────────────────────────────────────────

/** Matchday squad management — starters vs bench, tap-to-swap.
 *
 *  Interaction: tap a bench player → eligible starters highlight → tap
 *  one to swap. Position legality enforced by canSwapIntoXI (the parent
 *  validates again before committing — UI and store can't disagree).
 *  Effective rating shown = prime + form, the same number the auto-pick
 *  ranks by, so the UI never contradicts the selection logic. */
function MatchdaySquadPanel({
  squad,
  xiKeys,
  form,
  formation,
  franchiseKey,
  onSwap,
}: {
  squad: Player[];
  xiKeys: string[];
  form: Record<string, number>;
  formation: import("@/lib/game-types").FormationKey;
  franchiseKey: string | null;
  onSwap: (outKey: string, inKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingIn, setPendingIn] = useState<string | null>(null);

  const xiSet = new Set(xiKeys);
  const starters = squad.filter((p) => xiSet.has(playerKey(p)));
  const bench = squad.filter((p) => !xiSet.has(playerKey(p)));

  function formBadge(p: Player) {
    const f = form[`${p.club}:${normalizeName(p.name)}`] ?? 0;
    if (f >= 1.5) return "🔥";
    if (f <= -1.5) return "❄️";
    return null;
  }

  function rowFor(p: Player, isStarter: boolean) {
    const key = playerKey(p);
    const isFranchise = key === franchiseKey;
    const eff = Math.round(effectiveRating(p, formKeyedForm(p, form)) * 10) / 10;
    const isPendingTarget =
      pendingIn !== null && isStarter && canSwapIntoXI(squad, xiKeys, key, pendingIn, formation);
    const isPendingSource = pendingIn === key;
    return (
      <button
        key={key}
        onClick={() => {
          if (isStarter) {
            if (isPendingTarget && pendingIn) {
              onSwap(key, pendingIn);
              setPendingIn(null);
            }
            // Tapping a starter without a pending bench pick: no-op.
          } else {
            setPendingIn(isPendingSource ? null : key);
          }
        }}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left text-xs transition ${
          isPendingSource
            ? "border-warning bg-warning/15 ring-1 ring-warning/50"
            : isPendingTarget
              ? "border-success bg-success/10 ring-1 ring-success/40 cursor-pointer"
              : "border-border/60 bg-background/40"
        }`}
      >
        <span className="font-mono text-[10px] text-warning w-8 shrink-0">{p.position}</span>
        <span className="flex-1 truncate">
          {isFranchise && "⭐ "}
          {p.name}
          {formBadge(p) && <span className="ml-1">{formBadge(p)}</span>}
        </span>
        <span className="font-display text-sm text-warning shrink-0">{eff}</span>
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card/40">
      <button
        onClick={() => {
          setOpen((v) => !v);
          setPendingIn(null);
        }}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="font-display text-sm tracking-wide text-foreground/90">
          ⚽ Matchday Squad
          <span className="ml-2 text-[10px] text-muted-foreground normal-case">
            {starters.length} start · {bench.length} bench
          </span>
        </div>
        <span className={`text-warning transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-[10px] text-muted-foreground mb-3">
            Tap a bench player, then tap the starter to replace. 🔥 hot / ❄️ cold form counts
            toward the rating.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
                Starting XI
              </div>
              <div className="space-y-1">{starters.map((p) => rowFor(p, true))}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
                Bench
              </div>
              <div className="space-y-1">{bench.map((p) => rowFor(p, false))}</div>
              {bench.length === 0 && (
                <div className="text-[11px] text-muted-foreground italic">No bench players.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Adapter: matchday-xi's effectiveRating expects the form map keyed by
 *  formKey (club:normalized-name) — same map liveForm already uses. */
function formKeyedForm(_p: Player, form: Record<string, number>): Record<string, number> {
  return form;
}

function ScoreboardStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 py-3">
      <div className={`font-display text-2xl ${accent}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-1">
        {label}
      </div>
    </div>
  );
}

function MatchRow({ match }: { match: MatchWithScorers }) {
  // Color the entire left edge by outcome for instant scannability —
  // user can run their eye down the match feed and see W/D/L pattern.
  const outcomeAccent =
    match.outcome === "W"
      ? "border-l-success bg-success/[0.04]"
      : match.outcome === "L"
        ? "border-l-primary bg-primary/[0.04]"
        : "border-l-muted-foreground/40";
  const outcomeText =
    match.outcome === "W"
      ? "text-success"
      : match.outcome === "L"
        ? "text-primary"
        : "text-muted-foreground";
  return (
    <div
      className={`flex items-center gap-3 py-2.5 px-3 rounded-lg border border-border border-l-4 ${outcomeAccent} mb-1.5`}
    >
      <div className="w-10 shrink-0 text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
        MD {String(match.matchday).padStart(2, "0")}
      </div>
      <div className={`font-display text-lg shrink-0 w-7 text-center ${outcomeText}`}>
        {match.outcome}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
            {match.home ? "vs" : "@"}
          </span>
          <span className="font-display text-sm truncate flex-1">{match.opponent.name}</span>
          <span className="font-display text-base tabular-nums shrink-0">
            <span className={outcomeText}>{match.ourScore}</span>
            <span className="opacity-50 mx-0.5">–</span>
            <span className="text-muted-foreground">{match.theirScore}</span>
          </span>
        </div>
        {match.scorers.length > 0 && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            ⚽{" "}
            {match.scorers
              .map((s) => (s.assister ? `${s.name} (${s.assister})` : s.name))
              .join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}

function LiveTable({
  table,
  matchday,
  totalMatchdays,
}: {
  table: ReturnType<typeof computeLeagueTable>["table"];
  matchday: number;
  totalMatchdays: number;
}) {
  const isFinal = matchday >= totalMatchdays;
  return (
    <div className="mt-8">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3 flex items-baseline justify-between">
        <span>{isFinal ? "Final table" : "Live table"}</span>
        <span className="text-[10px] normal-case tracking-normal opacity-70">
          After MD {matchday}/{totalMatchdays}
        </span>
      </div>
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
                <td className="px-3 py-1.5 text-center tabular-nums text-[11px]">
                  {row.gf}:{row.ga}
                </td>
                <td className="px-3 py-1.5 text-center tabular-nums font-display">{row.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground flex justify-between px-1">
        <span>
          <span className="text-warning">CUP</span> = top 8 qualify for knockout
        </span>
        <span>
          <span className="opacity-60">Bottom 2</span> = relegation zone
        </span>
      </div>
    </div>
  );
}

function PostSeasonCTA({
  ourPosition,
  matches,
  userRating,
  opponents,
  liveForm,
}: {
  ourPosition: number;
  matches: MatchWithScorers[];
  userRating: number;
  opponents: import("@/lib/game-types").Club[];
  liveForm: Record<string, number>;
}) {
  const career = useCareer();
  const isCupQualifier = ourPosition <= 8;
  const isRelegated = ourPosition >= 11;
  const isChampion = ourPosition === 1;

  // Record this season into career.seasonHistory exactly once.
  useEffect(() => {
    const alreadyRecorded = career.seasonHistory.some((s) => s.season === career.currentSeason);
    if (alreadyRecorded) return;
    const wins = matches.filter((m) => m.outcome === "W").length;
    const draws = matches.filter((m) => m.outcome === "D").length;
    const losses = matches.filter((m) => m.outcome === "L").length;
    const goalsFor = matches.reduce((a, m) => a + m.ourScore, 0);
    const goalsAgainst = matches.reduce((a, m) => a + m.theirScore, 0);
    const trophies: string[] = [];
    if (isChampion) trophies.push("League Champion");
    // Top scorer: count goal-event names across the whole season.
    const goalCounts = new Map<string, number>();
    matches.forEach((m) =>
      m.scorers.forEach((s) => goalCounts.set(s.name, (goalCounts.get(s.name) ?? 0) + 1)),
    );
    let topScorer: { name: string; goals: number } | undefined;
    goalCounts.forEach((g, name) => {
      if (!topScorer || g > topScorer.goals) topScorer = { name, goals: g };
    });
    career.recordSeason({
      season: career.currentSeason,
      leagueId: career.leagueId ?? "ucl",
      foundingClubId: career.foundingClubId ?? "",
      formation: career.formation,
      finalPosition: ourPosition,
      totalLeagueClubs: opponents.length + 1,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      cupResult: "did-not-qualify", // updated by /career/cup if applicable
      relegated: isRelegated,
      trophies,
      topScorer,
      endedAt: new Date().toISOString(),
    });
    career.setRelegated(isRelegated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  void userRating;
  void liveForm;

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
      {career.pendingDeparture && (
        <div className="text-xs text-primary mb-2">
          🚪 A star will leave at the start of next season.
        </div>
      )}
      <div className="text-xs text-muted-foreground mb-5">
        {isCupQualifier
          ? "🏆 Cup competition next — top 8 finishers compete in a knockout for the trophy."
          : "Season recap next: tactic view + shareable image of your super squad."}
      </div>
      <Link
        to={isCupQualifier ? "/career/cup" : "/career/recap"}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning text-warning-foreground font-display text-base tracking-wide hover:brightness-110 transition"
      >
        {isCupQualifier ? "Enter cup →" : "Season recap →"}
      </Link>
    </div>
  );
}

function SquadForm({ squad, form }: { squad: Player[]; form: Record<string, number> }) {
  // 🔥 hot streak: form >= +1.5 · ❄️ cold streak: form <= -1.5
  // Threshold chosen empirically — picks up ~top 2-3 / bottom 2-3 over a season.
  const HOT = 1.5;
  const COLD = -1.5;
  const enriched = squad.map((p) => ({
    player: p,
    formVal: form[`${p.club}:${normalizeName(p.name)}`] ?? 0,
  }));
  const fire = enriched.filter((e) => e.formVal >= HOT).sort((a, b) => b.formVal - a.formVal);
  const ice = enriched.filter((e) => e.formVal <= COLD).sort((a, b) => a.formVal - b.formVal);
  if (fire.length === 0 && ice.length === 0) return null;
  return (
    <div className="mt-6 grid sm:grid-cols-2 gap-3">
      {fire.length > 0 && (
        <div className="rounded-xl border border-success/40 bg-success/5 p-3">
          <div className="text-[10px] uppercase tracking-widest text-success mb-2">🔥 On a run</div>
          <ul className="space-y-1">
            {fire.map((e) => (
              <li
                key={`hot-${e.player.club}-${e.player.name}`}
                className="flex justify-between text-xs"
              >
                <span className="truncate">
                  <span className="text-muted-foreground text-[10px] mr-1">
                    {simplifyPosition(e.player.position)}
                  </span>
                  {e.player.name}
                </span>
                <span className="text-success font-display tabular-nums">
                  +{e.formVal.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ice.length > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="text-[10px] uppercase tracking-widest text-primary mb-2">❄️ Cold</div>
          <ul className="space-y-1">
            {ice.map((e) => (
              <li
                key={`cold-${e.player.club}-${e.player.name}`}
                className="flex justify-between text-xs"
              >
                <span className="truncate">
                  <span className="text-muted-foreground text-[10px] mr-1">
                    {simplifyPosition(e.player.position)}
                  </span>
                  {e.player.name}
                </span>
                <span className="text-primary font-display tabular-nums">
                  {e.formVal.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Mid-season swap window — appears exactly once per season after MD11.
 *
 * Rule: ONE swap, or skip. No escape hatch — once you accept the spin,
 * you must commit to a swap (you can't bail back out). The franchise
 * player can never be swapped out.
 *
 * Flow: prompt → spinning → picking-in (player to bring in) → picking-out
 * (squad member to send out, franchise excluded) → done (sets midSeasonSwapUsed).
 */
function MidSeasonSwapCard() {
  const career = useCareer();
  const leagueId = (career.leagueId ?? "ucl") as LeagueId;
  const allPlayers = useMemo(() => getCareerPlayers(), []);
  const allClubs = useMemo(() => getCareerClubs(), []);

  const [stage, setStage] = useState<"prompt" | "spinning" | "picking-in" | "picking-out">(
    "prompt",
  );
  const [spunClub, setSpunClub] = useState<Club | null>(null);
  const [incoming, setIncoming] = useState<Player | null>(null);

  // Set of every player already in a squad (user + all rivals). They're
  // off-limits — we don't tempt the user with players that aren't free.
  const drafted = useMemo(() => {
    const set = new Set<string>();
    career.squad.forEach((p) => set.add(`${p.club}:${p.name}`));
    career.rivals.forEach((r) => r.squad.forEach((p) => set.add(`${p.club}:${p.name}`)));
    return set;
  }, [career.squad, career.rivals]);

  function spin() {
    setStage("spinning");
    // 700ms delay for tension; then random club with at least 1 free player.
    setTimeout(() => {
      const eligibleClubs = allClubs.filter((c) =>
        allPlayers.some((p) => p.club === c.id && !drafted.has(`${p.club}:${p.name}`)),
      );
      if (eligibleClubs.length === 0) {
        // Edge case: no clubs have free players. Skip the swap.
        career.setMidSeasonSwapUsed(true);
        return;
      }
      const pick = eligibleClubs[Math.floor(Math.random() * eligibleClubs.length)];
      setSpunClub(pick);
      setStage("picking-in");
    }, 700);
  }

  function pickIncoming(p: Player) {
    setIncoming(p);
    setStage("picking-out");
  }

  function commitSwap(outIndex: number) {
    if (!incoming) return;
    career.swapSquadPlayer(outIndex, incoming);
    career.setMidSeasonSwapUsed(true);
  }

  function skip() {
    career.setMidSeasonSwapUsed(true);
  }

  // Stage 1: offer card
  if (stage === "prompt") {
    return (
      <div className="mt-6 rounded-2xl border-2 border-warning bg-warning/10 p-5 text-center">
        <div className="text-3xl mb-1">🔄</div>
        <div className="font-display text-xl text-warning mb-1">Mid-Season Window</div>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
          Halfway through the season. ONE swap available — spin for a player and commit to a swap,
          or pass and keep your squad. No going back once you spin.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            onClick={spin}
            className="px-5 py-2.5 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
          >
            🎰 Spin for a swap
          </button>
          <button
            onClick={skip}
            className="px-5 py-2.5 rounded-md border border-muted-foreground/40 text-muted-foreground text-sm hover:bg-muted/30 transition"
          >
            Skip — keep my squad
          </button>
        </div>
      </div>
    );
  }

  // Stage 2: spinning UI
  if (stage === "spinning") {
    return (
      <div className="mt-6 rounded-2xl border-2 border-warning bg-warning/10 p-8 text-center">
        <div className="text-5xl animate-spin inline-block">🎰</div>
        <div className="mt-3 text-sm text-muted-foreground">Spinning…</div>
      </div>
    );
  }

  // Stage 3: pick incoming player from spun club.
  // Filter to positions the user can actually swap into — non-franchise
  // squad slots whose position is compatible. Avoids dead-end UX where
  // the user picks a GK but their GK is the franchise player.
  if (stage === "picking-in" && spunClub) {
    const swappableSquadPositions = career.squad
      .filter((p) => `${p.club}:${p.name}` !== career.franchisePlayerKey)
      .map((p) => p.position);
    const pool = allPlayers
      .filter((p) => p.club === spunClub.id && !drafted.has(`${p.club}:${p.name}`))
      .filter((p) => swappableSquadPositions.some((sp) => playerFitsSlot(sp, p)))
      .sort((a, b) => b.prime_rating - a.prime_rating)
      .slice(0, 12); // top-12 by rating to keep the grid scannable
    return (
      <div className="mt-6 rounded-2xl border-2 border-warning bg-warning/10 p-5">
        <div className="text-center mb-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Wheel landed on
          </div>
          <div className="font-display text-2xl text-warning">{spunClub.name}</div>
          <div className="text-xs text-muted-foreground mt-1">
            Pick the player you want — you'll commit to a swap next.
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {pool.map((p) => (
            <button
              key={`in-${p.name}`}
              onClick={() => pickIncoming(p)}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-left hover:border-warning hover:bg-warning/10 transition"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {p.position} · {p.career_years}
                </div>
              </div>
              <span className="shrink-0 font-display text-sm text-warning">{p.prime_rating}</span>
            </button>
          ))}
        </div>
        {pool.length === 0 && (
          <p className="text-sm text-muted-foreground italic text-center py-4">
            No free players at {spunClub.name}. Skipping…
          </p>
        )}
      </div>
    );
  }

  // Stage 4: pick which squad member to swap OUT (franchise excluded)
  if (stage === "picking-out" && incoming) {
    return (
      <div className="mt-6 rounded-2xl border-2 border-warning bg-warning/10 p-5">
        <div className="text-center mb-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Incoming
          </div>
          <div className="font-display text-xl text-warning">
            {incoming.name} <span className="opacity-70">· {incoming.position}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Who goes out? Same position only — ⭐ Franchise can't be removed.
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {career.squad.map((p, i) => {
            const key = `${p.club}:${p.name}`;
            const isFranchise = key === career.franchisePlayerKey;
            // POSITION-RESTRICTED SWAP: incoming player must fit the slot
            // the squad member currently fills. playerFitsSlot considers
            // BOTH the incoming's primary position AND their altPositions
            // — so Mbappé (LW + [ST]) can swap into either an LW or ST
            // slot, but Sørloth (ST, no alts) can only enter an ST slot.
            const samePosition = playerFitsSlot(p.position, incoming);
            const disabled = isFranchise || !samePosition;
            return (
              <button
                key={`out-${i}-${p.name}`}
                disabled={disabled}
                onClick={() => commitSwap(i)}
                title={
                  isFranchise
                    ? "Franchise player — untouchable"
                    : !samePosition
                      ? `Position mismatch — ${incoming.position} can't replace ${p.position}`
                      : undefined
                }
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm text-left transition ${
                  isFranchise
                    ? "border-warning/40 bg-warning/5 opacity-60 cursor-not-allowed"
                    : !samePosition
                      ? "border-border bg-card opacity-40 cursor-not-allowed"
                      : "border-border bg-card hover:border-primary hover:bg-primary/10"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate flex items-center gap-1">
                    {isFranchise && <span>⭐</span>}
                    <span className="truncate">{p.name}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {p.position} · {p.career_years}
                    {isFranchise && <span className="text-warning ml-1">· Franchise</span>}
                    {!isFranchise && !samePosition && (
                      <span className="text-muted-foreground/60 ml-1">· position mismatch</span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 font-display text-sm text-warning">{p.prime_rating}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
