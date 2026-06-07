/**
 * /career/postseason — transfer window between seasons.
 *
 * Triggered by /career/season's "Continue to post-season →" CTA after
 * the league table is finalized. Three GOLAZO-canonical events happen
 * in sequence here:
 *
 *   1. FORM EVENTS — surface hot/cold players. The +2 form players are
 *      'demanding a transfer' and will leave if you don't act. The -2
 *      form players you can sell to free up a slot.
 *
 *   2. STAR DEMANDS — for each hot-form player, the user chooses:
 *      keep them (re-sign + reset form) OR sell them (frees slot).
 *
 *   3. SQUAD REBUILD — for each freed slot, user picks a replacement
 *      via a quick search picker (uses the same FoundingPlayerPicker
 *      pattern as Quick Match's Founding Player).
 *
 * Uses career-core primitives (already tested):
 *   - detectStarDemands(squad, formMap, threshold) → [Player]
 *   - normalizeName(name) for matching form keys
 *
 * On completion: increment career.currentSeason, clear form (fresh
 * slate next season), reset rivals' squads for redraft. Navigate to
 * /career/draft for the next season.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useCareer } from "@/lib/career-store";
import { getCareerClubs, getCareerPlayers } from "@/lib/data";
import {
  detectStarDemands,
  normalizeName,
  pickSpinClub,
  simplifyPosition,
} from "@/lib/career-core";
import { isPositionCompatible } from "@/lib/draft-helpers";
import type { Club, Player } from "@/lib/game-types";

export const Route = createFileRoute("/career/postseason")({
  head: () => ({ meta: [{ title: "Transfer window · GOLAZO" }] }),
  component: PostSeason,
});

type Stage = "events" | "demands" | "rebuild" | "ready";

/** When relegated, the squad culls down to the TOP N by rating — the rest
 *  are force-sold and must be re-signed via spin in the rebuild stage.
 *  Distinct cliff from a normal transfer window (1-3 cold players). */
const RELEGATION_KEEP_TOP_N = 5;

function PostSeason() {
  const career = useCareer();
  const navigate = useNavigate();

  // All hooks unconditional (rules-of-hooks; see LEARNINGS.md L-1)
  const allPlayers = useMemo(
    () => getCareerPlayers(career.foundingClubId),
    [career.foundingClubId],
  );
  const allClubs = useMemo(() => getCareerClubs(career.foundingClubId), [career.foundingClubId]);

  // Build a {normalized name : form} map for star-demand detection
  const formMap = useMemo(() => {
    const out: Record<string, { form: number }> = {};
    Object.entries(career.form).forEach(([key, val]) => {
      // career.form keys are `${club}:${normalized name}`. detectStarDemands
      // expects just the normalized name keyed in.
      const name = key.split(":").slice(1).join(":");
      out[name] = { form: val };
    });
    return out;
  }, [career.form]);

  const hotPlayers = useMemo(() => {
    return detectStarDemands(career.squad, formMap, 2);
  }, [career.squad, formMap]);

  const coldPlayers = useMemo(() => {
    const isFranchise = (p: Player) => `${p.club}:${p.name}` === career.franchisePlayerKey;
    const naturallyCold = career.squad.filter((p) => {
      if (isFranchise(p)) return false; // franchise is untouchable
      const key = `${p.club}:${normalizeName(p.name)}`;
      return (career.form[key] ?? 0) <= -2;
    });
    // RELEGATION OVERRIDE: also force-sell the bottom (squad.length - KEEP_TOP_N)
    // by rating. Same effective KEEP_TOP_N as the old "relegation rebuild"
    // screen, but routes through the SAME spin-rebuild UX as a normal
    // transfer — no /career/draft re-draft needed.
    if (!career.relegatedLastSeason) return naturallyCold;
    const sortedByRating = [...career.squad]
      .filter((p) => !isFranchise(p))
      .sort((a, b) => b.prime_rating - a.prime_rating);
    const forced = sortedByRating.slice(RELEGATION_KEEP_TOP_N); // bottom N
    const seen = new Set(naturallyCold.map((p) => normalizeName(p.name)));
    const additional = forced.filter((p) => !seen.has(normalizeName(p.name)));
    return [...naturallyCold, ...additional];
  }, [career.squad, career.form, career.relegatedLastSeason, career.franchisePlayerKey]);

  const [stage, setStage] = useState<Stage>("events");
  const [decisionsByPlayer, setDecisionsByPlayer] = useState<Record<string, "keep" | "sell">>({});
  const [newSignings, setNewSignings] = useState<Player[]>([]);

  // The players LEAVING the squad — the positions they vacate are what the
  // user must replace via spin-rebuild. Drives the spin queue order +
  // "need a [POSITION]" hint per replacement.
  const departingPlayers = useMemo(() => {
    const sold = career.squad.filter((p) => decisionsByPlayer[normalizeName(p.name)] === "sell");
    const coldNames = new Set(coldPlayers.map((p) => normalizeName(p.name)));
    const cold = career.squad.filter((p) => coldNames.has(normalizeName(p.name)));
    const departureKey = career.pendingDeparture;
    const departed = departureKey
      ? career.squad.filter((p) => `${p.club}:${p.name}` === departureKey)
      : [];
    // Dedupe — a player could be both hot-sell and pending-departure
    const seenKeys = new Set<string>();
    const all = [...sold, ...cold, ...departed].filter((p) => {
      const k = `${p.club}:${p.name}`;
      if (seenKeys.has(k)) return false;
      seenKeys.add(k);
      return true;
    });
    return all;
  }, [career.squad, decisionsByPlayer, coldPlayers, career.pendingDeparture]);

  // What positions does the user still need to fill? (After sells)
  // CRITICAL: this useMemo must be called unconditionally (rules-of-hooks).
  const remainingSquad = useMemo(() => {
    const departingKeys = new Set(departingPlayers.map((p) => `${p.club}:${p.name}`));
    return career.squad.filter((p) => !departingKeys.has(`${p.club}:${p.name}`));
  }, [career.squad, departingPlayers]);

  // Belt-and-suspenders: if we land in the rebuild stage and there's
  // genuinely nothing to rebuild, auto-advance to ready. Catches any
  // edge case where the user enters rebuild then a state change wipes
  // departingPlayers (e.g. "keep" after "sell" toggle).
  useEffect(() => {
    if (stage === "rebuild" && departingPlayers.length === 0) {
      setStage("ready");
    }
  }, [stage, departingPlayers.length]);

  // Render guards — AFTER all hooks. See LEARNINGS.md L-1.
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

  // (Relegation no longer redirects to a separate /career/draft re-draft.
  // It flows through the SAME events → demands → rebuild → ready stages,
  // with the bottom-N players auto-marked as "cold" forced-sells. See
  // coldPlayers useMemo above.)

  function commitDecisions() {
    const needsRebuild = departingPlayers.length > 0;
    setStage(needsRebuild ? "rebuild" : "ready");
  }

  function addSigning(p: Player) {
    setNewSignings((prev) => {
      const next = [...prev, p];
      if (next.length >= departingPlayers.length) {
        setStage("ready");
      }
      return next;
    });
  }

  function startNextSeason() {
    // Final squad: survivors (everyone NOT in departingPlayers) + new signings.
    const newSquad = [...remainingSquad, ...newSignings];

    // AI rivals carry their squads forward and undergo a small auto-turnover
    // (a couple of cheap swaps each) to keep the league dynamic without
    // forcing the user through a /career/draft re-draft screen.
    const refreshedRivals = autoTurnoverRivals(career.rivals, allPlayers, newSquad);

    useCareer.setState({
      squad: newSquad,
      rivals: refreshedRivals,
      form: {},
      currentSeason: career.currentSeason + 1,
      midSeasonSwapUsed: false, // fresh season → swap window resets
      relegatedLastSeason: false, // consumed
      pendingDeparture: null, // consumed
      starDemandResolved: false, // reset for next season's demand
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

      {/* Stage stepper */}
      <div className="mt-6 flex gap-1 text-[10px] uppercase tracking-[0.18em]">
        {(["events", "demands", "rebuild", "ready"] as Stage[]).map((s, idx) => {
          const isCurrent = s === stage;
          const isPast = ["events", "demands", "rebuild", "ready"].indexOf(stage) > idx;
          return (
            <div
              key={s}
              className={`flex-1 py-2 px-2 text-center rounded ${
                isCurrent
                  ? "bg-warning text-warning-foreground"
                  : isPast
                    ? "bg-warning/20 text-warning/70"
                    : "bg-card text-muted-foreground"
              }`}
            >
              {idx + 1}. {s}
            </div>
          );
        })}
      </div>

      {/* Stage content */}
      <div className="mt-6">
        {stage === "events" && (
          <FormEventsCard
            hotPlayers={hotPlayers}
            coldPlayers={coldPlayers}
            isRelegated={career.relegatedLastSeason}
            onContinue={() => {
              // BUG FIX: previously we always jumped to "rebuild" when no
              // hot players, but if nothing was leaving (no cold, no
              // pending departure) the rebuild stage stuck at "All slots
              // filled" with no advance. Skip straight to "ready" when
              // nobody's leaving.
              if (hotPlayers.length > 0) setStage("demands");
              else if (departingPlayers.length > 0) setStage("rebuild");
              else setStage("ready");
            }}
          />
        )}

        {stage === "demands" && (
          <DemandsCard
            hotPlayers={hotPlayers}
            decisions={decisionsByPlayer}
            onDecide={(name, choice) =>
              setDecisionsByPlayer((prev) => ({ ...prev, [normalizeName(name)]: choice }))
            }
            onContinue={commitDecisions}
            canContinue={hotPlayers.every(
              (p) => decisionsByPlayer[normalizeName(p.name)] !== undefined,
            )}
          />
        )}

        {stage === "rebuild" && (
          <SpinRebuildCard
            departing={departingPlayers}
            signings={newSignings}
            allClubs={allClubs}
            allPlayers={allPlayers}
            currentSquad={remainingSquad}
            onPick={addSigning}
          />
        )}

        {stage === "ready" && (
          <ReadyCard
            survivorsCount={remainingSquad.length}
            signingsCount={newSignings.length}
            nextSeason={career.currentSeason + 1}
            onStart={startNextSeason}
          />
        )}
      </div>
    </div>
  );
}

// ─── AI rival rebuild (no /career/draft re-draft needed) ───────────────

/**
 * Each AI rival keeps the core of their squad and undergoes a couple of
 * cheap swaps to simulate the offseason. Drops one weakest player, picks
 * one mid-pool replacement of the same simplified bucket. Repeats twice.
 *
 * Kept INSIDE postseason (not /career/draft) so the user doesn't have to
 * sit through a fresh snake draft just to watch AI rivals retool.
 *
 * If a rival's squad is empty (legacy save / fresh career), the function
 * doesn't manufacture players — empty squads are tolerated by the season
 * simulator (it falls back to a base strength).
 */
function autoTurnoverRivals<R extends { squad: Player[]; archetypeStyle?: string }>(
  rivals: R[],
  pool: Player[],
  userSquad: Player[],
): R[] {
  const userKeys = new Set(userSquad.map((p) => `${p.club}:${p.name}`));
  // Bucket pool by simplified position for cheap same-bucket replacement.
  const byBucket: Record<string, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of pool) {
    const bucket = simplifyPosition(p.position);
    if (byBucket[bucket]) byBucket[bucket].push(p);
  }
  // Sort each bucket by rating desc — top candidates first
  for (const b of Object.values(byBucket)) {
    b.sort((a, b2) => b2.prime_rating - a.prime_rating);
  }
  return rivals.map((r, idx) => {
    if (r.squad.length === 0) return r;
    let squad = [...r.squad];
    // Two cheap swaps per rival
    for (let swap = 0; swap < 2; swap++) {
      const weakest = [...squad].sort((a, b) => a.prime_rating - b.prime_rating)[0];
      if (!weakest) break;
      const bucket = simplifyPosition(weakest.position);
      const taken = new Set([...squad.map((p) => `${p.club}:${p.name}`), ...userKeys]);
      // Deterministic per-rival offset so different rivals pick different
      // replacements from the same bucket.
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

// ─── sub-components ─────────────────────────────────────────────────

function FormEventsCard({
  hotPlayers,
  coldPlayers,
  isRelegated,
  onContinue,
}: {
  hotPlayers: Player[];
  coldPlayers: Player[];
  isRelegated: boolean;
  onContinue: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="font-display text-xl mb-1">
        {isRelegated ? "📉 Relegation rebuild" : "📰 Form events"}
      </div>
      <div className="text-xs text-muted-foreground mb-4">
        {isRelegated
          ? `You were relegated. Top ${RELEGATION_KEEP_TOP_N} stay; everyone else is forced out and replaced via spin.`
          : "Players whose season form ended in +2 or -2 territory."}
      </div>

      <div className="space-y-3">
        {hotPlayers.length > 0 ? (
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-warning mb-1">
              🔥 Hot form
            </div>
            <ul className="space-y-1">
              {hotPlayers.map((p) => (
                <li
                  key={p.name}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 rounded bg-warning/10 border border-warning/30 text-sm"
                >
                  <span>
                    <span className="font-display">{p.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{p.position}</span>
                  </span>
                  <span className="text-[11px] text-warning italic">demands a transfer</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {coldPlayers.length > 0 ? (
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-primary mb-1">
              ❄️ Cold form
            </div>
            <ul className="space-y-1">
              {coldPlayers.map((p) => (
                <li
                  key={p.name}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-sm"
                >
                  <span>
                    <span className="font-display">{p.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{p.position}</span>
                  </span>
                  <span className="text-[11px] text-primary italic">auto-sold (slot frees up)</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hotPlayers.length === 0 && coldPlayers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center italic">
            No form events this season. Your squad rolls over unchanged.
          </p>
        ) : null}
      </div>

      <button
        onClick={onContinue}
        className="mt-5 w-full px-4 py-3 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
      >
        Continue →
      </button>
    </div>
  );
}

function DemandsCard({
  hotPlayers,
  decisions,
  onDecide,
  onContinue,
  canContinue,
}: {
  hotPlayers: Player[];
  decisions: Record<string, "keep" | "sell">;
  onDecide: (name: string, choice: "keep" | "sell") => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  return (
    <div className="rounded-2xl border border-warning bg-warning/10 p-5">
      <div className="font-display text-xl text-warning mb-1">🔥 Star demands</div>
      <div className="text-xs text-muted-foreground mb-4">
        These players are on fire. Keep them (re-sign at full OVR) or sell to free a slot.
      </div>
      <ul className="space-y-2">
        {hotPlayers.map((p) => {
          const key = normalizeName(p.name);
          const choice = decisions[key];
          return (
            <li
              key={p.name}
              className="flex items-center justify-between gap-2 p-3 rounded border border-warning/40 bg-card/30"
            >
              <div className="min-w-0">
                <div className="font-display text-sm truncate">{p.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {p.position} · OVR {p.prime_rating} · {p.career_years}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => onDecide(p.name, "keep")}
                  className={`px-3 py-1.5 rounded text-xs font-display tracking-wide transition ${
                    choice === "keep"
                      ? "bg-success text-success-foreground"
                      : "border border-border text-foreground hover:border-success"
                  }`}
                >
                  Keep
                </button>
                <button
                  onClick={() => onDecide(p.name, "sell")}
                  className={`px-3 py-1.5 rounded text-xs font-display tracking-wide transition ${
                    choice === "sell"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-foreground hover:border-primary"
                  }`}
                >
                  Sell
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        onClick={onContinue}
        disabled={!canContinue}
        className={`mt-4 w-full px-4 py-3 rounded-md font-display tracking-wide transition ${
          canContinue
            ? "bg-warning text-warning-foreground hover:brightness-110"
            : "bg-muted/30 text-muted-foreground cursor-not-allowed"
        }`}
      >
        {canContinue ? "Continue →" : "Decide on each star first"}
      </button>
    </div>
  );
}

/**
 * SpinRebuildCard — same flavor as the mid-season swap window, but multi-
 * step. For each player leaving (sold / cold / forced-by-relegation /
 * pending-departure), the user spins a random club, then picks one
 * compatible-position player from that club. No type-to-search. No skip
 * — you commit to a replacement per slot.
 *
 * Matches the user spec: "Squad rebuild should not work as 'I select a
 * player' but should be random...The player I want to sell needs to be
 * replaced by the same position but it still a draw...random...and I
 * need to make a pick."
 */
function SpinRebuildCard({
  departing,
  signings,
  allClubs,
  allPlayers,
  currentSquad,
  onPick,
}: {
  departing: Player[];
  signings: Player[];
  allClubs: Club[];
  allPlayers: Player[];
  currentSquad: Player[];
  onPick: (p: Player) => void;
}) {
  const [spinStage, setSpinStage] = useState<"prompt" | "spinning" | "picking">("prompt");
  const [spunClub, setSpunClub] = useState<Club | null>(null);
  // Remember the last few clubs the wheel landed on so the next spin can
  // AVOID them. Without this, vanilla Math.random can repeat the same
  // club two-three spins in a row, which feels broken even when it isn't.
  const [recentClubIds, setRecentClubIds] = useState<string[]>([]);
  const RECENT_HISTORY = 5;

  const currentIdx = signings.length; // which departure we're filling next
  const target = departing[currentIdx];

  // Set of player keys already in any squad — keep replacements fresh.
  const drafted = useMemo(() => {
    const s = new Set<string>();
    currentSquad.forEach((p) => s.add(`${p.club}:${p.name}`));
    signings.forEach((p) => s.add(`${p.club}:${p.name}`));
    return s;
  }, [currentSquad, signings]);

  if (!target) {
    // All replacements done — Ready stage will render on next tick.
    return (
      <div className="rounded-2xl border border-warning bg-warning/5 p-5 text-center">
        <div className="font-display text-xl text-warning">All slots filled</div>
        <div className="text-xs text-muted-foreground mt-1">
          Continuing to season {/* parent will switch stage */}…
        </div>
      </div>
    );
  }

  function spin() {
    setSpinStage("spinning");
    setTimeout(() => {
      // Only land on clubs that have ≥1 undrafted player of compatible
      // position. Same logic as the mid-season swap window — no dead-ends.
      const eligible = allClubs.filter((c) =>
        allPlayers.some(
          (p) =>
            p.club === c.id &&
            !drafted.has(`${p.club}:${p.name}`) &&
            isPositionCompatible(target.position, p.position),
        ),
      );
      // pickSpinClub avoids any club in recentClubIds when possible — fixes
      // user-reported bug: "the spin always brings me players from the
      // same club...it needs to be random."
      let pick = pickSpinClub(eligible, recentClubIds);
      if (!pick) {
        // Fall through: NO compatible-position candidates left. Open up to
        // any-position pool so the user can still complete the rebuild.
        const fallback = allClubs.filter((c) =>
          allPlayers.some((p) => p.club === c.id && !drafted.has(`${p.club}:${p.name}`)),
        );
        pick = pickSpinClub(fallback, recentClubIds);
      }
      if (!pick) return; // No clubs at all — extremely unlikely, bail.
      setSpunClub(pick);
      setRecentClubIds((prev) => [pick.id, ...prev].slice(0, RECENT_HISTORY));
      setSpinStage("picking");
    }, 700);
  }

  function pickPlayer(p: Player) {
    onPick(p);
    setSpunClub(null);
    setSpinStage("prompt");
  }

  // PROMPT stage — show who's leaving and a Spin button
  if (spinStage === "prompt") {
    return (
      <div className="rounded-2xl border border-warning bg-warning/5 p-5">
        <div className="text-[10px] uppercase tracking-widest text-warning mb-1">
          Replacement {currentIdx + 1} of {departing.length}
        </div>
        <div className="font-display text-xl">Find a new {target.position}</div>
        <div className="text-xs text-muted-foreground mt-1">
          <span className="line-through opacity-70">{target.name}</span> ({target.position} ·{" "}
          {target.prime_rating}) is leaving. Spin the wheel — same position required.
        </div>
        <button
          onClick={spin}
          className="mt-4 w-full px-4 py-3 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
        >
          🎰 Spin for a {target.position}
        </button>
      </div>
    );
  }

  if (spinStage === "spinning") {
    return (
      <div className="rounded-2xl border-2 border-warning bg-warning/10 p-8 text-center">
        <div className="text-5xl animate-spin inline-block">🎰</div>
        <div className="mt-3 text-sm text-muted-foreground">Drawing a {target.position}…</div>
      </div>
    );
  }

  // PICKING stage — wheel landed on spunClub, show compatible-position players
  if (spinStage === "picking" && spunClub) {
    const pool = allPlayers
      .filter((p) => p.club === spunClub.id && !drafted.has(`${p.club}:${p.name}`))
      .filter((p) => isPositionCompatible(target.position, p.position))
      .sort((a, b) => b.prime_rating - a.prime_rating)
      .slice(0, 12);
    return (
      <div className="rounded-2xl border-2 border-warning bg-warning/10 p-5">
        <div className="text-center mb-4">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Wheel landed on
          </div>
          <div className="font-display text-2xl text-warning">{spunClub.name}</div>
          <div className="text-xs text-muted-foreground mt-1">
            Pick your new {target.position} — you have to commit.
          </div>
        </div>
        {pool.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center italic">
            No compatible {target.position}s at {spunClub.name}.
            <button
              onClick={spin}
              className="block mx-auto mt-3 px-4 py-2 rounded text-xs border border-warning/40 text-warning hover:bg-warning/10"
            >
              Spin again
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {pool.map((p) => (
              <button
                key={`in-${p.name}-${p.club}`}
                onClick={() => pickPlayer(p)}
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

  return null;
}

function ReadyCard({
  survivorsCount,
  signingsCount,
  nextSeason,
  onStart,
}: {
  survivorsCount: number;
  signingsCount: number;
  nextSeason: number;
  onStart: () => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-warning bg-warning/10 p-6 text-center">
      <div className="text-4xl mb-2">⚽</div>
      <div className="font-display text-2xl text-warning mb-2">Ready for Season {nextSeason}</div>
      <div className="text-sm text-muted-foreground mb-1">
        Squad:{" "}
        <span className="text-warning font-display">{survivorsCount + signingsCount}/11</span>
      </div>
      <div className="text-xs text-muted-foreground mb-5">
        {survivorsCount} survivors · {signingsCount} new signings. The wheel will fill any remaining
        slots from your league pool.
      </div>
      <button
        onClick={onStart}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning text-warning-foreground font-display text-base tracking-wide hover:brightness-110 transition"
      >
        Start Season {nextSeason} →
      </button>
    </div>
  );
}
