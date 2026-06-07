/**
 * /career/postseason — end-of-season transfer window.
 *
 * REWRITTEN per user spec:
 *   "No demand or player leaving...but you get 2 swaps if you want...
 *   or you can skip them and continue with your current squad."
 *
 * Previously this screen had hot/cold demands + forced sells + spin
 * rebuild stages. Now it's a single window: TWO discretionary swaps,
 * each one a spin-based same-position trade, OR continue with squad
 * unchanged. The user has full agency — no forced moves.
 *
 * Relegation no longer applies special force-sells either (per the
 * uniform "no player leaving" rule). The Continue button always works.
 *
 * Franchise player is exempt from being swapped out (untouchable).
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useCareer } from "@/lib/career-store";
import { getCareerClubs, getCareerPlayers } from "@/lib/data";
import { pickSpinClub, simplifyPosition } from "@/lib/career-core";
import { isPositionCompatible } from "@/lib/draft-helpers";
import type { Club, Player } from "@/lib/game-types";

export const Route = createFileRoute("/career/postseason")({
  head: () => ({ meta: [{ title: "Transfer window · GOLAZO" }] }),
  component: PostSeason,
});

const MAX_SWAPS = 2;

function PostSeason() {
  const career = useCareer();
  const navigate = useNavigate();

  const allPlayers = useMemo(
    () => getCareerPlayers(career.foundingClubId),
    [career.foundingClubId],
  );
  const allClubs = useMemo(() => getCareerClubs(career.foundingClubId), [career.foundingClubId]);

  // Per-window state
  const [workingSquad, setWorkingSquad] = useState<Player[]>(() => [...career.squad]);
  const [swapsUsed, setSwapsUsed] = useState(0);
  const [stage, setStage] = useState<
    | "menu" // showing the squad with "Start swap" / "Continue" buttons
    | "picking-out" // user is choosing which squad member to send out
    | "spinning" // wheel landing on a club
    | "picking-in" // user picks the incoming player from spun club
  >("menu");
  const [pendingOutIdx, setPendingOutIdx] = useState<number | null>(null);
  const [spunClub, setSpunClub] = useState<Club | null>(null);
  const [recentClubIds, setRecentClubIds] = useState<string[]>([]);

  // Render guard (after hooks; see LEARNINGS.md L-1)
  if (career.squad.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        No active career — head back to{" "}
        <Link to="/career" className="underline ml-1">
          /career
        </Link>
      </div>
    );
  }

  const swapsLeft = MAX_SWAPS - swapsUsed;
  const draftedKeys = new Set(workingSquad.map((p) => `${p.club}:${p.name}`));

  function startSwap() {
    setStage("picking-out");
  }

  function pickOut(idx: number) {
    setPendingOutIdx(idx);
    const target = workingSquad[idx];
    if (!target) return;
    setStage("spinning");
    setTimeout(() => {
      // Eligible clubs: those with at least one compatible-position
      // undrafted player. pickSpinClub avoids recently-landed clubs.
      const eligible = allClubs.filter((c) =>
        allPlayers.some(
          (p) =>
            p.club === c.id &&
            !draftedKeys.has(`${p.club}:${p.name}`) &&
            isPositionCompatible(target.position, p.position),
        ),
      );
      const picked = pickSpinClub(eligible, recentClubIds);
      if (!picked) {
        // No candidates anywhere — abandon this swap, return to menu.
        setStage("menu");
        setPendingOutIdx(null);
        return;
      }
      setSpunClub(picked);
      setRecentClubIds((prev) => [picked.id, ...prev].slice(0, 5));
      setStage("picking-in");
    }, 700);
  }

  function pickIn(newPlayer: Player) {
    if (pendingOutIdx === null) return;
    const next = [...workingSquad];
    next[pendingOutIdx] = newPlayer;
    setWorkingSquad(next);
    setSwapsUsed((n) => n + 1);
    setPendingOutIdx(null);
    setSpunClub(null);
    setStage("menu");
  }

  function cancelSwap() {
    setPendingOutIdx(null);
    setSpunClub(null);
    setStage("menu");
  }

  function commitAndContinue() {
    // AI rivals undergo a small auto-turnover. No /career/draft needed.
    const refreshedRivals = autoTurnoverRivals(career.rivals, allPlayers, workingSquad);
    useCareer.setState({
      squad: workingSquad,
      rivals: refreshedRivals,
      form: {}, // fresh slate next season
      currentSeason: career.currentSeason + 1,
      midSeasonSwapUsed: false,
      relegatedLastSeason: false, // consumed (relegation flag no longer forces sells)
      pendingDeparture: null,
      starDemandResolved: false,
    });
    navigate({ to: "/career/season" });
  }

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
          <div className="font-display text-2xl text-warning">Transfer window</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            End of Season {career.currentSeason}
          </div>
        </div>
      </header>

      {/* Swaps counter + intro */}
      <div className="mt-6 rounded-2xl border-2 border-warning bg-warning/10 p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="font-display text-xl text-warning">🔄 Swap window</div>
          <div className="text-xs text-warning">
            {swapsLeft} swap{swapsLeft === 1 ? "" : "s"} left of {MAX_SWAPS}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Up to {MAX_SWAPS} discretionary swaps. Each one: pick a squad member, spin the wheel,
          accept a same-position replacement. Or skip and continue with your current squad. ⭐
          Franchise can't be swapped.
        </p>
      </div>

      {/* Stage content */}
      <div className="mt-6">
        {stage === "menu" && (
          <SquadMenu
            squad={workingSquad}
            franchiseKey={career.franchisePlayerKey}
            canSwap={swapsLeft > 0}
            onStartSwap={startSwap}
            onContinue={commitAndContinue}
            currentSeason={career.currentSeason}
          />
        )}

        {stage === "picking-out" && (
          <PickOutCard
            squad={workingSquad}
            franchiseKey={career.franchisePlayerKey}
            onPick={pickOut}
            onCancel={cancelSwap}
          />
        )}

        {stage === "spinning" && <SpinningCard target={workingSquad[pendingOutIdx ?? 0] ?? null} />}

        {stage === "picking-in" && spunClub && pendingOutIdx !== null && (
          <PickInCard
            spunClub={spunClub}
            target={workingSquad[pendingOutIdx]}
            allPlayers={allPlayers}
            drafted={draftedKeys}
            onPick={pickIn}
            onCancel={cancelSwap}
          />
        )}
      </div>
    </div>
  );
}

// ─── AI rival auto-turnover (unchanged — still useful) ─────────────────

function autoTurnoverRivals<R extends { squad: Player[]; archetypeStyle?: string }>(
  rivals: R[],
  pool: Player[],
  userSquad: Player[],
): R[] {
  const userKeys = new Set(userSquad.map((p) => `${p.club}:${p.name}`));
  const byBucket: Record<string, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of pool) {
    const bucket = simplifyPosition(p.position);
    if (byBucket[bucket]) byBucket[bucket].push(p);
  }
  for (const b of Object.values(byBucket)) b.sort((a, b2) => b2.prime_rating - a.prime_rating);
  return rivals.map((r, idx) => {
    if (r.squad.length === 0) return r;
    let squad = [...r.squad];
    for (let swap = 0; swap < 2; swap++) {
      const weakest = [...squad].sort((a, b) => a.prime_rating - b.prime_rating)[0];
      if (!weakest) break;
      const bucket = simplifyPosition(weakest.position);
      const taken = new Set([...squad.map((p) => `${p.club}:${p.name}`), ...userKeys]);
      const candidates = (byBucket[bucket] ?? []).filter((p) => !taken.has(`${p.club}:${p.name}`));
      const replacement = candidates[(idx * 7 + swap) % Math.max(1, candidates.length)];
      if (!replacement) break;
      squad = squad
        .filter((p) => `${p.club}:${p.name}` !== `${weakest.club}:${weakest.name}`)
        .concat(replacement);
    }
    return { ...r, squad };
  });
}

// ─── Sub-components ───────────────────────────────────────────────────

function SquadMenu({
  squad,
  franchiseKey,
  canSwap,
  onStartSwap,
  onContinue,
  currentSeason,
}: {
  squad: Player[];
  franchiseKey: string | null;
  canSwap: boolean;
  onStartSwap: () => void;
  onContinue: () => void;
  currentSeason: number;
}) {
  return (
    <div>
      <div className="rounded-2xl border border-border bg-card/40 p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Your squad ({squad.length})
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {squad.map((p, i) => {
            const isFranchise = `${p.club}:${p.name}` === franchiseKey;
            return (
              <div
                key={`squad-${i}-${p.name}`}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm ${
                  isFranchise ? "border-warning bg-warning/10" : "border-border bg-card"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate flex items-center gap-1">
                    {isFranchise && <span title="Franchise player">⭐</span>}
                    <span className="truncate">{p.name}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {p.position} · {p.career_years}
                  </div>
                </div>
                <span className="shrink-0 font-display text-sm text-warning">{p.prime_rating}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex flex-col sm:flex-row gap-2">
        <button
          onClick={onStartSwap}
          disabled={!canSwap}
          className={`flex-1 px-4 py-3 rounded-md font-display tracking-wide transition ${
            canSwap
              ? "bg-warning text-warning-foreground hover:brightness-110"
              : "bg-muted/30 text-muted-foreground cursor-not-allowed"
          }`}
        >
          {canSwap ? "🔄 Use a swap →" : "No swaps left"}
        </button>
        <button
          onClick={onContinue}
          className="flex-1 px-4 py-3 rounded-md border-2 border-warning bg-warning/15 text-warning font-display tracking-wide hover:bg-warning/25 transition"
        >
          Continue to Season {currentSeason + 1} →
        </button>
      </div>
    </div>
  );
}

function PickOutCard({
  squad,
  franchiseKey,
  onPick,
  onCancel,
}: {
  squad: Player[];
  franchiseKey: string | null;
  onPick: (idx: number) => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-warning bg-warning/10 p-5">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-warning">Step 1 of 2</div>
          <div className="font-display text-xl">Who's leaving?</div>
        </div>
        <button
          onClick={onCancel}
          className="text-[11px] text-muted-foreground hover:text-warning underline"
        >
          cancel swap
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Tap the squad member you want to swap out. The wheel will then spin for a same-position
        replacement. ⭐ Franchise can't leave.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {squad.map((p, i) => {
          const isFranchise = `${p.club}:${p.name}` === franchiseKey;
          return (
            <button
              key={`out-${i}-${p.name}`}
              disabled={isFranchise}
              onClick={() => onPick(i)}
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

function SpinningCard({ target }: { target: Player | null }) {
  return (
    <div className="rounded-2xl border-2 border-warning bg-warning/10 p-8 text-center">
      <div className="text-5xl animate-spin inline-block">🎰</div>
      <div className="mt-3 text-sm text-muted-foreground">
        Drawing a new {target?.position ?? "player"}…
      </div>
    </div>
  );
}

function PickInCard({
  spunClub,
  target,
  allPlayers,
  drafted,
  onPick,
  onCancel,
}: {
  spunClub: Club;
  target: Player;
  allPlayers: Player[];
  drafted: Set<string>;
  onPick: (p: Player) => void;
  onCancel: () => void;
}) {
  const pool = allPlayers
    .filter(
      (p) =>
        p.club === spunClub.id &&
        !drafted.has(`${p.club}:${p.name}`) &&
        isPositionCompatible(target.position, p.position),
    )
    .sort((a, b) => b.prime_rating - a.prime_rating)
    .slice(0, 12);
  return (
    <div className="rounded-2xl border-2 border-warning bg-warning/10 p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest text-warning">Step 2 of 2</div>
        <button
          onClick={onCancel}
          className="text-[11px] text-muted-foreground hover:text-warning underline"
        >
          cancel swap
        </button>
      </div>
      <div className="text-center mb-4">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Wheel landed on
        </div>
        <div className="font-display text-2xl text-warning">{spunClub.name}</div>
        <div className="text-xs text-muted-foreground mt-1">
          Pick your new {target.position} — replacing{" "}
          <span className="line-through opacity-70">{target.name}</span>
        </div>
      </div>
      {pool.length === 0 ? (
        <p className="text-sm text-muted-foreground italic text-center py-4">
          No compatible {target.position}s at {spunClub.name}.{" "}
          <button onClick={onCancel} className="underline text-warning">
            cancel
          </button>{" "}
          and try a different swap.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {pool.map((p) => (
            <button
              key={`in-${p.name}-${p.club}`}
              onClick={() => onPick(p)}
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
      )}
    </div>
  );
}
