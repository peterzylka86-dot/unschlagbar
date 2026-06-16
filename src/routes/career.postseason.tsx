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
import { buildRealRivals } from "@/lib/real-data";
import { pickSpinClub, simplifyPosition } from "@/lib/career-core";
import { sellValue, feeLabel } from "@/lib/market";
import {
  clubReputation,
  signStatus,
  type SignStatus,
  MAX_SIGNINGS_PER_WINDOW,
} from "@/lib/transfers";
import { playerFitsSlot } from "@/lib/draft-helpers";
import {
  seasonLottery,
  youngRating,
  bidOddsLabel,
  resolveBid,
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
    () => getCareerPlayers(career.foundingClubId, career.careerMode),
    [career.foundingClubId, career.careerMode],
  );
  const allClubs = useMemo(
    () => getCareerClubs(career.foundingClubId, career.careerMode),
    [career.foundingClubId, career.careerMode],
  );

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
  // Transfer market: money spent + signings made so far this window.
  const [spent, setSpent] = useState(0);
  const [signingsMade, setSigningsMade] = useState(0);

  // ─── Wonderkid BIDDING WAR (the "what would I risk" decision) ─────────
  // Deterministic per (career, season): a legend-prospect surfaces ~10% of
  // windows, and he's CONTESTED. You stake a squad player to bid — bigger
  // name, better odds. Win and he joins (your stake leaves); lose and a
  // rival lands him AND the player you shopped around comes back unsettled.
  const careerSeed = career.startedAt ?? "career";
  // Legend-prospect lottery is a Legends-mode feature only — a 17-year-old
  // Pelé alongside today's squads would be anachronistic in Real mode.
  const offeredIcon = useMemo(
    () =>
      career.careerMode === "legends"
        ? seasonLottery(careerSeed, career.currentSeason, career.claimedWonderkidIds)
        : null,
    [career.careerMode, careerSeed, career.currentSeason, career.claimedWonderkidIds],
  );
  // Flavour: how many rivals are also circling (deterministic, 2-3).
  const rivalsChasing = offeredIcon ? 2 + (career.currentSeason % 2) : 0;

  // bidStage: "offer" → "bidding" (pick who to stake) → "resolving" → "done"
  const [bidStage, setBidStage] = useState<"offer" | "bidding" | "resolving" | "done">("offer");
  const [bidResult, setBidResult] = useState<"won" | "lost" | "passed" | null>(null);
  const [bidPlayerName, setBidPlayerName] = useState<string | null>(null);
  // Persisted-at-commit effects of this window's bid:
  const [wkClaimId, setWkClaimId] = useState<string | null>(null); // icon claimed (you or rival)
  const [wkUnsettledKey, setWkUnsettledKey] = useState<string | null>(null); // shopped + lost

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

  function passOnKid() {
    if (!offeredIcon) return;
    setBidResult("passed");
    setWkClaimId(offeredIcon.id); // a rival takes him — gone for good
    setBidStage("done");
  }

  function placeBid(stakeIdx: number) {
    if (!offeredIcon) return;
    const stake = workingSquad[stakeIdx];
    if (!stake) return;
    const stakeKey = `${stake.club}:${stake.name}`;
    setBidPlayerName(stake.name);
    setBidStage("resolving");
    // Brief tension, then the deterministic result.
    setTimeout(() => {
      const won = resolveBid(careerSeed, career.currentSeason, offeredIcon.id, stake.prime_rating);
      if (won) {
        const next = [...workingSquad];
        next[stakeIdx] = buildWonderkid(offeredIcon);
        setWorkingSquad(next);
        setBidResult("won");
      } else {
        // Rival lands him; the player you shopped around sulks next season.
        setWkUnsettledKey(stakeKey);
        setBidResult("lost");
      }
      setWkClaimId(offeredIcon.id); // claimed either way — gone from the pool
      setBidStage("done");
    }, 900);
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

  // ─── Real mode: an actual transfer market (budget + buy/sell) ─────────
  // Budget is the persistent club balance (prize money banked at season
  // end), so winning literally buys you a better squad.
  const isReal = career.careerMode === "real";
  const budget = career.balance;
  const remaining = budget - spent;

  // Your club's pulling power — strength + the silverware you've won. Drives
  // who'll actually agree to join. Grows as you succeed (small-club arc).
  const clubStr = new Map(allClubs.map((c) => [c.id, c.strength]));
  const clubStrengthOf = (id: string) => clubStr.get(id) ?? 72;
  const myStrength = clubStrengthOf(career.foundingClubId ?? "");
  const leagueTitles = career.seasonHistory.filter((s) => s.finalPosition === 1).length;
  const euroTitles = career.seasonHistory.filter((s) => s.europeResult === "champion").length;
  const yourReputation = clubReputation(myStrength, leagueTitles, euroTitles);
  const signingsLeft = MAX_SIGNINGS_PER_WINDOW - signingsMade;

  function buyPlayer(p: Player) {
    if (draftedKeys.has(`${p.club}:${p.name}`)) return;
    const st = signStatus({
      rating: p.prime_rating,
      age: p.age ?? 27,
      sellingClubStrength: clubStrengthOf(p.club),
      yourReputation,
      remainingBudget: remaining,
      signingsLeft,
    });
    if (st.status !== "ok") return;
    setSpent((x) => x + st.price);
    setSigningsMade((n) => n + 1);
    setWorkingSquad((s) => [...s, p]);
  }
  function sellPlayer(idx: number) {
    const p = workingSquad[idx];
    if (!p) return;
    setSpent((x) => x - sellValue(p.prime_rating, p.age ?? 27));
    setWorkingSquad((s) => s.filter((_, i) => i !== idx));
  }
  /** Release a player for free — to trim an over-large squad. */
  function releasePlayer(idx: number) {
    setWorkingSquad((s) => s.filter((_, i) => i !== idx));
  }
  function commitReal() {
    // Promotion/relegation: if last season's finish moved your club to a new
    // division, switch leagues and rebuild the rivals from that division's
    // clubs (your squad comes with you). Otherwise the league persists.
    const moveTo = career.pendingLeagueId;
    const rivals = moveTo
      ? buildRealRivals(moveTo, career.foundingClubId ?? "")
      : career.rivals;
    useCareer.setState({
      squad: workingSquad,
      rivals,
      leagueId: moveTo ?? career.leagueId,
      pendingLeagueId: null,
      form: {},
      currentSeason: career.currentSeason + 1,
      midSeasonSwapUsed: false,
      relegatedLastSeason: career.seasonHistory[career.seasonHistory.length - 1]?.relegated ?? false,
      pendingDeparture: null,
      starDemandResolved: false,
      convosThisSeason: [],
      winterDone: false,
      balance: Math.round(career.balance - spent),
    });
    navigate({ to: "/career/season" });
  }

  if (isReal) {
    return (
      <RealTransferMarket
        season={career.currentSeason}
        budget={budget}
        remaining={remaining}
        squad={workingSquad}
        pool={allPlayers}
        yourReputation={yourReputation}
        signingsLeft={signingsLeft}
        clubStrengthOf={clubStrengthOf}
        onBuy={buyPlayer}
        onSell={sellPlayer}
        onRelease={releasePlayer}
        onContinue={commitReal}
      />
    );
  }

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
    // Wonderkid window outcome: the contested kid is claimed either way
    // (you on a win, a rival on a loss/pass) → removed from the pool. A
    // shopped-around player who lost the bid starts next season unsettled.
    useCareer.setState({
      squad: workingSquad,
      rivals: rivalTurnover.rivals,
      form: {}, // fresh slate next season
      currentSeason: career.currentSeason + 1,
      midSeasonSwapUsed: false,
      relegatedLastSeason: false, // consumed (relegation flag no longer forces sells)
      pendingDeparture: null,
      starDemandResolved: false,
      claimedWonderkidIds: wkClaimId
        ? Array.from(new Set([...career.claimedWonderkidIds, wkClaimId]))
        : career.claimedWonderkidIds,
      unsettledKeys: wkUnsettledKey ? [wkUnsettledKey] : [],
      convosThisSeason: [],
      winterDone: false,
      balance: Math.round(career.balance - spent), // legends transfer market spend
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

      {/* ✨ Wonderkid BIDDING WAR — a contested legend-prospect. */}
      {offeredIcon && (
        <div className="mt-4 rounded-2xl border-2 border-warning bg-gradient-to-br from-warning/15 to-transparent p-5">
          {bidStage === "offer" && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">✨</span>
                <div className="font-display text-xl text-warning">
                  A wonderkid is on the market
                </div>
              </div>
              <p className="text-sm text-foreground/85">
                A {WK_START_AGE}-year-old{" "}
                <span className="font-medium text-warning">{offeredIcon.name}</span> has emerged from{" "}
                {offeredIcon.historicClub} — {offeredIcon.nationality}, raw at{" "}
                <span className="font-display">{youngRating(offeredIcon)}</span> now but with the
                potential to reach <span className="font-display text-warning">{offeredIcon.prime}</span>.
              </p>
              <p className="text-[11px] text-primary mt-2">
                ⚠️ {rivalsChasing} rival clubs are chasing him too. To win the race you must put a
                squad player on the table — the bigger the name, the better your odds. Lose the bid
                and he joins a rival, and the player you shopped around comes back unsettled. ⭐
                Franchise can't be bid.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setBidStage("bidding")}
                  className="flex-1 px-4 py-3 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
                >
                  💰 Enter the bidding →
                </button>
                <button
                  onClick={passOnKid}
                  className="px-4 py-3 rounded-md border border-muted-foreground/40 text-muted-foreground text-sm hover:bg-muted/20 transition"
                >
                  Pass
                </button>
              </div>
            </>
          )}

          {bidStage === "bidding" && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="font-display text-lg text-warning">
                  Who do you put on the table for {offeredIcon.name}?
                </div>
                <button
                  onClick={() => setBidStage("offer")}
                  className="text-[11px] text-muted-foreground hover:text-warning underline"
                >
                  back
                </button>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                A bigger name swings the deal — but if you lose the race, he comes back unsettled. ⭐
                Franchise can't be offered.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {workingSquad.map((p, i) => {
                  const isFranchise = `${p.club}:${p.name}` === career.franchisePlayerKey;
                  const odds = bidOddsLabel(p.prime_rating);
                  const oddsTone =
                    odds === "strong"
                      ? "text-success"
                      : odds === "even"
                        ? "text-warning"
                        : "text-primary";
                  return (
                    <button
                      key={`wk-bid-${i}-${p.name}`}
                      disabled={isFranchise}
                      onClick={() => placeBid(i)}
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
                          {p.position} · bid: <span className={oddsTone}>{odds}</span>
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

          {bidStage === "resolving" && (
            <div className="py-6 text-center">
              <div className="text-5xl animate-pulse inline-block">💰</div>
              <div className="mt-3 text-sm text-muted-foreground">
                {offeredIcon.name}'s camp weighs the offers…
              </div>
            </div>
          )}

          {bidStage === "done" && bidResult === "won" && (
            <div className="text-center py-2">
              <div className="text-4xl mb-1">✨</div>
              <div className="font-display text-xl text-success">
                {offeredIcon.name} chooses YOU!
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {bidPlayerName} leaves as part of the deal. Give the kid minutes and watch him climb
                toward {offeredIcon.prime}.
              </div>
            </div>
          )}

          {bidStage === "done" && bidResult === "lost" && (
            <div className="text-center py-2">
              <div className="text-4xl mb-1">😱</div>
              <div className="font-display text-xl text-primary">Outbid! A rival lands {offeredIcon.name}.</div>
              <div className="text-xs text-muted-foreground mt-1">
                He's gone for the rest of your career — and {bidPlayerName}, shopped around and going
                nowhere, starts next season unsettled.
              </div>
            </div>
          )}

          {bidStage === "done" && bidResult === "passed" && (
            <div className="text-center py-2">
              <div className="text-3xl mb-1">🤷</div>
              <div className="font-display text-base text-muted-foreground">
                You passed on {offeredIcon.name} — a rival snapped him up.
              </div>
            </div>
          )}
        </div>
      )}

      {/* 💰 Legends transfer market — sign all-time greats with your kitty. */}
      {stage === "menu" && (
        <LegendsBuyPanel
          remaining={remaining}
          pool={allPlayers}
          squad={workingSquad}
          yourReputation={yourReputation}
          signingsLeft={signingsLeft}
          clubStrengthOf={clubStrengthOf}
          onBuy={buyPlayer}
          onSell={sellPlayer}
        />
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

// ─── Real-mode transfer market ──────────────────────────────────────────

/** A proper market for Real mode: a budget (club wealth + prize money),
 *  buy any real player by fee, sell yours to raise funds. The real league
 *  persists — no random rival churn. */
function RealTransferMarket({
  season,
  budget,
  remaining,
  squad,
  pool,
  yourReputation,
  signingsLeft,
  clubStrengthOf,
  onBuy,
  onSell,
  onRelease,
  onContinue,
}: {
  season: number;
  budget: number;
  remaining: number;
  squad: Player[];
  pool: Player[];
  yourReputation: number;
  signingsLeft: number;
  clubStrengthOf: (clubId: string) => number;
  onBuy: (p: Player) => void;
  onSell: (idx: number) => void;
  onRelease: (idx: number) => void;
  onContinue: () => void;
}) {
  const [posFilter, setPosFilter] = useState<"All" | "GK" | "DEF" | "MID" | "FWD">("All");
  const squadKeys = new Set(squad.map((p) => `${p.club}:${p.name}`));
  const buyList = useMemo(
    () =>
      pool
        .filter((p) => !squadKeys.has(`${p.club}:${p.name}`))
        .filter((p) => posFilter === "All" || simplifyPosition(p.position) === posFilter)
        .sort((a, b) => b.prime_rating - a.prime_rating)
        .slice(0, 60),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, posFilter, squad],
  );

  return (
    <div className="min-h-screen px-4 py-8 max-w-3xl mx-auto">
      <header className="flex items-center justify-between gap-3">
        <Link to="/career" className="text-[11px] text-muted-foreground hover:text-warning underline">
          ← GOLAZO hub
        </Link>
        <div className="text-right">
          <div className="font-display text-2xl text-warning">Transfer market</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            End of Season {season}
          </div>
        </div>
      </header>

      {/* Budget */}
      <div className="mt-6 rounded-2xl border-2 border-warning bg-warning/10 p-5">
        <div className="flex items-center justify-between">
          <div className="font-display text-xl text-warning">💰 Transfer kitty</div>
          <div className="font-display text-2xl text-warning tabular-nums">{feeLabel(remaining)}</div>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Budget {feeLabel(budget)} · spent {feeLabel(budget - remaining)}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          ⭐ Reputation {yourReputation} · {signingsLeft} signing
          {signingsLeft === 1 ? "" : "s"} left this window. Big names need a big reputation — win
          trophies to attract them.
        </div>
      </div>

      {/* Your squad — sell to raise funds */}
      <section className="mt-6">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          Your squad ({squad.length}) — Sell for funds, or Release to trim
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {squad
            .map((p, i) => ({ p, i }))
            .sort((a, b) => b.p.prime_rating - a.p.prime_rating)
            .map(({ p, i }) => (
              <div
                key={`sell-${i}-${p.name}`}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {p.position} · {p.prime_rating}
                    {p.age != null ? ` · ${p.age}y` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onSell(i)}
                    className="text-[11px] px-2 py-1 rounded-md border border-success/40 text-success hover:bg-success/10"
                  >
                    Sell {feeLabel(sellValue(p.prime_rating, p.age ?? 27))}
                  </button>
                  <button
                    onClick={() => onRelease(i)}
                    title="Release for free (trim the squad)"
                    className="text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted/20"
                  >
                    Release
                  </button>
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* Buy */}
      <section className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Sign players</div>
          <div className="flex gap-1">
            {(["All", "GK", "DEF", "MID", "FWD"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setPosFilter(f)}
                className={`text-[10px] px-2 py-1 rounded-md border transition ${
                  posFilter === f
                    ? "border-warning bg-warning/15 text-warning"
                    : "border-border text-muted-foreground hover:border-foreground/30"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[28rem] overflow-y-auto">
          {buyList.map((p) => {
            const { status, price } = signStatus({
              rating: p.prime_rating,
              age: p.age ?? 27,
              sellingClubStrength: clubStrengthOf(p.club),
              yourReputation,
              remainingBudget: remaining,
              signingsLeft,
            });
            const ok = status === "ok";
            const label: Record<SignStatus, string> = {
              ok: feeLabel(price),
              "cant-afford": feeLabel(price),
              "wont-join": "Won't join",
              limit: "Limit",
            };
            return (
              <div
                key={`buy-${p.club}-${p.name}`}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {p.position} · {p.prime_rating}
                    {p.age != null ? ` · ${p.age}y` : ""}
                    {status === "wont-join" && " · rep too low"}
                  </div>
                </div>
                <button
                  disabled={!ok}
                  onClick={() => onBuy(p)}
                  title={
                    status === "wont-join"
                      ? "Your reputation is too low to attract him"
                      : status === "cant-afford"
                        ? "Not enough funds"
                        : status === "limit"
                          ? "No signings left this window"
                          : "Sign"
                  }
                  className={`shrink-0 text-[11px] px-2 py-1 rounded-md border transition ${
                    ok
                      ? "border-warning/50 text-warning hover:bg-warning/10"
                      : "border-border text-muted-foreground/50 cursor-not-allowed"
                  }`}
                >
                  {label[status]}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <button
        onClick={onContinue}
        className="mt-6 w-full px-4 py-3 rounded-md border-2 border-warning bg-warning/15 text-warning font-display tracking-wide hover:bg-warning/25 transition"
      >
        Continue to Season {season + 1} →
      </button>
    </div>
  );
}

// ─── Legends transfer market panel ──────────────────────────────────────

/** A collapsible buy/sell market for Legends mode, spending the club kitty
 *  on the all-time pool — alongside the swap window + wonderkid bidding. */
function LegendsBuyPanel({
  remaining,
  pool,
  squad,
  yourReputation,
  signingsLeft,
  clubStrengthOf,
  onBuy,
  onSell,
}: {
  remaining: number;
  pool: Player[];
  squad: Player[];
  yourReputation: number;
  signingsLeft: number;
  clubStrengthOf: (clubId: string) => number;
  onBuy: (p: Player) => void;
  onSell: (idx: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<"All" | "GK" | "DEF" | "MID" | "FWD">("All");
  const squadKeys = new Set(squad.map((p) => `${p.club}:${p.name}`));
  const buyList = useMemo(
    () =>
      pool
        .filter((p) => !squadKeys.has(`${p.club}:${p.name}`))
        .filter((p) => pos === "All" || simplifyPosition(p.position) === pos)
        .sort((a, b) => b.prime_rating - a.prime_rating)
        .slice(0, 40),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, pos, squad],
  );

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-display text-sm tracking-wide text-foreground/90">
          💰 Sign legends
          <span className="ml-2 text-[10px] text-warning normal-case">
            {feeLabel(remaining)} · ⭐{yourReputation} · {signingsLeft} left
          </span>
        </span>
        <span className={`text-warning transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          {/* Sell */}
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
            Sell to raise funds
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {squad
              .map((p, i) => ({ p, i }))
              .sort((a, b) => b.p.prime_rating - a.p.prime_rating)
              .slice(0, 8)
              .map(({ p, i }) => (
                <button
                  key={`ls-${i}-${p.name}`}
                  onClick={() => onSell(i)}
                  className="text-[11px] px-2 py-1 rounded-md border border-success/40 text-success hover:bg-success/10"
                  title={`Sell ${p.name}`}
                >
                  {p.name} {feeLabel(sellValue(p.prime_rating, p.age ?? 27))}
                </button>
              ))}
          </div>
          {/* Buy */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Buy</div>
            <div className="flex gap-1">
              {(["All", "GK", "DEF", "MID", "FWD"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setPos(f)}
                  className={`text-[10px] px-2 py-0.5 rounded-md border ${
                    pos === f ? "border-warning bg-warning/15 text-warning" : "border-border text-muted-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
            {buyList.map((p) => {
              const { status, price } = signStatus({
                rating: p.prime_rating,
                age: p.age ?? 27,
                sellingClubStrength: clubStrengthOf(p.club),
                yourReputation,
                remainingBudget: remaining,
                signingsLeft,
              });
              const ok = status === "ok";
              const label =
                status === "wont-join" ? "Won't join" : status === "limit" ? "Limit" : feeLabel(price);
              return (
                <div
                  key={`lb-${p.club}-${p.name}`}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium truncate">{p.name}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {p.position} · {p.prime_rating}
                    </span>
                  </span>
                  <button
                    disabled={!ok}
                    onClick={() => onBuy(p)}
                    className={`shrink-0 text-[11px] px-2 py-1 rounded-md border ${
                      ok ? "border-warning/50 text-warning hover:bg-warning/10" : "border-border text-muted-foreground/40 cursor-not-allowed"
                    }`}
                  >
                    {label}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
