/**
 * /career/cup — top-8 knockout competition.
 *
 * Triggered from /career/season's end-card if the user finished ≤8th
 * (cup qualifier). Uses career-core's tested cupBracketSeeded to draw
 * the QF bracket: 1v8, 2v7, 3v6, 4v5 — finishing higher earns an easier
 * route to the final.
 *
 * Each tie is a single match (simplified from the GOLAZO two-legged
 * format — keeps the pacing snappy for a hobby game). Goal/assist
 * picking reuses pickScorer/pickAssister from career-core for parity
 * with the league season screen.
 *
 * On final result, writes the cup outcome into the active season's
 * record (via the postseason → /career/postseason chain).
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useCareer } from "@/lib/career-store";
import { getCareerClubs } from "@/lib/data";
import { cupBracketSeeded, pickScorer, pickAssister, type StandingsTable } from "@/lib/career-core";
import type { Player } from "@/lib/game-types";

export const Route = createFileRoute("/career/cup")({
  head: () => ({ meta: [{ title: "Cup · GOLAZO" }] }),
  component: CareerCup,
});

interface CupMatch {
  round: "QF" | "SF" | "F";
  homeId: string;
  awayId: string;
  ourScore: number;
  theirScore: number;
  winnerId: string;
  scorers: { name: string; assister?: string }[];
  isUserMatch: boolean;
}

interface CupState {
  bracket: { home: string; away: string }[];
  matches: CupMatch[];
  userOut: boolean;
  /** What round the user is currently in (or last reached). */
  userReached: "qf" | "sf" | "final" | "champion" | "eliminated";
}

function CareerCup() {
  const career = useCareer();
  const navigate = useNavigate();
  const clubs = useMemo(() => getCareerClubs(career.foundingClubId, career.careerMode), [career.foundingClubId, career.careerMode]);

  // The user's average squad rating drives match outcomes
  const userRating = useMemo(() => {
    if (career.squad.length === 0) return 75;
    const sum = career.squad.reduce((acc, p) => acc + p.prime_rating, 0);
    return Math.round(sum / career.squad.length);
  }, [career.squad]);

  // Build the cup bracket — TRUST the league's `finalPosition` from
  // seasonHistory (computed by computeLeagueTable in /career/season).
  //
  // BUG FIXED: previously the cup re-built its own standings table where
  // user.pts came from match outcomes but rivals.pts came from a strength
  // heuristic WITHOUT jitter — different from the heuristic-WITH-jitter
  // that decided the league table. A user finishing 2nd in the league
  // could end up 9th in the cup's re-derived standings and get bounced
  // out. Now we honor the league position the user actually saw.
  const standings = useMemo<StandingsTable>(() => {
    const latest = career.seasonHistory[career.seasonHistory.length - 1];
    const finalPos = latest?.finalPosition ?? null;
    const userQualifies = finalPos !== null && finalPos <= 8;

    // Order rivals by their synthetic strength (descending) — used to
    // place them around the user in seeding order.
    const rivalsRanked = career.rivals
      .map((r) => {
        const rating =
          r.squad.length > 0
            ? r.squad.reduce((a, p) => a + p.prime_rating, 0) / r.squad.length
            : 75;
        return { id: r.id, rating };
      })
      .sort((a, b) => b.rating - a.rating);

    // Build the ordered list of 12 league positions. User at finalPos - 1,
    // rivals fill the rest in strength order.
    const orderedIds: string[] = [];
    let rivalIdx = 0;
    for (let pos = 1; pos <= 12; pos++) {
      if (pos === finalPos) {
        orderedIds.push("user");
      } else if (rivalIdx < rivalsRanked.length) {
        orderedIds.push(rivalsRanked[rivalIdx].id);
        rivalIdx++;
      }
    }
    // Assign synthetic Pts in descending order so cupBracketSeeded's sort
    // honors the ordered list. (12 → 36 pts spread; user keeps their real
    // W/D/L/GF/GA for the recap chips.)
    const table: StandingsTable = {};
    orderedIds.forEach((id, idx) => {
      const pts = 50 - idx * 3; // monotonically decreasing
      if (id === "user" && latest) {
        table["user"] = {
          Pts: pts,
          GF: latest.goalsFor,
          GA: latest.goalsAgainst,
          W: latest.wins,
          D: latest.draws,
          L: latest.losses,
          P: 22,
        };
      } else {
        table[id] = {
          Pts: pts,
          GF: Math.round(pts * 1.3),
          GA: Math.round(pts * 0.9),
          P: 22,
        };
      }
    });
    void userQualifies; // (just here for the diff to read clearly)
    return table;
  }, [career.seasonHistory, career.rivals]);

  const [state, setState] = useState<CupState | null>(null);
  const [shown, setShown] = useState(0);

  // Initialize bracket once
  useEffect(() => {
    if (state) return;
    if (career.squad.length === 0 || career.rivals.length === 0) return;
    const result = cupBracketSeeded(standings, "user");
    setState({
      bracket: result.qf,
      matches: [],
      userOut: result.userOut,
      userReached: result.userOut ? "eliminated" : "qf",
    });
  }, [state, standings, career.squad, career.rivals]);

  // Render guard AFTER all hooks
  if (career.squad.length === 0 || career.rivals.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        No active career — head back to{" "}
        <Link to="/career" className="underline ml-1">
          /career
        </Link>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Drawing the bracket…
      </div>
    );
  }

  function nameOf(id: string): string {
    if (id === "user") return "Your XI";
    const rival = career.rivals.find((r) => r.id === id);
    if (!rival) return id;
    const club = clubs.find((c) => c.id === rival.foundingClubId);
    return club?.name ?? rival.archetypeName;
  }

  function squadRatingOf(id: string): number {
    if (id === "user") return userRating;
    const rival = career.rivals.find((r) => r.id === id);
    if (!rival || rival.squad.length === 0) return 75;
    return rival.squad.reduce((a, p) => a + p.prime_rating, 0) / rival.squad.length;
  }

  // Simulate one cup match — used for both user matches and AI vs AI
  function simulateMatch(homeId: string, awayId: string, round: "QF" | "SF" | "F"): CupMatch {
    const seed = hashCode(
      `${career.startedAt}-${career.currentSeason}-${round}-${homeId}-${awayId}`,
    );
    const rand = mulberry32(seed);
    const homeRating = squadRatingOf(homeId);
    const awayRating = squadRatingOf(awayId);
    const homeBoost = 3;
    const homeDiff = homeRating + homeBoost - awayRating;
    const homeXG = Math.max(0.2, 1.2 + homeDiff * 0.08 + (rand() - 0.5) * 0.9);
    const awayXG = Math.max(0.1, 1.1 - homeDiff * 0.06 + (rand() - 0.5) * 0.9);
    let homeScore = poisson(homeXG, rand);
    let awayScore = poisson(awayXG, rand);

    // Cup matches can't draw — penalty shootout decides
    if (homeScore === awayScore) {
      const edge = 0.5 + Math.max(-0.2, Math.min(0.2, homeDiff * 0.01));
      if (rand() < edge) homeScore++;
      else awayScore++;
    }

    const isUser = homeId === "user" || awayId === "user";
    const userIsHome = homeId === "user";
    const ourScore = isUser ? (userIsHome ? homeScore : awayScore) : homeScore;
    const theirScore = isUser ? (userIsHome ? awayScore : homeScore) : awayScore;

    // Pick scorers for user matches only (no point picking AI scorers we
    // don't have squad data for at the AI's other-club assignments)
    const scorers: { name: string; assister?: string }[] = [];
    if (isUser) {
      for (let g = 0; g < ourScore; g++) {
        const s = pickScorer(career.squad, null, rand);
        if (!s) continue;
        const a = pickAssister(career.squad, s, rand);
        scorers.push({ name: s.name, assister: a?.name });
      }
    }

    const winnerId = homeScore > awayScore ? homeId : awayId;
    return {
      round,
      homeId,
      awayId,
      ourScore,
      theirScore,
      winnerId,
      scorers,
      isUserMatch: isUser,
    };
  }

  function playRoundOfMatches() {
    if (!state) return;
    if (state.userOut) {
      navigate({ to: "/career/recap" });
      return;
    }

    setState((prev) => {
      if (!prev) return prev;
      // Determine which round we're playing next
      const playedQF = prev.matches.filter((m) => m.round === "QF").length;
      const playedSF = prev.matches.filter((m) => m.round === "SF").length;
      const playedF = prev.matches.filter((m) => m.round === "F").length;

      const newMatches: CupMatch[] = [...prev.matches];
      let newReached = prev.userReached;

      if (playedQF < 4) {
        // Play all 4 QF ties
        const qfMatches = prev.bracket.map((b) => simulateMatch(b.home, b.away, "QF"));
        newMatches.push(...qfMatches);
        const userQF = qfMatches.find((m) => m.isUserMatch);
        if (userQF && userQF.winnerId === "user") newReached = "sf";
        else if (userQF) newReached = "eliminated";
      } else if (playedSF < 2) {
        // Pair QF winners 1v2 and 3v4
        const qfWinners = newMatches.filter((m) => m.round === "QF").map((m) => m.winnerId);
        const sfMatches: CupMatch[] = [
          simulateMatch(qfWinners[0], qfWinners[3], "SF"),
          simulateMatch(qfWinners[1], qfWinners[2], "SF"),
        ];
        newMatches.push(...sfMatches);
        const userSF = sfMatches.find((m) => m.isUserMatch);
        if (userSF && userSF.winnerId === "user") newReached = "final";
        else if (userSF) newReached = "eliminated";
      } else if (playedF < 1) {
        const sfWinners = newMatches.filter((m) => m.round === "SF").map((m) => m.winnerId);
        const finalMatch = simulateMatch(sfWinners[0], sfWinners[1], "F");
        newMatches.push(finalMatch);
        if (finalMatch.isUserMatch) {
          if (finalMatch.winnerId === "user") newReached = "champion";
          else newReached = "eliminated";
        }
      }

      return { ...prev, matches: newMatches, userReached: newReached };
    });
    setShown((prev) => prev + 1);
  }

  const cupDone =
    state.userOut || state.userReached === "eliminated" || state.userReached === "champion";

  return (
    <div className="min-h-screen px-4 py-8 max-w-3xl mx-auto">
      <header className="flex items-center justify-between gap-3">
        <Link
          to="/career"
          className="text-[11px] text-muted-foreground hover:text-warning underline"
        >
          ← GOLAZO hub
        </Link>
        <div className="text-right">
          <div className="font-display text-2xl text-warning">
            Cup · Season {career.currentSeason}
          </div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            Top-8 knockout
          </div>
        </div>
      </header>

      {state.userOut ? (
        <NotQualifiedCard />
      ) : (
        <>
          <BracketView state={state} nameOf={nameOf} />
          {!cupDone && (
            <button
              onClick={playRoundOfMatches}
              className="mt-6 w-full px-4 py-3 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
            >
              {state.matches.filter((m) => m.round === "QF").length === 0
                ? "Play Quarter-Finals →"
                : state.matches.filter((m) => m.round === "SF").length === 0
                  ? "Play Semi-Finals →"
                  : "Play Final →"}
            </button>
          )}
          {cupDone && (
            <CupOutcome
              outcome={state.userReached as "champion" | "eliminated"}
              matches={state.matches}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

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

function poisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0,
    p = 1;
  while (p > L) {
    k++;
    p *= rand();
  }
  return k - 1;
}

function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

// ─── sub-components ──────────────────────────────────────────────────

function NotQualifiedCard() {
  return (
    <div className="mt-8 rounded-2xl border border-border bg-card/40 p-6 text-center">
      <div className="text-3xl mb-2">🤝</div>
      <div className="font-display text-xl mb-2">Did not qualify</div>
      <p className="text-sm text-muted-foreground mb-5">
        Top 8 finishers qualify for the cup. You'll need a higher league finish next season to
        compete.
      </p>
      <Link
        to="/career/recap"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning text-warning-foreground font-display text-base tracking-wide hover:brightness-110 transition"
      >
        Season recap →
      </Link>
    </div>
  );
}

function BracketView({ state, nameOf }: { state: CupState; nameOf: (id: string) => string }) {
  return (
    <div className="mt-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <BracketColumn
          title="Quarter-finals"
          matches={state.bracket.map((b, i) => {
            const played = state.matches.find(
              (m) => m.round === "QF" && m.homeId === b.home && m.awayId === b.away,
            );
            return { home: b.home, away: b.away, match: played };
          })}
          nameOf={nameOf}
        />
        <BracketColumn
          title="Semi-finals"
          matches={state.matches
            .filter((m) => m.round === "SF")
            .map((m) => ({
              home: m.homeId,
              away: m.awayId,
              match: m,
            }))}
          nameOf={nameOf}
        />
        <BracketColumn
          title="Final"
          matches={state.matches
            .filter((m) => m.round === "F")
            .map((m) => ({
              home: m.homeId,
              away: m.awayId,
              match: m,
            }))}
          nameOf={nameOf}
        />
      </div>
    </div>
  );
}

function BracketColumn({
  title,
  matches,
  nameOf,
}: {
  title: string;
  matches: Array<{ home: string; away: string; match?: CupMatch }>;
  nameOf: (id: string) => string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
        {title}
      </div>
      <div className="space-y-2">
        {matches.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-3 text-center text-muted-foreground/60 text-xs">
            TBD
          </div>
        ) : (
          matches.map((m, i) => {
            const isUserHome = m.home === "user";
            const isUserAway = m.away === "user";
            const isUserMatch = isUserHome || isUserAway;
            const winnerId = m.match?.winnerId;
            return (
              <div
                key={i}
                className={`rounded-lg border p-2.5 ${isUserMatch ? "border-warning bg-warning/10" : "border-border bg-card/40"}`}
              >
                <Row
                  name={nameOf(m.home)}
                  score={
                    m.match?.ourScore !== undefined && isUserHome
                      ? m.match.ourScore
                      : m.match?.theirScore !== undefined && isUserAway
                        ? m.match.theirScore
                        : m.match
                          ? m.match.ourScore
                          : undefined
                  }
                  won={winnerId === m.home}
                  isUser={isUserHome}
                />
                <Row
                  name={nameOf(m.away)}
                  score={
                    m.match?.theirScore !== undefined && isUserHome
                      ? m.match.theirScore
                      : m.match?.ourScore !== undefined && isUserAway
                        ? m.match.ourScore
                        : m.match
                          ? m.match.theirScore
                          : undefined
                  }
                  won={winnerId === m.away}
                  isUser={isUserAway}
                />
                {m.match?.scorers && m.match.scorers.length > 0 && (
                  <div className="text-[10px] text-muted-foreground truncate mt-1 pt-1 border-t border-border">
                    ⚽{" "}
                    {m.match.scorers
                      .map((s) => (s.assister ? `${s.name} (${s.assister})` : s.name))
                      .join(" · ")}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Row({
  name,
  score,
  won,
  isUser,
}: {
  name: string;
  score: number | undefined;
  won: boolean;
  isUser: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between text-sm ${won ? "font-display" : "text-muted-foreground"} ${isUser ? "text-warning" : ""}`}
    >
      <span className="truncate">{name}</span>
      <span className="ml-2 tabular-nums">{score === undefined ? "—" : score}</span>
    </div>
  );
}

function CupOutcome({
  outcome,
  matches,
}: {
  outcome: "champion" | "eliminated";
  matches: CupMatch[];
}) {
  const career = useCareer();
  const lastMatch = matches[matches.length - 1];

  // Persist the cup result onto the active season's record once on mount
  useEffect(() => {
    if (career.seasonHistory.length === 0) return;
    const last = career.seasonHistory[career.seasonHistory.length - 1];
    if (last.season !== career.currentSeason) return; // already a different season; bail
    const cupResult =
      outcome === "champion"
        ? "champion"
        : lastMatch?.round === "F"
          ? "runner-up"
          : lastMatch?.round === "SF"
            ? "semi-final"
            : "quarter-final";
    if (last.cupResult === cupResult) return; // already recorded
    const trophies = outcome === "champion" ? [...last.trophies, "Cup Winner"] : last.trophies;
    // Update the last record in place
    useCareer.setState({
      seasonHistory: [...career.seasonHistory.slice(0, -1), { ...last, cupResult, trophies }],
      trophies: career.trophies + (outcome === "champion" ? 1 : 0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-8 rounded-2xl border-2 border-warning bg-warning/10 p-6 text-center">
      <div className="text-4xl mb-2">
        {outcome === "champion"
          ? "🏆"
          : lastMatch?.round === "F"
            ? "🥈"
            : lastMatch?.round === "SF"
              ? "🥉"
              : "👋"}
      </div>
      <div className="font-display text-2xl text-warning mb-2">
        {outcome === "champion"
          ? "Cup Champions!"
          : lastMatch?.round === "F"
            ? "Runner-up · lost the Final"
            : lastMatch?.round === "SF"
              ? "Semi-final exit"
              : "Quarter-final exit"}
      </div>
      <div className="text-xs text-muted-foreground mb-5">
        {outcome === "champion"
          ? "🏆 Trophy added to your career. Onwards to the transfer window."
          : "Tough luck. Time to retool the squad for next season."}
      </div>
      <Link
        to="/career/recap"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning text-warning-foreground font-display text-base tracking-wide hover:brightness-110 transition"
      >
        Season recap →
      </Link>
    </div>
  );
}
