/**
 * /career/europe — continental knockout (Real mode).
 *
 * You're enrolled in the competition you earned LAST season (seasonEuropeEntry):
 * top 4 → Champions League, 5–6 → Europa, 7 → Conference — so a strong finish
 * pays off the following year, and season 1 has none. The field is the
 * strongest clubs across every league. The UCL plays its 36-club league phase
 * (8 matchdays, one at a time) then a knockout; Europa/Conference are straight
 * knockouts. Prize money banks into the club balance; winning adds a trophy.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useCareer } from "@/lib/career-store";
import { resolveXI, playerKey } from "@/lib/matchday-xi";
import { pickScorer } from "@/lib/career-core";
import { buildLiveEvents } from "@/lib/matchlive";
import { LiveMatchModal } from "@/components/LiveMatchModal";
import { rivalryFor } from "@/lib/rivalries";
import {
  seasonEuropeEntry,
  europeField,
  euroRounds,
  europePrize,
  EURO_META,
  ROUND_LABEL,
  leaguePhaseStandings,
  uclCut,
  LEAGUE_PHASE_GAMES,
  LEAGUE_PHASE_KNOCKOUT_FIELD,
  type EuroComp,
  type EuroRound,
  type PhaseRow,
  type UclCut,
} from "@/lib/europe";

export const Route = createFileRoute("/career/europe")({
  head: () => ({ meta: [{ title: "Europe · GOLAZO" }] }),
  component: CareerEurope,
});

interface EuroMatch {
  round: EuroRound;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  winnerId: string;
  isUser: boolean;
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

/** Seed an even-length bracket so adjacent pairs are strongest-v-weakest. */
function seedOrder(ids: string[]): string[] {
  const out: string[] = [];
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    out.push(ids[lo++]);
    if (lo <= hi) out.push(ids[hi--]);
  }
  return out;
}

function CareerEurope() {
  const career = useCareer();
  const navigate = useNavigate();

  // You play the competition you EARNED LAST SEASON (real qualification
  // timing), not the one this season's finish just won — that pays off next
  // season. seasonEuropeEntry encodes the one-year delay + holder-defends.
  const comp: EuroComp | null = seasonEuropeEntry(career.seasonHistory, career.currentSeason);
  // Your SET XI drives European strength too — bench your stars and you'll
  // feel it on the continent, just like in the league.
  const xiPlayers = useMemo(() => {
    const keys = new Set(resolveXI(career.squad, career.startingXI, career.formation));
    const xi = career.squad.filter((p) => keys.has(playerKey(p)));
    return xi.length ? xi : career.squad;
  }, [career.squad, career.startingXI, career.formation]);
  const userRating = useMemo(
    () =>
      xiPlayers.length === 0
        ? 75
        : Math.round(xiPlayers.reduce((a, p) => a + p.prime_rating, 0) / xiPlayers.length),
    [xiPlayers],
  );

  // Live-commentary ticker for the user's European matches — same feel as a
  // league night (built differently was the complaint).
  const [liveMatch, setLiveMatch] = useState<{
    events: import("@/lib/matchlive").LiveEvent[];
    label: string;
    oppName: string;
    ourScore: number;
    theirScore: number;
  } | null>(null);

  /** Open the live ticker for one of the user's European matches. */
  function showUserMatch(label: string, oppName: string, us: number, them: number, seedStr: string) {
    const rand = mulberry32(hashCode(seedStr));
    const scorers: string[] = [];
    for (let i = 0; i < us; i++) {
      const s = pickScorer(xiPlayers, {}, rand);
      if (s) scorers.push(s.name);
    }
    const xiKeys = xiPlayers.map(playerKey);
    setLiveMatch({
      events: buildLiveEvents({
        match: { matchday: 1, ourScore: us, theirScore: them },
        oppName,
        ourScorers: scorers,
        xiKeys,
        keyToName: (k) => xiPlayers.find((p) => playerKey(p) === k)?.name ?? k.split(":")[1] ?? k,
        seasonSeed: hashCode(seedStr),
      }),
      label,
      oppName,
      ourScore: us,
      theirScore: them,
    });
  }

  const field = useMemo(
    () => (comp ? europeField(comp, career.foundingClubId ?? "") : []),
    [comp, career.foundingClubId],
  );
  const rounds = comp ? euroRounds(EURO_META[comp].field) : [];
  const strengthOf = (id: string) =>
    id === career.foundingClubId ? userRating : (field.find((c) => c.id === id)?.strength ?? 75);
  const nameOf = (id: string) =>
    id === career.foundingClubId ? "Your XI" : (field.find((c) => c.id === id)?.name ?? id);

  const isUcl = comp === "ucl";
  // alive = clubs still in, in bracket order; matches = all played.
  const [alive, setAlive] = useState<string[]>([]);
  const [matches, setMatches] = useState<EuroMatch[]>([]);
  const [roundIdx, setRoundIdx] = useState(0);
  // UCL only: the 8-game league phase before the knockout, now played one
  // matchday at a time so you actually watch the campaign unfold.
  const [phase, setPhase] = useState<"league" | "knockout">(isUcl ? "league" : "knockout");
  const [lpGames, setLpGames] = useState<{ oppId: string; us: number; them: number }[]>([]);

  // Your 8 league-phase opponents — a deterministic strength-spread spaced
  // across the field (so you face a mix, not just the top seeds).
  const lpOpps = useMemo(() => {
    if (!isUcl || field.length === 0) return [];
    const uid = career.foundingClubId ?? "";
    const others = field.filter((c) => c.id !== uid).sort((a, b) => b.strength - a.strength);
    const step = Math.max(1, Math.floor(others.length / LEAGUE_PHASE_GAMES));
    return Array.from({ length: LEAGUE_PHASE_GAMES }, (_, i) =>
      others[Math.min(i * step, others.length - 1)],
    );
  }, [isUcl, field, career.foundingClubId]);

  useEffect(() => {
    // EL/ECL seed the knockout straight from the field. UCL waits for the
    // league phase to decide the 16 R16 clubs.
    if (alive.length || !comp || field.length === 0 || isUcl) return;
    const seeded = [...field].sort((a, b) => b.strength - a.strength).map((c) => c.id);
    setAlive(seedOrder(seeded));
  }, [alive.length, comp, field, isUcl]);

  if (!comp) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 text-muted-foreground gap-3">
        <div className="text-3xl">😕</div>
        <div>
          No European football this season.
          <br />
          <span className="text-xs">
            Finish top 7 to qualify for next season's competition.
          </span>
        </div>
        <Link to="/career/postseason" className="underline text-warning">
          To the transfer market →
        </Link>
      </div>
    );
  }
  const meta = EURO_META[comp];

  const userAlive = alive.includes(career.foundingClubId ?? "");
  const roundsPlayed = roundIdx;
  const done = roundsPlayed >= rounds.length || (!userAlive && matches.length > 0);
  const userChampion = roundsPlayed >= rounds.length && userAlive;

  function simMatch(homeId: string, awayId: string, round: EuroRound): EuroMatch {
    const rand = mulberry32(
      hashCode(`${career.startedAt}-${career.currentSeason}-eu-${round}-${homeId}-${awayId}`),
    );
    // A continental rivalry (e.g. drawing Real Madrid in the UCL) plays wild:
    // dampened gap, more variance.
    const derby = !!rivalryFor(homeId, awayId);
    const diff = (strengthOf(homeId) + 3 - strengthOf(awayId)) * (derby ? 0.55 : 1);
    const v = derby ? 1.25 : 0.9;
    let hs = poisson(Math.max(0.2, 1.2 + diff * 0.08 + (rand() - 0.5) * v), rand);
    let as = poisson(Math.max(0.1, 1.1 - diff * 0.06 + (rand() - 0.5) * v), rand);
    if (hs === as) {
      if (rand() < 0.5 + Math.max(-0.2, Math.min(0.2, diff * 0.01))) hs++;
      else as++;
    }
    return {
      round,
      homeId,
      awayId,
      homeScore: hs,
      awayScore: as,
      winnerId: hs > as ? homeId : awayId,
      isUser: homeId === career.foundingClubId || awayId === career.foundingClubId,
    };
  }

  /** Play the NEXT league-phase matchday (one of the 8). Deterministic by
   *  opponent, so a replay produces the identical campaign. */
  function playNextLeagueGame() {
    const opp = lpOpps[lpGames.length];
    if (!opp) return;
    const rand = mulberry32(hashCode(`${career.startedAt}-${career.currentSeason}-lp-${opp.id}`));
    const diff = userRating - opp.strength;
    const us = poisson(Math.max(0.2, 1.25 + diff * 0.08 + (rand() - 0.5) * 0.9), rand);
    const them = poisson(Math.max(0.1, 1.2 - diff * 0.06 + (rand() - 0.5) * 0.9), rand);
    setLpGames((g) => [...g, { oppId: opp.id, us, them }]);
    showUserMatch(
      `Champions League · league phase ${lpGames.length + 1}/${LEAGUE_PHASE_GAMES}`,
      nameOf(opp.id),
      us,
      them,
      `${career.startedAt}-${career.currentSeason}-lp-${opp.id}`,
    );
  }

  // Once all 8 are played, finalise the 36-club table + where you land.
  // Top 8 → R16 directly; 9–24 → a one-off playoff; 25+ → out.
  const lp = useMemo(() => {
    if (!isUcl || lpGames.length < LEAGUE_PHASE_GAMES) return null;
    const uid = career.foundingClubId ?? "";
    let pts = 0;
    let gd = 0;
    for (const g of lpGames) {
      pts += g.us > g.them ? 3 : g.us === g.them ? 1 : 0;
      gd += g.us - g.them;
    }
    const seed = hashCode(`${career.startedAt}-${career.currentSeason}-lp`);
    const standings = leaguePhaseStandings(field, uid, pts, gd, seed);
    const userPos = standings.find((r) => r.id === uid)?.pos ?? 36;
    const cut = uclCut(userPos);
    const r16Ids = standings.slice(0, LEAGUE_PHASE_KNOCKOUT_FIELD).map((r) => r.id);
    let advanced = cut !== "out" && userPos <= 16;
    let playoff: { oppId: string; us: number; them: number; won: boolean } | undefined;
    if (cut === "playoff" && userPos > 16) {
      const oppId = standings[16]?.id ?? lpOpps[0]?.id ?? uid; // the seed you'd displace
      const rand = mulberry32(hashCode(`${career.startedAt}-${career.currentSeason}-lp-po`));
      const d = userRating - strengthOf(oppId);
      let us = poisson(Math.max(0.2, 1.2 + d * 0.08 + (rand() - 0.5) * 0.9), rand);
      let them = poisson(Math.max(0.1, 1.1 - d * 0.06 + (rand() - 0.5) * 0.9), rand);
      if (us === them) rand() < 0.5 + d * 0.01 ? us++ : them++;
      const won = us > them;
      playoff = { oppId, us, them, won };
      advanced = won;
      if (won) r16Ids[r16Ids.length - 1] = uid; // take the last R16 seat
    }
    return { standings, userPos, cut, played: lpGames, advanced, playoff, r16Ids };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUcl, lpGames, field, career.foundingClubId, career.startedAt, career.currentSeason, userRating]);

  function playRound() {
    if (done) {
      navigate({ to: "/career/postseason" });
      return;
    }
    const round = rounds[roundIdx];
    const ties: EuroMatch[] = [];
    for (let i = 0; i < alive.length; i += 2) {
      ties.push(simMatch(alive[i], alive[i + 1], round));
    }
    setMatches((m) => [...m, ...ties]);
    setAlive(ties.map((t) => t.winnerId));
    setRoundIdx((r) => r + 1);
    // Play the user's tie through the live ticker (the other ties just show
    // as results below). Our goals = our side of the scoreline.
    const uid = career.foundingClubId ?? "";
    const mine = ties.find((t) => t.isUser);
    if (mine) {
      const us = mine.homeId === uid ? mine.homeScore : mine.awayScore;
      const them = mine.homeId === uid ? mine.awayScore : mine.homeScore;
      const oppId = mine.homeId === uid ? mine.awayId : mine.homeId;
      showUserMatch(
        `${EURO_META[comp!].name} · ${ROUND_LABEL[round]}`,
        nameOf(oppId),
        us,
        them,
        `${career.startedAt}-${career.currentSeason}-eu-${round}-${oppId}`,
      );
    }
  }

  const currentRoundMatches = matches.filter((m) => m.round === rounds[Math.min(roundIdx, rounds.length) - 1]);

  return (
    <div className="min-h-screen px-4 py-8 max-w-2xl mx-auto">
      <header className="flex items-center justify-between gap-3">
        <Link to="/career" className="text-[11px] text-muted-foreground hover:text-warning underline">
          ← GOLAZO hub
        </Link>
        <div className="text-right">
          <div className="font-display text-2xl text-warning">
            {meta.icon} {meta.name}
          </div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            Season {career.currentSeason} ·{" "}
            {isUcl ? "36-club league phase" : `${meta.field}-club knockout`}
          </div>
        </div>
      </header>

      {phase === "league" && (
        <LeaguePhase
          lp={lp}
          games={lpGames}
          opps={lpOpps}
          uid={career.foundingClubId ?? ""}
          nameOf={nameOf}
          onPlayNext={playNextLeagueGame}
          onEnterKnockout={() => {
            if (lp?.advanced) setAlive(seedOrder(lp.r16Ids));
            setPhase("knockout");
          }}
          comp={comp}
        />
      )}

      {phase === "knockout" && !done && (
        <div className="mt-6 rounded-2xl border border-border bg-card/40 p-4 text-center">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {userAlive ? "Still in it" : "Eliminated"} · {alive.length} clubs left
          </div>
          <div className="font-display text-lg mt-1">
            Next: {ROUND_LABEL[rounds[roundIdx]]}
          </div>
        </div>
      )}

      {phase === "knockout" && currentRoundMatches.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {ROUND_LABEL[currentRoundMatches[0].round]} results
          </div>
          {currentRoundMatches.map((m, i) => (
            <div
              key={i}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm ${
                m.isUser ? "border-warning bg-warning/10" : "border-border bg-card/40"
              }`}
            >
              <span className={`truncate flex-1 ${m.winnerId === m.homeId ? "font-display" : "text-muted-foreground"}`}>
                {nameOf(m.homeId)}
              </span>
              <span className="font-display tabular-nums shrink-0">
                {m.homeScore}–{m.awayScore}
              </span>
              <span className={`truncate flex-1 text-right ${m.winnerId === m.awayId ? "font-display" : "text-muted-foreground"}`}>
                {nameOf(m.awayId)}
              </span>
            </div>
          ))}
        </div>
      )}

      {phase === "knockout" &&
        (done ? (
          <EuropeOutcome
            comp={comp}
            champion={userChampion}
            reached={lastReached(rounds, roundIdx, userAlive)}
          />
        ) : (
          <button
            onClick={playRound}
            className="mt-6 w-full px-4 py-3 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
          >
            Play {ROUND_LABEL[rounds[roundIdx]]} →
          </button>
        ))}

      {liveMatch && <LiveMatchModal live={liveMatch} onClose={() => setLiveMatch(null)} />}
    </div>
  );
}

/** UCL league phase: play 8 matchdays one at a time, then see the 36-club
 *  table + your finish. `lp` is null until all 8 games are in. */
function LeaguePhase({
  lp,
  games,
  opps,
  uid,
  nameOf,
  onPlayNext,
  onEnterKnockout,
  comp,
}: {
  lp: {
    standings: PhaseRow[];
    userPos: number;
    cut: UclCut;
    played: { oppId: string; us: number; them: number }[];
    advanced: boolean;
    playoff?: { oppId: string; us: number; them: number; won: boolean };
    r16Ids: string[];
  } | null;
  games: { oppId: string; us: number; them: number }[];
  opps: { id: string; strength: number }[];
  uid: string;
  nameOf: (id: string) => string;
  onPlayNext: () => void;
  onEnterKnockout: () => void;
  comp: EuroComp;
}) {
  // Still playing the 8 matchdays — show progress + each result as it lands.
  if (!lp) {
    const pts = games.reduce((a, g) => a + (g.us > g.them ? 3 : g.us === g.them ? 1 : 0), 0);
    const next = opps[games.length];
    return (
      <div className="mt-6">
        <div className="rounded-2xl border-2 border-warning bg-warning/10 p-4 text-center">
          <div className="font-display text-xl text-warning mb-1">League phase</div>
          <p className="text-[11px] text-muted-foreground">
            36 clubs, one table, 8 matches. Top 8 reach the Round of 16 directly; 9th–24th into a
            playoff.
          </p>
          <div className="mt-2 font-display text-2xl text-warning tabular-nums">
            Matchday {Math.min(games.length + 1, LEAGUE_PHASE_GAMES)} / {LEAGUE_PHASE_GAMES}
            <span className="text-sm text-muted-foreground ml-2">· {pts} pts</span>
          </div>
        </div>

        {games.length > 0 && (
          <div className="mt-3 space-y-1">
            {games.map((g, i) => {
              const tone =
                g.us > g.them ? "text-success" : g.us === g.them ? "text-muted-foreground" : "text-primary";
              return (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-border bg-card/40 text-sm"
                >
                  <span className="font-mono text-[10px] text-muted-foreground w-5">MD{i + 1}</span>
                  <span className="flex-1 truncate">{nameOf(g.oppId)}</span>
                  <span className={`font-display tabular-nums ${tone}`}>
                    {g.us}–{g.them}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <button
          onClick={onPlayNext}
          className="mt-4 w-full px-4 py-3 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
        >
          {next ? `Play matchday ${games.length + 1} · vs ${nameOf(next.id)} →` : "…"}
        </button>
      </div>
    );
  }

  const w = lp.played.filter((m) => m.us > m.them).length;
  const d = lp.played.filter((m) => m.us === m.them).length;
  const l = lp.played.length - w - d;
  const top = lp.standings.slice(0, 8);
  const showUser = lp.userPos > 8;

  return (
    <div className="mt-6">
      <div className="rounded-2xl border border-border bg-card/40 p-4 text-center">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          League phase · finished {lp.userPos}
          {ordinalSuffix(lp.userPos)} of 36
        </div>
        <div className="font-display text-2xl text-warning mt-1">
          {w}W {d}D {l}L
        </div>
        {lp.playoff && (
          <div className={`mt-1 text-xs ${lp.playoff.won ? "text-success" : "text-primary"}`}>
            Playoff vs {nameOf(lp.playoff.oppId)}: {lp.playoff.us}–{lp.playoff.them} ·{" "}
            {lp.playoff.won ? "through!" : "out"}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-1">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Table (top 8)</div>
        {top.map((r) => (
          <TableRow key={r.id} r={r} uid={uid} nameOf={nameOf} />
        ))}
        {showUser && (
          <>
            <div className="text-center text-muted-foreground text-xs">⋯</div>
            <TableRow r={lp.standings[lp.userPos - 1]} uid={uid} nameOf={nameOf} />
          </>
        )}
      </div>

      {lp.advanced ? (
        <button
          onClick={onEnterKnockout}
          className="mt-6 w-full px-4 py-3 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
        >
          Into the Round of 16 →
        </button>
      ) : (
        <EuropeOutcome comp={comp} champion={false} reached="out" />
      )}
    </div>
  );
}

function TableRow({
  r,
  uid,
  nameOf,
}: {
  r: PhaseRow;
  uid: string;
  nameOf: (id: string) => string;
}) {
  const isUser = r.id === uid;
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${
        isUser ? "border-warning bg-warning/10 text-warning" : "border-border bg-card/40"
      }`}
    >
      <span className="font-mono text-[10px] text-muted-foreground w-5">{r.pos}</span>
      <span className="flex-1 truncate">{nameOf(r.id)}</span>
      <span className="text-[10px] text-muted-foreground">{r.gd >= 0 ? `+${r.gd}` : r.gd}</span>
      <span className="font-display tabular-nums w-6 text-right">{r.pts}</span>
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/** How far the user got, for prize + headline. */
function lastReached(rounds: EuroRound[], roundIdx: number, userAlive: boolean): EuroRound {
  if (roundIdx >= rounds.length && userAlive) return "champion";
  // Eliminated in the round just played (roundIdx-1).
  return rounds[Math.max(0, roundIdx - 1)] ?? "out";
}

function EuropeOutcome({
  comp,
  champion,
  reached,
}: {
  comp: EuroComp;
  champion: boolean;
  reached: EuroRound;
}) {
  const career = useCareer();
  const meta = EURO_META[comp];
  const prize = europePrize(comp, champion ? "champion" : reached);

  // Bank prize + (if won) a trophy, exactly once — guarded by europeResult.
  useEffect(() => {
    const last = career.seasonHistory[career.seasonHistory.length - 1];
    if (!last || last.season !== career.currentSeason || last.europeResult) return;
    useCareer.setState((st) => {
      const hist = [...st.seasonHistory];
      const rec = hist[hist.length - 1];
      const trophies = champion ? [...rec.trophies, `${meta.name} Winner`] : rec.trophies;
      hist[hist.length - 1] = { ...rec, trophies, europeResult: champion ? "champion" : reached };
      return {
        balance: Math.round(st.balance + prize),
        trophies: st.trophies + (champion ? 1 : 0),
        seasonHistory: hist,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-8 rounded-2xl border-2 border-warning bg-warning/10 p-6 text-center">
      <div className="text-4xl mb-2">{champion ? meta.icon : "👋"}</div>
      <div className="font-display text-2xl text-warning mb-1">
        {champion ? `${meta.name} Champions!` : `${ROUND_LABEL[reached]} exit`}
      </div>
      <div className="text-xs text-muted-foreground mb-1">
        💰 Prize money banked: €{prize}M
      </div>
      <div className="text-xs text-muted-foreground mb-5">
        {champion ? "A continental crown for the cabinet." : "Europe is brutal. Back to domestic business."}
      </div>
      <Link
        to="/career/postseason"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning text-warning-foreground font-display text-base tracking-wide hover:brightness-110 transition"
      >
        To the transfer market →
      </Link>
    </div>
  );
}
