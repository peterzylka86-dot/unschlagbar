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
import { motion, AnimatePresence } from "framer-motion";
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
import { matchCommentary, boardNote } from "@/lib/commentary";
import { seasonDiary } from "@/lib/flavour";
import {
  deriveMorale,
  averageMorale,
  moraleRatingKick,
  moraleBadge,
  MORALE_NEUTRAL,
  talkEffect,
  TALK_OPTIONS,
  boardExpectation,
  deriveConfidence,
  type TalkId,
} from "@/lib/management";
import { ageStep, growthTier } from "@/lib/wonderkids";
import { Fragment } from "react";
import type { Club, MatchResult, Player, Slot } from "@/lib/game-types";

export const Route = createFileRoute("/career/season")({
  head: () => ({ meta: [{ title: "Season · GOLAZO" }] }),
  component: CareerSeason,
});

const MATCHES_PER_SEASON = 22;
// Mid-season swap window opens AFTER this many matchdays have been played.
// At MATCHES_PER_SEASON=22, that's after MD11 — halfway through.
const MID_SEASON_GATE = Math.floor(MATCHES_PER_SEASON / 2);

// ─── Fatigue / stamina (game-design item #6) ────────────────────────────
// Starting a match accumulates fatigue; resting on the bench recovers it.
// Fatigue ≤ FATIGUE_FRESH costs nothing; above it, effective rating drops
// linearly to −FATIGUE_MAX_PENALTY at fatigue 100. This is what makes the
// 3-man bench MATTER — ride your best XI every game and they're gassed for
// the run-in; rotate and keep them sharp. Delivers the "rotation dilemma"
// that item #6 (cup-congestion) was meant to create, integrated cleanly
// with the benching system instead of a risky league-calendar rewrite.
const FATIGUE_PER_START = 11; // each start adds this
const FATIGUE_RECOVERY = 19; // each rested matchday removes this
const FATIGUE_FRESH = 50; // no penalty at or below this
const FATIGUE_MAX_PENALTY = 5; // OVR points lost at fatigue 100

/** OVR penalty (≤ 0) for a given fatigue level. 0 when fresh, ramping to
 *  −FATIGUE_MAX_PENALTY at 100. */
function fatiguePenalty(fatigue: number): number {
  if (fatigue <= FATIGUE_FRESH) return 0;
  const over = (fatigue - FATIGUE_FRESH) / (100 - FATIGUE_FRESH); // 0..1
  return -over * FATIGUE_MAX_PENALTY;
}

/** Compute fatigue per player key from the matchday lineups played so far.
 *  starts × FATIGUE_PER_START − rests × FATIGUE_RECOVERY, clamped [0,100].
 *  Keyed by `club:name` (squad key), NOT the normalized form key. */
function computeFatigue(lineups: string[][], squad: Player[]): Record<string, number> {
  const out: Record<string, number> = {};
  const played = lineups.length;
  for (const p of squad) {
    const key = `${p.club}:${p.name}`;
    const starts = lineups.reduce((n, xi) => n + (xi.includes(key) ? 1 : 0), 0);
    const rests = played - starts;
    out[key] = Math.max(
      0,
      Math.min(100, starts * FATIGUE_PER_START - rests * FATIGUE_RECOVERY),
    );
  }
  return out;
}

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
  const clubs = useMemo(() => getCareerClubs(career.foundingClubId, career.careerMode), [career.foundingClubId, career.careerMode]);

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
  // Parallel to `matches`: lineups[i] = the XI keys that started matchday i.
  // Drives the fatigue model — who played vs who rested.
  const [lineups, setLineups] = useState<string[][]>([]);
  // Parallel to `matches`: talks[i] = the team talk chosen for matchday i,
  // with its resolved morale delta + feed line. Local state (like lineups)
  // because the season replays deterministically from the seed — the talk's
  // rating effect is already baked into the stored match result.
  const [talks, setTalks] = useState<{ id: TalkId; moraleDelta: number; line: string }[]>([]);
  const shown = matches.length;
  const [tableComputed, setTableComputed] = useState(false);

  // Fatigue per squad player (club:name key), derived from lineups played.
  const fatigue = useMemo(() => computeFatigue(lineups, career.squad), [lineups, career.squad]);

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

  // Season news diary — back-page headlines, dressing-room mood, and the
  // daft between-match events, one beat per matchday, woven into the feed.
  const diaryByMatchday = useMemo(() => {
    const beats = seasonDiary({
      season: career.currentSeason,
      matches: matches.map((m) => ({
        matchday: m.matchday,
        ourScore: m.ourScore,
        theirScore: m.theirScore,
        outcome: m.outcome,
        scorers: m.scorers.map((s) => ({ name: s.name })),
      })),
      squad: career.squad.map((p) => ({
        name: p.name,
        position: p.position,
        prime_rating: p.prime_rating,
      })),
    });
    return new Map(beats.map((b) => [b.matchday, b]));
  }, [matches, career.squad, career.currentSeason]);

  // Combined selection adjustment, keyed by FORM key (club:normalized):
  // form (±2) PLUS fatigue penalty (0..−5). This is the number that drives
  // BOTH the auto-pick ranking and the displayed effective rating, so a
  // gassed starter visibly slides and the user is nudged to rest them.
  // liveForm stays pure (form only) for the 🔥/❄️ badges + store persist.
  const selectionForm = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of career.squad) {
      const fk = `${p.club}:${normalizeName(p.name)}`;
      const sk = `${p.club}:${p.name}`;
      out[fk] = (liveForm[fk] ?? 0) + fatiguePenalty(fatigue[sk] ?? 0);
    }
    return out;
  }, [career.squad, liveForm, fatigue]);

  // The starting XI — stored selection resolved against the live squad
  // (departed players dropped, holes auto-filled from compatible bench).
  const xiKeys = useMemo(
    () => resolveXI(career.squad, career.startingXI, career.formation, selectionForm),
    [career.squad, career.startingXI, career.formation, selectionForm],
  );
  const xiSlots: Slot[] = useMemo(
    () => xiToSlots(career.squad, xiKeys, career.formation),
    [career.squad, xiKeys, career.formation],
  );
  const xiPlayers = useMemo(
    () => xiSlots.map((s) => s.player).filter((p): p is Player => !!p),
    [xiSlots],
  );

  // Rating of the SELECTED XI (not the full 14) + a form/fatigue kicker:
  // average of (form − fatigue penalty) across the XI, rounded. A fresh
  // in-form XI plays a few points above its raw OVR; a gassed one plays
  // below. This is the lever rotation pulls.
  const userRating = useMemo(() => {
    const base = squadRating(xiSlots);
    if (xiPlayers.length === 0) return base;
    const avgAdj =
      xiPlayers.reduce(
        (sum, p) => sum + (selectionForm[`${p.club}:${normalizeName(p.name)}`] ?? 0),
        0,
      ) / xiPlayers.length;
    return base + Math.round(Math.max(-3, Math.min(2, avgAdj)));
  }, [xiSlots, xiPlayers, selectionForm]);

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

  // ─── Management: morale + board (derived, never accumulated) ──────────
  // Per-player morale from playing time + results + team-talk choices.
  const morale = useMemo(
    () =>
      deriveMorale({
        squadKeys: career.squad.map((p) => `${p.club}:${p.name}`),
        matches: matches.map((m) => ({
          outcome: m.outcome,
          ourScore: m.ourScore,
          theirScore: m.theirScore,
        })),
        lineups,
        talkMoraleDeltas: talks.map((t) => t.moraleDelta),
        unsettledKeys: career.unsettledKeys,
      }),
    [career.squad, matches, lineups, talks, career.unsettledKeys],
  );
  // Dressing-room mood = mean morale across the current XI.
  const dressingRoom = useMemo(() => averageMorale(morale, xiKeys), [morale, xiKeys]);
  // The board's pre-season brief, read off raw squad strength vs. the league.
  const expectation = useMemo(
    () => boardExpectation(tableSeedRating, opponents.map((o) => o.strength)),
    [tableSeedRating, opponents],
  );

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

  // Play the next matchday after the chosen team talk. The talk + squad
  // morale fold into the rating for THIS match only, so a well-judged talk
  // (or a backfired one) genuinely swings the result.
  function playNext(talk: TalkId) {
    const nextOpp = fixtures[matches.length];
    const isUnderdog = !!nextOpp && (nextOpp.opponent.strength ?? userRating) > userRating;
    const effect = talkEffect(talk, dressingRoom, isUnderdog);
    const rating = userRating + moraleRatingKick(dressingRoom) + effect.ratingDelta;
    let appended = false;
    setMatches((prev) => {
      const next = simulateNext(prev, rating);
      if (!next) return prev;
      appended = true;
      return [...prev, next];
    });
    if (appended) {
      setLineups((prev) => [...prev, xiKeys]);
      setTalks((prev) => [...prev, { id: talk, moraleDelta: effect.moraleDelta, line: effect.line }]);
    }
  }
  function playAll() {
    // Sim the remaining matchdays with the CURRENT XI and a safe "calm"
    // talk each week (no interactive choice on the bulk skip — the tradeoff
    // of skipping, same as it freezes rotation + fatigue).
    const calm = talkEffect("calm", dressingRoom, false);
    const rating = userRating + moraleRatingKick(dressingRoom) + calm.ratingDelta;
    setMatches((prev) => {
      const out = [...prev];
      while (out.length < fixtures.length) {
        const next = simulateNext(out, rating);
        if (!next) break;
        out.push(next);
      }
      return out;
    });
    setLineups((prev) => {
      const out = [...prev];
      while (out.length < fixtures.length) out.push(xiKeys);
      return out;
    });
    setTalks((prev) => {
      const out = [...prev];
      while (out.length < fixtures.length)
        out.push({ id: "calm", moraleDelta: calm.moraleDelta, line: calm.line });
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

  // Board confidence — results vs. the brief. Drives the job-security HUD.
  const confidence = useMemo(
    () =>
      deriveConfidence({
        matches: matches.map((m) => ({
          outcome: m.outcome,
          ourScore: m.ourScore,
          theirScore: m.theirScore,
        })),
        targetPosition: expectation.targetPosition,
        currentPosition: ourPosition,
      }),
    [matches, expectation.targetPosition, ourPosition],
  );

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

      {/* Board confidence + dressing-room mood — the job-security HUD. */}
      <BoardHud confidence={confidence} expectation={expectation} dressingRoom={dressingRoom} seasonDone={seasonDone} />

      {/* Matchday Squad — the benching system. Only shown when the squad
          actually has a bench (squad of 14); legacy 11-player careers
          skip it entirely. Collapsed by default to keep the play loop
          one tap; opens for users who want to rotate. */}
      {!seasonDone && hasBench && (
        <MatchdaySquadPanel
          squad={career.squad}
          xiKeys={xiKeys}
          form={liveForm}
          ratingAdj={selectionForm}
          fatigue={fatigue}
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

      {/* Next-match preview — who's up, how strong, and their danger man. */}
      {!seasonDone && fixtures[shown] && (
        <NextMatchPreview
          fixture={fixtures[shown]}
          rival={career.rivals.find((r) => r.foundingClubId === fixtures[shown].opponent.id) ?? null}
          ourRating={userRating}
        />
      )}

      {/* Team talk — the pre-match decision. Pick a talk and the matchday
          plays with its effect folded in. Hidden during the swap window. */}
      {!seasonDone && !(shown >= MID_SEASON_GATE && !career.midSeasonSwapUsed) && (
        <div className="mt-6">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2 text-center">
            🎙️ Team talk · matchday {shown + 1}
            {fixtures[shown] ? ` · ${fixtures[shown].home ? "vs" : "@"} ${fixtures[shown].opponent.short}` : ""}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {TALK_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => playNext(opt.id)}
                className="px-2 py-3 rounded-md border border-success/40 bg-success/10 text-success hover:bg-success/20 hover:-translate-y-0.5 transition text-center"
              >
                <div className="font-display text-xs tracking-wide">{opt.label}</div>
                <div className="text-[9px] text-muted-foreground mt-1 normal-case leading-tight">
                  {opt.hint}
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={playAll}
            className="mt-2 w-full px-4 py-2 rounded-md border border-warning/40 text-warning text-xs hover:bg-warning/10 transition"
            title="Simulate all remaining matchdays with calm talks"
          >
            ⏩ Skip the rest (calm talks)
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
            <Fragment key={`md-${m.matchday}`}>
              <MatchRow match={m} teamTalkLine={talks[m.matchday - 1]?.line ?? null} />
              {diaryByMatchday.get(m.matchday) && (
                <DiaryLine beat={diaryByMatchday.get(m.matchday)!} />
              )}
            </Fragment>
          ))}
        {shown === 0 && (
          <p className="text-sm text-muted-foreground italic py-6 text-center">
            Click "Play matchday 1" to start the season.
          </p>
        )}
      </div>

      {/* Squad form — 🔥 on a run, ❄️ cold streak + dressing-room morale */}
      {shown > 0 && <SquadForm squad={career.squad} form={liveForm} morale={morale} />}

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
          lineups={lineups}
        />
      )}

      {/* Ceremony overlay — fires once when the season ends in a title or
          relegation. Champions get a gold confetti burst; relegation gets
          a somber descent. Purely celebratory punctuation; dismisses to
          reveal the PostSeasonCTA underneath. */}
      {seasonDone && (
        <SeasonCeremony
          season={career.currentSeason}
          isChampion={ourPosition === 1}
          isRelegated={ourPosition >= 11}
        />
      )}
    </div>
  );
}

/** Full-screen ceremony for title / relegation. Shows once per season
 *  end (dismiss to continue). Champions: gold confetti + trophy lift.
 *  Relegation: dimmed, downward drift, "rebuild" framing. Neutral
 *  finishes get no overlay — undeserved drama cheapens the real ones. */
function SeasonCeremony({
  season,
  isChampion,
  isRelegated,
}: {
  season: number;
  isChampion: boolean;
  isRelegated: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || (!isChampion && !isRelegated)) return null;

  // Deterministic-ish confetti layout — index-derived, no Math.random in
  // render path needed for correctness (this is pure decoration).
  const confetti = Array.from({ length: 36 }, (_, i) => i);
  const colors = ["#facc15", "#22c55e", "#ef4444", "#fafafa", "#fbbf24"];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{
          background: isChampion
            ? "radial-gradient(circle at 50% 30%, rgba(250,204,21,0.25), rgba(5,5,5,0.96) 70%)"
            : "radial-gradient(circle at 50% 40%, rgba(40,40,48,0.4), rgba(5,5,5,0.97) 70%)",
        }}
        onClick={() => setDismissed(true)}
      >
        {/* Champion confetti */}
        {isChampion &&
          confetti.map((i) => {
            const left = (i * 53) % 100;
            const delay = (i % 12) * 0.12;
            const drift = (i % 5) - 2;
            return (
              <motion.div
                key={i}
                className="absolute top-0"
                style={{
                  left: `${left}%`,
                  width: 8,
                  height: 12,
                  background: colors[i % colors.length],
                  borderRadius: 2,
                }}
                initial={{ y: -40, opacity: 0, rotate: 0 }}
                animate={{
                  y: ["-5vh", "105vh"],
                  opacity: [0, 1, 1, 0],
                  rotate: [0, 360 + i * 12],
                  x: [0, drift * 30],
                }}
                transition={{ duration: 2.6 + (i % 4) * 0.4, delay, ease: "easeIn" }}
              />
            );
          })}

        <motion.div
          initial={{ scale: 0.7, y: 30 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 16 }}
          className="relative text-center"
        >
          <div className="text-7xl mb-3">{isChampion ? "🏆" : "📉"}</div>
          <div
            className={`font-display text-4xl sm:text-5xl ${
              isChampion ? "text-warning" : "text-primary"
            }`}
          >
            {isChampion ? "CHAMPIONS" : "RELEGATED"}
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {isChampion
              ? `Season ${season} — you won the league.`
              : `Season ${season} — a hard year. Rebuild and bounce back.`}
          </div>
          <button
            onClick={() => setDismissed(true)}
            className={`mt-6 px-6 py-2.5 rounded-md font-display tracking-wide transition ${
              isChampion
                ? "bg-warning text-warning-foreground hover:brightness-110"
                : "border border-muted-foreground/40 text-muted-foreground hover:bg-muted/30"
            }`}
          >
            {isChampion ? "Lift the trophy →" : "Continue →"}
          </button>
          <div className="mt-3 text-[10px] text-muted-foreground/60 uppercase tracking-widest">
            tap anywhere to continue
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
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
  ratingAdj,
  fatigue,
  formation,
  franchiseKey,
  onSwap,
}: {
  squad: Player[];
  xiKeys: string[];
  /** Pure form map (formKey → ±2) for the 🔥/❄️ badge. */
  form: Record<string, number>;
  /** Combined form+fatigue adjustment (formKey → number) for the
   *  displayed effective rating — matches what the sim actually uses. */
  ratingAdj: Record<string, number>;
  /** Fatigue per squad key (club:name → 0..100) for the stamina bar. */
  fatigue: Record<string, number>;
  formation: import("@/lib/game-types").FormationKey;
  franchiseKey: string | null;
  onSwap: (outKey: string, inKey: string) => void;
}) {
  // Open by default — the squad is the thing you act on every matchday, so
  // it stays visible rather than hidden behind a tap.
  const [open, setOpen] = useState(true);
  const [pendingIn, setPendingIn] = useState<string | null>(null);

  const xiSet = new Set(xiKeys);
  const starters = squad.filter((p) => xiSet.has(playerKey(p)));
  const bench = squad.filter((p) => !xiSet.has(playerKey(p)));

  // Map each starter to the SLOT they're actually filling, so the chip
  // shows the role (RB) not just their primary position (LB) — otherwise a
  // versatile player reads as the wrong position and the XI looks broken.
  const slotByKey = new Map<string, string>();
  for (const s of xiToSlots(squad, xiKeys, formation)) {
    if (s.player) slotByKey.set(playerKey(s.player), s.position);
  }

  function formBadge(p: Player) {
    const f = form[`${p.club}:${normalizeName(p.name)}`] ?? 0;
    if (f >= 1.5) return "🔥";
    if (f <= -1.5) return "❄️";
    return null;
  }

  function staminaBadge(p: Player) {
    const fat = fatigue[`${p.club}:${p.name}`] ?? 0;
    if (fat >= 80) return { icon: "🪫", tone: "text-primary" };
    if (fat >= 55) return { icon: "🟡", tone: "text-warning" };
    return null;
  }

  function rowFor(p: Player, isStarter: boolean) {
    const key = playerKey(p);
    const isFranchise = key === franchiseKey;
    const eff = Math.round(effectiveRating(p, formKeyedForm(p, ratingAdj)) * 10) / 10;
    const stamina = staminaBadge(p);
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
        <span className="font-mono text-[10px] text-warning w-8 shrink-0">
          {isStarter ? (slotByKey.get(key) ?? p.position) : p.position}
        </span>
        <span className="flex-1 truncate">
          {isFranchise && "⭐ "}
          {isStarter && (slotByKey.get(key) ?? p.position) !== p.position && (
            <span className="text-[10px] text-muted-foreground mr-1" title="Natural position">
              ({p.position})
            </span>
          )}
          {p.wonderkidId && (
            <span title={`Prospect, age ${p.age} — growing toward ${p.targetRating}`}>✨ </span>
          )}
          {p.name}
          {formBadge(p) && <span className="ml-1">{formBadge(p)}</span>}
          {stamina && (
            <span className={`ml-1 ${stamina.tone}`} title="Fatigued — rest to recover">
              {stamina.icon}
            </span>
          )}
          {p.wonderkidId && p.targetRating != null && p.prime_rating < p.targetRating && (
            <span className="ml-1 text-[10px] text-warning/70" title="Current → potential">
              {p.age}y →{p.targetRating}
            </span>
          )}
          {!p.wonderkidId && p.age != null && (
            <span
              className={`ml-1 text-[10px] ${p.age >= 30 ? "text-primary/70" : "text-muted-foreground"}`}
              title={p.age >= 30 ? "Declining with age" : "Age"}
            >
              {p.age}y
              {p.age >= 30 ? " ↓" : p.potential && p.prime_rating < p.potential ? " ↑" : ""}
            </span>
          )}
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
            Tap a bench player, then tap the starter to replace. 🔥 hot / ❄️ cold form and
            🪫 fatigue (rest to recover) both count toward the rating.
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

function NextMatchPreview({
  fixture,
  rival,
  ourRating,
}: {
  fixture: import("@/lib/sim").Fixture;
  rival: { archetypeName: string; badge: string; color: string; squad: Player[] } | null;
  ourRating: number;
}) {
  const opp = fixture.opponent;
  // Their danger man = highest-rated player in the rival's squad.
  const star = rival && rival.squad.length > 0
    ? [...rival.squad].sort((a, b) => b.prime_rating - a.prime_rating)[0]
    : null;
  // Difficulty read from strength gap.
  const gap = ourRating - opp.strength;
  const odds =
    gap >= 6
      ? { label: "Favourites", tone: "text-success" }
      : gap <= -6
        ? { label: "Underdogs", tone: "text-primary" }
        : { label: "Even contest", tone: "text-warning" };
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Next up · {fixture.home ? "Home" : "Away"}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: opp.color }}
            />
            <span className="font-display text-lg truncate">{opp.name}</span>
          </div>
          {star && (
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              ⭐ Danger man:{" "}
              <span className="text-foreground/90">{star.name}</span>{" "}
              <span className="text-warning font-display">{star.prime_rating}</span>
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="font-display text-xl text-warning">{Math.round(opp.strength)}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">OVR</div>
          <div className={`text-[10px] mt-0.5 font-display tracking-wide ${odds.tone}`}>
            {odds.label}
          </div>
        </div>
      </div>
    </div>
  );
}

function BoardHud({
  confidence,
  expectation,
  dressingRoom,
  seasonDone,
}: {
  confidence: import("@/lib/management").ConfidenceState;
  expectation: import("@/lib/management").BoardExpectation;
  dressingRoom: number;
  seasonDone: boolean;
}) {
  const tone = confidence.tone;
  const barColor =
    tone === "adored"
      ? "bg-success"
      : tone === "backed"
        ? "bg-warning"
        : tone === "pressure"
          ? "bg-orange-500"
          : "bg-primary";
  const textColor =
    tone === "adored"
      ? "text-success"
      : tone === "backed"
        ? "text-warning"
        : tone === "pressure"
          ? "text-orange-400"
          : "text-primary";
  const mood = moraleBadge(dressingRoom);
  return (
    <div className="mt-4 rounded-xl border border-border bg-card/40 p-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="uppercase tracking-widest text-muted-foreground">Board confidence</span>
        <span className={`${textColor} font-display tabular-nums`}>
          {confidence.value}% · {confidence.label}
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-background/60 overflow-hidden border border-border/60">
        <div
          className={`h-full ${barColor} transition-all duration-500 ease-out`}
          style={{ width: `${confidence.value}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="truncate">📋 {expectation.label}</span>
        <span className="shrink-0">
          🛋️ {mood.icon} {mood.label}
        </span>
      </div>
      {confidence.threatened && !seasonDone && (
        <div className="mt-2 text-[11px] text-primary border border-primary/40 bg-primary/10 rounded-md px-2 py-1.5">
          ⚠️ The board has called a vote of confidence. Turn it around — fast — or you're gone.
        </div>
      )}
    </div>
  );
}

function DiaryLine({ beat }: { beat: import("@/lib/flavour").FlavourBeat }) {
  // News interstitial between match rows — the back pages / dressing-room /
  // daft-event ticker. Headlines read louder (uppercase, warning tint);
  // morale + events sit quieter in muted italic.
  const isHeadline = beat.kind === "headline";
  return (
    <div
      className={`flex items-start gap-2 py-1.5 px-3 mb-1.5 ${
        isHeadline ? "text-warning/90" : "text-muted-foreground/80"
      }`}
    >
      <span className="text-[11px] shrink-0">{beat.icon}</span>
      <span
        className={`text-[11px] ${
          isHeadline ? "font-display tracking-wide" : "italic"
        }`}
      >
        {beat.text}
      </span>
    </div>
  );
}

function MatchRow({ match, teamTalkLine }: { match: MatchWithScorers; teamTalkLine?: string | null }) {
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

  // Flavour line (the Anstoss "secret sauce") — derive hat-trick + top
  // scorer from this match's goal events, then pick a deterministic,
  // situation-appropriate one-liner.
  const counts = new Map<string, number>();
  match.scorers.forEach((s) => counts.set(s.name, (counts.get(s.name) ?? 0) + 1));
  let hatTrickScorer: string | undefined;
  let topScorer: string | undefined;
  let top = 0;
  counts.forEach((g, name) => {
    if (g >= 3 && !hatTrickScorer) hatTrickScorer = name;
    if (g > top) {
      top = g;
      topScorer = name;
    }
  });
  const flavour = matchCommentary(match, {
    opp: match.opponent.short || match.opponent.name,
    hatTrickScorer,
    topScorer,
  });
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
        {teamTalkLine && (
          <div className="text-[11px] text-warning/70 italic truncate mb-0.5">
            🎙️ {teamTalkLine}
          </div>
        )}
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
        {flavour && (
          <div className="text-[11px] text-muted-foreground/80 italic truncate mt-0.5">
            {flavour}
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
  lineups,
}: {
  ourPosition: number;
  matches: MatchWithScorers[];
  userRating: number;
  opponents: import("@/lib/game-types").Club[];
  liveForm: Record<string, number>;
  lineups: string[][];
}) {
  const career = useCareer();
  const isCupQualifier = ourPosition <= 8;
  const isRelegated = ourPosition >= 11;
  const isChampion = ourPosition === 1;

  // Record this season into career.seasonHistory exactly once.
  useEffect(() => {
    const alreadyRecorded = career.seasonHistory.some((s) => s.season === career.currentSeason);
    if (alreadyRecorded) return;

    // ── Ageing tick — once per season, here at the boundary where we have
    // both the squad and the lineups (matchdays started). EVERY player who
    // carries an age evolves: a young one who started leaps toward his
    // ceiling (legend prime for wonderkids, FIFA potential for real
    // players), tapering near his peak; from 30 he declines. Legends with
    // no age stay timeless. Minutes drive growth, so playing the kid pays.
    const startsByKey = new Map<string, number>();
    for (const xi of lineups) for (const k of xi) startsByKey.set(k, (startsByKey.get(k) ?? 0) + 1);
    const growth: Record<string, { prime_rating: number; age: number }> = {};
    for (const p of career.squad) {
      if (p.age == null) continue; // timeless legends — no ageing
      const key = `${p.club}:${p.name}`;
      const starts = startsByKey.get(key) ?? 0;
      const tier = growthTier(starts, lineups.length || MATCHES_PER_SEASON);
      const ceiling = p.targetRating ?? p.potential ?? p.prime_rating;
      const nextRating = ageStep(
        p.prime_rating,
        p.age,
        ceiling,
        tier,
        `${key}-s${career.currentSeason}`,
      );
      growth[key] = { prime_rating: nextRating, age: p.age + 1 };
    }
    if (Object.keys(growth).length > 0) career.applySquadAgeing(growth);
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
  void liveForm;

  // Board verdict (commentary engine). Unbeaten = a season with no losses.
  // Forecast = where this squad "should" finish purely on rating: 1 + the
  // number of opponents rated above us. Beating it delights the board;
  // falling short disappoints them.
  const unbeaten = matches.length > 0 && matches.every((m) => m.outcome !== "L");
  const expectedPosition = 1 + opponents.filter((o) => o.strength > userRating).length;
  const beatForecast =
    ourPosition < expectedPosition ? true : ourPosition > expectedPosition ? false : null;
  const verdict = boardNote({
    position: ourPosition,
    totalTeams: opponents.length + 1,
    unbeaten,
    beatForecast,
    relegated: isRelegated,
    champion: isChampion,
  });

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
      <div className="text-sm text-foreground/85 italic mb-3 max-w-sm mx-auto">{verdict}</div>
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

function SquadForm({
  squad,
  form,
  morale,
}: {
  squad: Player[];
  form: Record<string, number>;
  morale: Record<string, number>;
}) {
  // 🔥 hot streak: form >= +1.5 · ❄️ cold streak: form <= -1.5
  // Threshold chosen empirically — picks up ~top 2-3 / bottom 2-3 over a season.
  const HOT = 1.5;
  const COLD = -1.5;
  const enriched = squad.map((p) => ({
    player: p,
    formVal: form[`${p.club}:${normalizeName(p.name)}`] ?? 0,
    moraleVal: morale[`${p.club}:${p.name}`] ?? MORALE_NEUTRAL,
  }));
  // Unsettled = the man-management signal: who's unhappy enough to need
  // minutes or a kind word. Surfaced so benching has a visible cost.
  const unsettled = enriched
    .filter((e) => e.moraleVal < 42)
    .sort((a, b) => a.moraleVal - b.moraleVal)
    .slice(0, 5);
  const fire = enriched.filter((e) => e.formVal >= HOT).sort((a, b) => b.formVal - a.formVal);
  const ice = enriched.filter((e) => e.formVal <= COLD).sort((a, b) => a.formVal - b.formVal);
  if (fire.length === 0 && ice.length === 0 && unsettled.length === 0) return null;
  return (
    <>
    {unsettled.length > 0 && (
      <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="text-[10px] uppercase tracking-widest text-primary mb-2">
          🛋️ Unsettled · wanting minutes
        </div>
        <div className="flex flex-wrap gap-2">
          {unsettled.map((e) => {
            const b = moraleBadge(e.moraleVal);
            return (
              <span
                key={`mor-${e.player.club}-${e.player.name}`}
                className="inline-flex items-center gap-1 text-xs rounded-full border border-primary/30 px-2 py-0.5"
                title={`Morale ${Math.round(e.moraleVal)} · ${b.label}`}
              >
                <span>{b.icon}</span>
                <span className="text-muted-foreground text-[10px]">
                  {simplifyPosition(e.player.position)}
                </span>
                <span className="truncate max-w-[8rem]">{e.player.name}</span>
              </span>
            );
          })}
        </div>
      </div>
    )}
    <div className="mt-3 grid sm:grid-cols-2 gap-3">
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
    </>
  );
}

/**
 * Mid-season window — appears exactly once per season after MD11.
 *
 * BLIND SWAP (game-design item #5): the order is reversed from a normal
 * transfer. You pick WHO LEAVES first — committing to a hole — and only
 * THEN does the wheel reveal who arrives. You don't get to choose the
 * incoming player; the wheel decides. It's a gamble: the replacement is
 * drawn from a band around the departing player's rating (±10), so it
 * could be an upgrade or a downgrade. High risk, high drama — on-brand
 * for a wheel game. Decline before you commit and your squad is safe.
 *
 * Flow: prompt → picking-out (commit the hole) → spinning → reveal
 * (forced incoming, already applied) → done.
 */
function MidSeasonSwapCard() {
  const career = useCareer();
  const allPlayers = useMemo(
    () => getCareerPlayers(career.foundingClubId, career.careerMode),
    [career.foundingClubId, career.careerMode],
  );

  const [stage, setStage] = useState<"prompt" | "picking-out" | "spinning" | "reveal">("prompt");
  const [outgoing, setOutgoing] = useState<{ player: Player; index: number } | null>(null);
  const [incoming, setIncoming] = useState<Player | null>(null);

  const drafted = useMemo(() => {
    const set = new Set<string>();
    career.squad.forEach((p) => set.add(`${p.club}:${p.name}`));
    career.rivals.forEach((r) => r.squad.forEach((p) => set.add(`${p.club}:${p.name}`)));
    return set;
  }, [career.squad, career.rivals]);

  function skip() {
    career.setMidSeasonSwapUsed(true);
  }

  // User commits to a hole. Wheel then draws the replacement.
  function pickOutgoing(player: Player, index: number) {
    setOutgoing({ player, index });
    setStage("spinning");
    setTimeout(() => {
      // Eligible incoming: free players who fit the vacated slot, within
      // ±10 rating of the departing player (a genuine gamble, not a trap
      // and not a guaranteed jackpot). Falls back to any compatible free
      // player if the band is empty.
      const band = allPlayers.filter(
        (p) =>
          !drafted.has(`${p.club}:${p.name}`) &&
          playerFitsSlot(player.position, p) &&
          Math.abs(p.prime_rating - player.prime_rating) <= 10,
      );
      const fallback = allPlayers.filter(
        (p) => !drafted.has(`${p.club}:${p.name}`) && playerFitsSlot(player.position, p),
      );
      const pool = band.length > 0 ? band : fallback;
      if (pool.length === 0) {
        // Nothing to bring in — the gamble fizzles, squad unchanged.
        career.setMidSeasonSwapUsed(true);
        return;
      }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      // Apply immediately — it's a blind, committed gamble.
      career.swapSquadPlayer(index, pick);
      setIncoming(pick);
      setStage("reveal");
    }, 1400);
  }

  // Stage 1: offer card
  if (stage === "prompt") {
    return (
      <div className="mt-6 rounded-2xl border-2 border-warning bg-warning/10 p-5 text-center">
        <div className="text-3xl mb-1">🎲</div>
        <div className="font-display text-xl text-warning mb-1">Mid-Season Gamble</div>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
          One blind swap. You choose who <span className="text-warning">leaves</span> — then the
          wheel decides who arrives. Could be an upgrade. Could be a downgrade. No peeking, no
          backing out once you commit. Or keep your squad and play it safe.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            onClick={() => setStage("picking-out")}
            className="px-5 py-2.5 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
          >
            🎲 Take the gamble
          </button>
          <button
            onClick={skip}
            className="px-5 py-2.5 rounded-md border border-muted-foreground/40 text-muted-foreground text-sm hover:bg-muted/30 transition"
          >
            Keep my squad
          </button>
        </div>
      </div>
    );
  }

  // Stage 2: pick who leaves (franchise excluded). This is the commitment.
  if (stage === "picking-out") {
    return (
      <div className="mt-6 rounded-2xl border-2 border-warning bg-warning/10 p-5">
        <div className="text-center mb-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Who do you sacrifice?
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Pick a player to release. The wheel brings in a replacement at the same position — you
            won't see who until it's done. ⭐ Franchise can't leave.
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
                onClick={() => pickOutgoing(p, i)}
                title={isFranchise ? "Franchise player — untouchable" : undefined}
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
        <button
          onClick={() => setStage("prompt")}
          className="mt-3 w-full text-[11px] text-muted-foreground hover:text-warning underline"
        >
          ← back
        </button>
      </div>
    );
  }

  // Stage 3: spinning (the gamble resolves)
  if (stage === "spinning") {
    return (
      <div className="mt-6 rounded-2xl border-2 border-warning bg-warning/10 p-8 text-center">
        <div className="text-5xl animate-spin inline-block">🎲</div>
        <div className="mt-3 text-sm text-muted-foreground">
          {outgoing ? `${outgoing.player.name} packs their bags…` : "Spinning…"}
        </div>
      </div>
    );
  }

  // Stage 4: reveal — the swap is already applied; show the outcome.
  if (stage === "reveal" && incoming && outgoing) {
    const delta = incoming.prime_rating - outgoing.player.prime_rating;
    const verdict =
      delta > 2
        ? { label: "📈 Upgrade!", tone: "text-success" }
        : delta < -2
          ? { label: "📉 Downgrade", tone: "text-primary" }
          : { label: "↔️ Sidegrade", tone: "text-warning" };
    return (
      <div className="mt-6 rounded-2xl border-2 border-warning bg-warning/10 p-6 text-center">
        <div className={`font-display text-lg mb-3 ${verdict.tone}`}>{verdict.label}</div>
        <div className="flex items-center justify-center gap-4">
          <div className="text-center opacity-60">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Out</div>
            <div className="text-sm line-through">{outgoing.player.name}</div>
            <div className="font-display text-xl text-muted-foreground">
              {outgoing.player.prime_rating}
            </div>
          </div>
          <div className="text-2xl">→</div>
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-warning">In</div>
            <div className="font-display text-base text-warning">{incoming.name}</div>
            <div className="font-display text-2xl text-warning">{incoming.prime_rating}</div>
            <div className="text-[10px] text-muted-foreground">{incoming.position}</div>
          </div>
        </div>
        <button
          onClick={() => career.setMidSeasonSwapUsed(true)}
          className="mt-5 px-6 py-2.5 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
        >
          {delta >= 0 ? "Get back to it →" : "Live with it →"}
        </button>
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
