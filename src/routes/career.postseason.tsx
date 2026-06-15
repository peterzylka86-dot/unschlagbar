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
import { playerFitsSlot } from "@/lib/draft-helpers";
import {
  seasonLottery,
  rivalClaim,
  youngRating,
  WK_START_AGE,
  type WonderkidIcon,
} from "@/lib/wonderkids";
import type { Club, Player, Position } from "@/lib/game-types";

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

  // Rival turnover — computed ONCE at mount so the transfer-news card can
  // show what the league did while the user decides their own swaps.
  // Exclusion uses the squad as it was at window-open; a user swap made
  // after rivals "signed" their players can in theory collide, but the
  // pool is ~14k players so the practical risk is nil (and matches the
  // previous behavior, where rival turnover also didn't see user swaps).
  const rivalTurnover = useMemo(
    () => autoTurnoverRivals(career.rivals, allPlayers, career.squad),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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

  // ─── Wonderkid lottery (the CM "unearth a legend" loop) ───────────────
  // Deterministic per (career, season): an icon surfaces ~10% of windows,
  // drawn from the finite unclaimed pool. Separately, a rival may snap up a
  // DIFFERENT unclaimed icon (the FOMO — gone for the rest of the career).
  const careerSeed = career.startedAt ?? "career";
  const offeredIcon = useMemo(
    () => seasonLottery(careerSeed, career.currentSeason, career.claimedWonderkidIds),
    [careerSeed, career.currentSeason, career.claimedWonderkidIds],
  );
  const rivalIcon = useMemo(
    () =>
      rivalClaim(
        careerSeed,
        career.currentSeason,
        // Protect the icon you're being offered from a rival snipe.
        offeredIcon ? [...career.claimedWonderkidIds, offeredIcon.id] : career.claimedWonderkidIds,
        null,
      ),
    [careerSeed, career.currentSeason, career.claimedWonderkidIds, offeredIcon],
  );
  // wkStage: "offer" (deciding) → "releasing" (choosing who to drop) → "done"
  const [wkStage, setWkStage] = useState<"offer" | "releasing" | "done">("offer");
  const [signedName, setSignedName] = useState<string | null>(null);
  // Icon ids claimed THIS window (yours + the rival's) — merged at commit.
  const newlyClaimed = useMemo(() => {
    const ids: string[] = [];
    if (rivalIcon) ids.push(rivalIcon.id);
    return ids;
  }, [rivalIcon]);

  function buildWonderkid(icon: WonderkidIcon): Player {
    return {
      name: icon.name,
      position: icon.position as Position,
      altPositions: icon.altPositions as Position[] | undefined,
      prime_rating: youngRating(icon),
      career_years: "prospect",
      nationality: icon.nationality,
      club: career.foundingClubId ?? "free-agent",
      wonderkidId: icon.id,
      targetRating: icon.prime,
      age: WK_START_AGE,
      verified: true,
    };
  }

  function signWonderkid(releaseIdx: number) {
    if (!offeredIcon) return;
    const next = [...workingSquad];
    next[releaseIdx] = buildWonderkid(offeredIcon);
    setWorkingSquad(next);
    setSignedName(offeredIcon.name);
    setWkStage("done");
  }

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
            playerFitsSlot(target.position, p),
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
    // Rivals were refreshed at mount (rivalTurnover memo) — the same
    // squads the transfer-news card displayed. Using the precomputed
    // result keeps "what you read" === "what you face."
    // Claimed wonderkids: the rival's grab (always) + the icon you signed
    // (if any — detected by a prospect now in the working squad).
    const signedIds = workingSquad
      .filter((p) => p.wonderkidId && !career.squad.some((s) => s.wonderkidId === p.wonderkidId))
      .map((p) => p.wonderkidId!);
    useCareer.setState({
      squad: workingSquad,
      rivals: rivalTurnover.rivals,
      form: {}, // fresh slate next season
      currentSeason: career.currentSeason + 1,
      midSeasonSwapUsed: false,
      relegatedLastSeason: false, // consumed (relegation flag no longer forces sells)
      pendingDeparture: null,
      starDemandResolved: false,
      claimedWonderkidIds: Array.from(
        new Set([...career.claimedWonderkidIds, ...newlyClaimed, ...signedIds]),
      ),
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

      {/* 📰 Around the league — what rivals did over the break. The auto-
          turnover used to run invisibly at continue-time; surfacing the
          signings makes the world feel alive and telegraphs the rising
          difficulty (every rival also gains +1 strength next season). */}
      {rivalTurnover.news.length > 0 && (
        <div className="mt-4 rounded-2xl border border-border bg-card/40 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-display text-base text-foreground/90">📰 Around the league</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Rivals strengthen for S{career.currentSeason + 1}
            </div>
          </div>
          <ul className="space-y-1.5">
            {rivalTurnover.news.slice(0, 8).map((n, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span style={{ color: n.color }}>{n.badge}</span>
                <span className="text-foreground/80 truncate">
                  <span className="text-foreground">{n.rivalName}</span>
                  {" sign "}
                  <span className="text-warning font-medium">{n.inName}</span>
                  <span className="text-warning/70 font-display ml-1">{n.inRating}</span>
                  <span className="text-muted-foreground"> — {n.outName} departs</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] text-muted-foreground italic">
            The league grows stronger every season. Keep up.
          </p>
        </div>
      )}

      {/* ✨ Wonderkid lottery — the legend-prospect (CM "unearth a gem"). */}
      {offeredIcon && wkStage !== "done" && (
        <div className="mt-4 rounded-2xl border-2 border-warning bg-gradient-to-br from-warning/15 to-transparent p-5">
          {wkStage === "offer" ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">✨</span>
                <div className="font-display text-xl text-warning">A wonderkid wants to join</div>
              </div>
              <p className="text-sm text-foreground/85">
                A {WK_START_AGE}-year-old{" "}
                <span className="font-medium text-warning">{offeredIcon.name}</span> has emerged from{" "}
                {offeredIcon.historicClub}'s academy — {offeredIcon.nationality}, starting at{" "}
                <span className="font-display">{youngRating(offeredIcon)}</span>, with the potential
                to reach <span className="font-display text-warning">{offeredIcon.prime}</span>. Play
                him and he grows toward greatness. Miss him and he's gone forever.
              </p>
              <p className="text-[11px] text-muted-foreground mt-2">
                Signing him means releasing a squad player. ⭐ Franchise is safe.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setWkStage("releasing")}
                  className="flex-1 px-4 py-3 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
                >
                  ✨ Sign {offeredIcon.name} →
                </button>
                <button
                  onClick={() => setWkStage("done")}
                  className="px-4 py-3 rounded-md border border-muted-foreground/40 text-muted-foreground text-sm hover:bg-muted/20 transition"
                >
                  Pass
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="font-display text-lg text-warning">
                  Who makes way for {offeredIcon.name}?
                </div>
                <button
                  onClick={() => setWkStage("offer")}
                  className="text-[11px] text-muted-foreground hover:text-warning underline"
                >
                  back
                </button>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Pick the squad player to release. ⭐ Franchise can't leave.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {workingSquad.map((p, i) => {
                  const isFranchise = `${p.club}:${p.name}` === career.franchisePlayerKey;
                  return (
                    <button
                      key={`wk-out-${i}-${p.name}`}
                      disabled={isFranchise}
                      onClick={() => signWonderkid(i)}
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
                      <span className="shrink-0 font-display text-sm text-warning">
                        {p.prime_rating}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Signed confirmation */}
      {signedName && wkStage === "done" && (
        <div className="mt-4 rounded-2xl border-2 border-success bg-success/10 p-4 text-center">
          <div className="font-display text-lg text-success">
            ✨ {signedName} signs as a prospect!
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Give him first-team minutes and watch him grow toward his prime.
          </div>
        </div>
      )}

      {/* 😱 Rival FOMO — a legend you'll never get now. */}
      {rivalIcon && (
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-xs text-foreground/85">
          😱{" "}
          <span className="text-primary font-medium">
            A rival has signed wonderkid {rivalIcon.name} ({WK_START_AGE})
          </span>{" "}
          — gone from the pool for the rest of your career.
        </div>
      )}

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

// ─── AI rival auto-turnover + transfer news ────────────────────────────

export interface TransferNewsItem {
  rivalName: string;
  badge: string;
  color: string;
  inName: string;
  inRating: number;
  outName: string;
}

/** Each rival replaces its 2 weakest players with stronger pool players.
 *  Returns BOTH the refreshed rivals AND a news feed of the signings —
 *  previously this ran invisibly at continue-time; making the world's
 *  movement visible is the cheap half of "rival escalation" (the other
 *  half is the per-season strength bump in career.season.tsx). */
function autoTurnoverRivals<
  R extends { squad: Player[]; archetypeStyle?: string; archetypeName: string; badge: string; color: string },
>(
  rivals: R[],
  pool: Player[],
  userSquad: Player[],
): { rivals: R[]; news: TransferNewsItem[] } {
  const userKeys = new Set(userSquad.map((p) => `${p.club}:${p.name}`));
  const byBucket: Record<string, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of pool) {
    const bucket = simplifyPosition(p.position);
    if (byBucket[bucket]) byBucket[bucket].push(p);
  }
  for (const b of Object.values(byBucket)) b.sort((a, b2) => b2.prime_rating - a.prime_rating);
  const news: TransferNewsItem[] = [];
  const refreshed = rivals.map((r, idx) => {
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
      // Only newsworthy if the incoming player is actually an upgrade —
      // sidegrade churn would just be noise in the feed.
      if (replacement.prime_rating > weakest.prime_rating) {
        news.push({
          rivalName: r.archetypeName,
          badge: r.badge,
          color: r.color,
          inName: replacement.name,
          inRating: replacement.prime_rating,
          outName: weakest.name,
        });
      }
      squad = squad
        .filter((p) => `${p.club}:${p.name}` !== `${weakest.club}:${weakest.name}`)
        .concat(replacement);
    }
    return { ...r, squad };
  });
  return { rivals: refreshed, news };
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
        playerFitsSlot(target.position, p),
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
