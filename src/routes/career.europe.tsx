/**
 * /career/europe — continental knockout (Real mode).
 *
 * Qualification comes from the just-finished league position
 * (qualifyEurope): top 4 → Champions League, 5–6 → Europa, 7 → Conference.
 * The field is the strongest clubs across every league; you play a seeded
 * single-elimination bracket. Prize money for how far you go banks into the
 * club balance, and winning adds a trophy. (v1 knockout — the 36-team UCL
 * league phase is a future refinement.)
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useCareer } from "@/lib/career-store";
import {
  qualifyEurope,
  europeField,
  euroRounds,
  europePrize,
  EURO_META,
  ROUND_LABEL,
  type EuroComp,
  type EuroRound,
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

  const finishPos = career.seasonHistory[career.seasonHistory.length - 1]?.finalPosition ?? 99;
  const comp: EuroComp | null = qualifyEurope(finishPos);
  const userRating = useMemo(() => {
    if (career.squad.length === 0) return 75;
    return Math.round(career.squad.reduce((a, p) => a + p.prime_rating, 0) / career.squad.length);
  }, [career.squad]);

  const field = useMemo(
    () => (comp ? europeField(comp, career.foundingClubId ?? "") : []),
    [comp, career.foundingClubId],
  );
  const rounds = comp ? euroRounds(EURO_META[comp].field) : [];
  const strengthOf = (id: string) =>
    id === career.foundingClubId ? userRating : (field.find((c) => c.id === id)?.strength ?? 75);
  const nameOf = (id: string) =>
    id === career.foundingClubId ? "Your XI" : (field.find((c) => c.id === id)?.name ?? id);

  // alive = clubs still in, in bracket order; matches = all played.
  const [alive, setAlive] = useState<string[]>([]);
  const [matches, setMatches] = useState<EuroMatch[]>([]);
  const [roundIdx, setRoundIdx] = useState(0);

  useEffect(() => {
    if (alive.length || !comp || field.length === 0) return;
    const seeded = [...field].sort((a, b) => b.strength - a.strength).map((c) => c.id);
    setAlive(seedOrder(seeded));
  }, [alive.length, comp, field]);

  if (!comp) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 text-muted-foreground gap-3">
        <div className="text-3xl">😕</div>
        <div>No European place this season — finish top 7 to qualify.</div>
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
    const diff = strengthOf(homeId) + 3 - strengthOf(awayId);
    let hs = poisson(Math.max(0.2, 1.2 + diff * 0.08 + (rand() - 0.5) * 0.9), rand);
    let as = poisson(Math.max(0.1, 1.1 - diff * 0.06 + (rand() - 0.5) * 0.9), rand);
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
            Season {career.currentSeason} · {meta.field}-club knockout
          </div>
        </div>
      </header>

      {!done && (
        <div className="mt-6 rounded-2xl border border-border bg-card/40 p-4 text-center">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {userAlive ? "Still in it" : "Eliminated"} · {alive.length} clubs left
          </div>
          <div className="font-display text-lg mt-1">
            Next: {ROUND_LABEL[rounds[roundIdx]]}
          </div>
        </div>
      )}

      {currentRoundMatches.length > 0 && (
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

      {done ? (
        <EuropeOutcome comp={comp} champion={userChampion} reached={lastReached(rounds, roundIdx, userAlive)} />
      ) : (
        <button
          onClick={playRound}
          className="mt-6 w-full px-4 py-3 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
        >
          Play {ROUND_LABEL[rounds[roundIdx]]} →
        </button>
      )}
    </div>
  );
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
