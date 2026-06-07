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
import { getClubs, getPlayers } from "@/lib/data";
import { simulateSeason, squadRating, computeLeagueTable } from "@/lib/sim";
import {
  computeFormDelta,
  clampForm,
  normalizeName,
  pickScorer,
  pickAssister,
  simplifyPosition,
} from "@/lib/career-core";
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

  // Safe fallback so getClubs() doesn't throw when career.leagueId is null
  // (which happens transiently during the redirect window).
  const leagueId = (career.leagueId ?? "ucl") as LeagueId;
  const clubs = useMemo(() => getClubs(leagueId), [leagueId]);

  // Build the opponent list: 11 AI rivals × their founding clubs
  const opponents = useMemo(() => {
    return career.rivals.map((r) => {
      const club = clubs.find((c) => c.id === r.foundingClubId);
      if (club) return club;
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
          ),
        era: "current" as const,
        era_tier: "current" as const,
      };
    });
  }, [career.rivals, clubs]);

  // Slots representation for squadRating + scorer-picking
  const userSlots: Slot[] = useMemo(() => {
    return career.squad.map((p, i) => ({
      id: `slot-${i}`,
      position: p.position,
      x: 50,
      y: 50,
      player: p,
    }));
  }, [career.squad]);

  const userRating = useMemo(() => squadRating(userSlots), [userSlots]);

  // ─── Simulate the season once on mount ────────────────────────────
  const [matches, setMatches] = useState<MatchWithScorers[]>([]);
  const [shown, setShown] = useState(0); // index of last revealed match
  const [tableComputed, setTableComputed] = useState(false);
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    if (matches.length > 0) return;
    const seed = hashString(`${career.startedAt}-s${career.currentSeason}`);
    const raw = simulateSeason(opponents, MATCHES_PER_SEASON, userRating, seed, "normal");

    // Attach scorers using our match-rng so order is reproducible
    const rand = mulberry32(seed + 1);
    const enriched: MatchWithScorers[] = raw.map((m) => {
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
    setShown((s) => Math.min(s + 1, matches.length));
  }
  function playAll() {
    setShown(matches.length);
    setPlayed(true);
  }

  // Compute form INCREMENTALLY based on matches revealed so far.
  // This drives both the live 🔥/❄️ indicators during the season AND the
  // value persisted to career.form at season end (single source of truth).
  const liveForm = useMemo(() => {
    const f: Record<string, number> = {};
    matches.slice(0, shown).forEach((m) => {
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
  }, [matches, shown, career.squad]);

  // When all matches revealed, persist the final form snapshot to the store
  // so /career/postseason can read it. Run exactly once per season completion.
  useEffect(() => {
    if (shown < matches.length || matches.length === 0) return;
    if (tableComputed) return;
    setTableComputed(true);
    Object.entries(liveForm).forEach(([k, v]) => career.setForm(k, v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, matches.length]);

  // Live league table — recomputes after every matchday revealed.
  const { table, ourPosition } = useMemo(() => {
    if (shown === 0) {
      return { table: [] as ReturnType<typeof computeLeagueTable>["table"], ourPosition: 0 };
    }
    return computeLeagueTable(matches.slice(0, shown), opponents, userRating, MATCHES_PER_SEASON);
  }, [shown, matches, opponents, userRating]);

  // ─── Render ───────────────────────────────────────────────────────
  // Career not yet drafted — bail (the redirect runs from the useEffect above).
  if (career.squad.length === 0 || career.rivals.length === 0) return null;

  if (matches.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Generating fixtures…
      </div>
    );
  }

  const seasonDone = shown >= matches.length;
  const wins = matches.slice(0, shown).filter((m) => m.outcome === "W").length;
  const draws = matches.slice(0, shown).filter((m) => m.outcome === "D").length;
  const losses = matches.slice(0, shown).filter((m) => m.outcome === "L").length;

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

      {/* Live league table — updates after every matchday */}
      {shown > 0 && <LiveTable table={table} matchday={shown} totalMatchdays={matches.length} />}

      {/* Squad form — 🔥 on a run, ❄️ cold streak */}
      {shown > 0 && <SquadForm squad={career.squad} form={liveForm} />}

      {/* Match feed (newest first) */}
      <div className="mt-6">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Match feed
        </div>
        {matches
          .slice(0, shown)
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
  const outcomeColor =
    match.outcome === "W"
      ? "text-success"
      : match.outcome === "L"
        ? "text-primary"
        : "text-muted-foreground";
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
          <span className="font-display text-warning">
            {match.ourScore}-{match.theirScore}
          </span>
        </div>
        {match.scorers.length > 0 && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            ⚽{" "}
            {match.scorers
              .map((s, i) => (s.assister ? `${s.name} (${s.assister})` : s.name))
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

  // Find the demanding star: hottest-form player ≥ +2.0, excluding the
  // franchise (untouchable). Only one demand per season — the loudest voice.
  const STAR_DEMAND_THRESHOLD = 2.0;
  const demandingStar = useMemo(() => {
    const enriched = career.squad
      .map((p) => ({
        player: p,
        formVal: liveForm[`${p.club}:${normalizeName(p.name)}`] ?? 0,
      }))
      .filter((e) => e.formVal >= STAR_DEMAND_THRESHOLD)
      .filter((e) => `${e.player.club}:${e.player.name}` !== career.franchisePlayerKey)
      .sort((a, b) => b.formVal - a.formVal);
    return enriched[0]?.player ?? null;
  }, [career.squad, liveForm, career.franchisePlayerKey]);

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
      endedAt: new Date().toISOString(),
    });
    career.setRelegated(isRelegated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  void userRating;

  // Gate: if a star is demanding AND the user hasn't answered yet,
  // show the demand card instead of the next-step CTA.
  if (demandingStar && !career.starDemandResolved) {
    return (
      <StarDemandCard
        player={demandingStar}
        onKeep={() => {
          // Penalty: next draft starts with 1 reroll instead of 3.
          career.setRerollsNextSeason(1);
          career.setPendingDeparture(null);
          career.setStarDemandResolved(true);
        }}
        onLetGo={() => {
          // Player leaves at the start of next draft. Rerolls untouched.
          career.setPendingDeparture(`${demandingStar.club}:${demandingStar.name}`);
          career.setRerollsNextSeason(3);
          career.setStarDemandResolved(true);
        }}
      />
    );
  }

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
          : "Transfer window next: form events + squad rebuild for the next season."}
      </div>
      <Link
        to={isCupQualifier ? "/career/cup" : "/career/postseason"}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning text-warning-foreground font-display text-base tracking-wide hover:brightness-110 transition"
      >
        {isCupQualifier ? "Enter cup →" : "Transfer window →"}
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
  const allPlayers = useMemo(() => getPlayers(leagueId), [leagueId]);
  const allClubs = useMemo(() => getClubs(leagueId), [leagueId]);

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

  // Stage 3: pick incoming player from spun club
  if (stage === "picking-in" && spunClub) {
    const pool = allPlayers
      .filter((p) => p.club === spunClub.id && !drafted.has(`${p.club}:${p.name}`))
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
            Who goes out? Tap a player to swap. ⭐ Franchise can't be removed.
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {career.squad.map((p, i) => {
            const key = `${p.club}:${p.name}`;
            const isFranchise = key === career.franchisePlayerKey;
            return (
              <button
                key={`out-${i}-${p.name}`}
                disabled={isFranchise}
                onClick={() => commitSwap(i)}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm text-left transition ${
                  isFranchise
                    ? "border-warning/40 bg-warning/5 opacity-60 cursor-not-allowed"
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

/**
 * End-of-season star demand card.
 *
 * If a non-franchise player ended the season on form ≥ +2, they demand
 * to leave. User has a binary choice:
 *
 *   KEEP HIM  → next draft starts with 1 reroll (of 3). The star stays.
 *   LET HIM GO → next draft keeps all 3 rerolls. The star departs at the
 *                start of the next draft (removed by /career/postseason).
 *
 * One demand max per season. Franchise player never triggers a demand.
 */
function StarDemandCard({
  player,
  onKeep,
  onLetGo,
}: {
  player: Player;
  onKeep: () => void;
  onLetGo: () => void;
}) {
  return (
    <div className="mt-8 rounded-2xl border-2 border-primary bg-primary/10 p-6">
      <div className="text-center mb-4">
        <div className="text-4xl mb-1">💬</div>
        <div className="text-[11px] uppercase tracking-widest text-primary">Star demand</div>
        <div className="font-display text-2xl text-warning mt-2">{player.name} wants out</div>
        <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto">
          After a hot season, your{" "}
          <span className="text-warning">
            {player.position} · {player.prime_rating}
          </span>{" "}
          rated {player.name} feels they've outgrown the squad. Convince them to stay or let them
          walk.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-5">
        <button
          onClick={onKeep}
          className="rounded-xl border-2 border-warning bg-warning/15 hover:bg-warning/25 p-4 text-left transition"
        >
          <div className="font-display text-warning text-lg mb-1">Keep him</div>
          <div className="text-[11px] text-muted-foreground leading-relaxed">
            He stays. Cost: next draft starts with only{" "}
            <span className="text-warning">1 reroll</span> (instead of 3) — you'll be stuck with
            what the wheel gives you.
          </div>
        </button>
        <button
          onClick={onLetGo}
          className="rounded-xl border-2 border-primary/40 bg-primary/5 hover:bg-primary/15 p-4 text-left transition"
        >
          <div className="font-display text-primary text-lg mb-1">Let him go</div>
          <div className="text-[11px] text-muted-foreground leading-relaxed">
            He walks. You keep all <span className="text-warning">3 rerolls</span> for next draft,
            but the slot has to be re-drafted.
          </div>
        </button>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
