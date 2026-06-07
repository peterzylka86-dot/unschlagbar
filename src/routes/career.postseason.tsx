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
import { useMemo, useState } from "react";
import { useCareer } from "@/lib/career-store";
import { getPlayers } from "@/lib/data";
import type { LeagueId } from "@/lib/leagues";
import { detectStarDemands, normalizeName } from "@/lib/career-core";
import { isPositionCompatible } from "@/lib/draft-helpers";
import type { Player } from "@/lib/game-types";

export const Route = createFileRoute("/career/postseason")({
  head: () => ({ meta: [{ title: "Transfer window · GOLAZO" }] }),
  component: PostSeason,
});

type Stage = "events" | "demands" | "rebuild" | "ready";

/** When the user was relegated, they keep only their TOP 5 players and
 *  auto-draft replacements from a weaker pool. Encoded as the "Rebuild
 *  Season" flow — distinct UX from a normal transfer window. */
const RELEGATION_KEEP_TOP_N = 5;

function PostSeason() {
  const career = useCareer();
  const navigate = useNavigate();

  // All hooks unconditional (rules-of-hooks; see LEARNINGS.md L-1)
  const leagueId = (career.leagueId ?? "ucl") as LeagueId;
  const allPlayers = useMemo(() => getPlayers(leagueId), [leagueId]);

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
    return career.squad.filter((p) => {
      const key = `${p.club}:${normalizeName(p.name)}`;
      return (career.form[key] ?? 0) <= -2;
    });
  }, [career.squad, career.form]);

  const [stage, setStage] = useState<Stage>("events");
  const [decisionsByPlayer, setDecisionsByPlayer] = useState<Record<string, "keep" | "sell">>({});
  const [replacementsNeeded, setReplacementsNeeded] = useState<number>(0);
  const [newSignings, setNewSignings] = useState<Player[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // What positions does the user still need to fill? (After sells)
  // CRITICAL: this useMemo must be called unconditionally (rules-of-hooks).
  const remainingSquad = useMemo(() => {
    const soldKeys = new Set<string>();
    Object.entries(decisionsByPlayer).forEach(([nameKey, choice]) => {
      if (choice === "sell") soldKeys.add(nameKey);
    });
    coldPlayers.forEach((p) => soldKeys.add(normalizeName(p.name)));
    return career.squad.filter((p) => !soldKeys.has(normalizeName(p.name)));
  }, [career.squad, decisionsByPlayer, coldPlayers]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const usedKeys = new Set([
      ...career.squad.map((p) => normalizeName(p.name)),
      ...newSignings.map((p) => normalizeName(p.name)),
    ]);
    return allPlayers
      .filter((p) => p.name.toLowerCase().includes(q))
      .filter((p) => !usedKeys.has(normalizeName(p.name)))
      .sort((a, b) => b.prime_rating - a.prime_rating)
      .slice(0, 15);
  }, [searchQuery, allPlayers, career.squad, newSignings]);

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

  // Relegation override: if user was relegated last season, show the
  // "Rebuild Season" UX instead of the normal transfer window.
  if (career.relegatedLastSeason) {
    return (
      <RebuildSeasonCard
        career={career}
        onStart={() => {
          // Keep top 5 by rating; the draft route will fill the other 6
          const topN = [...career.squad]
            .sort((a, b) => b.prime_rating - a.prime_rating)
            .slice(0, RELEGATION_KEEP_TOP_N);
          // Honor the end-of-season star-demand "let them go" choice:
          // strip the departing player from the carried-over squad.
          const carried = career.pendingDeparture
            ? topN.filter((p) => `${p.club}:${p.name}` !== career.pendingDeparture)
            : topN;
          useCareer.setState({
            squad: carried,
            rivals: career.rivals.map((r) => ({ ...r, squad: [] })),
            form: {},
            relegatedLastSeason: false,
            currentSeason: career.currentSeason + 1,
            midSeasonSwapUsed: false, // fresh season → swap window resets
            pendingDeparture: null, // consumed
            starDemandResolved: false, // reset for next season's demand
          });
          navigate({ to: "/career/draft" });
        }}
      />
    );
  }

  function commitDecisions() {
    let sellCount = 0;
    Object.entries(decisionsByPlayer).forEach(([_, choice]) => {
      if (choice === "sell") sellCount++;
    });
    setReplacementsNeeded(sellCount + coldPlayers.length);
    setStage(sellCount + coldPlayers.length > 0 ? "rebuild" : "ready");
  }

  function addSigning(p: Player) {
    setNewSignings((prev) => [...prev, p]);
    setSearchQuery("");
    if (newSignings.length + 1 >= replacementsNeeded) {
      setStage("ready");
    }
  }

  function startNextSeason() {
    // Build the new squad: keep non-sold non-cold players + new signings
    const soldKeys = new Set<string>();
    Object.entries(decisionsByPlayer).forEach(([nameKey, choice]) => {
      if (choice === "sell") soldKeys.add(nameKey);
    });
    coldPlayers.forEach((p) => soldKeys.add(normalizeName(p.name)));

    const survivors = career.squad.filter((p) => !soldKeys.has(normalizeName(p.name)));
    // Honor the end-of-season star-demand "let them go" choice (if any):
    // strip the departing player from the survivors carrying into next season.
    const afterDeparture = career.pendingDeparture
      ? survivors.filter((p) => `${p.club}:${p.name}` !== career.pendingDeparture)
      : survivors;
    const newSquad = [...afterDeparture, ...newSignings];

    // Reset rivals' squads (they re-draft from scratch next season too,
    // following the same /career/draft flow). Clear form for a fresh slate.
    const refreshedRivals = career.rivals.map((r) => ({ ...r, squad: [] }));

    useCareer.setState({
      squad: [], // empty squad; the draft route will rebuild via commitDraft
      rivals: refreshedRivals,
      form: {},
      currentSeason: career.currentSeason + 1,
      midSeasonSwapUsed: false, // fresh season → swap window resets
      pendingDeparture: null, // consumed
      starDemandResolved: false, // reset for next season's demand
    });
    // The user's saved-XI carry-over: store the surviving players as
    // a "keep list" by setting them as initial squad before draft.
    // For now, pre-fill the squad with survivors so the user only drafts
    // (11 - survivors.length) new players in /career/draft.
    useCareer.setState({ squad: newSquad });
    navigate({ to: "/career/draft" });
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
            onContinue={() => setStage(hotPlayers.length > 0 ? "demands" : "rebuild")}
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
          <RebuildCard
            needed={replacementsNeeded}
            signed={newSignings.length}
            remainingSquad={remainingSquad}
            search={searchQuery}
            onSearch={setSearchQuery}
            results={searchResults}
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

// ─── sub-components ─────────────────────────────────────────────────

function FormEventsCard({
  hotPlayers,
  coldPlayers,
  onContinue,
}: {
  hotPlayers: Player[];
  coldPlayers: Player[];
  onContinue: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="font-display text-xl mb-1">📰 Form events</div>
      <div className="text-xs text-muted-foreground mb-4">
        Players whose season form ended in +2 or -2 territory.
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

function RebuildCard({
  needed,
  signed,
  remainingSquad,
  search,
  onSearch,
  results,
  onPick,
}: {
  needed: number;
  signed: number;
  remainingSquad: Player[];
  search: string;
  onSearch: (s: string) => void;
  results: Player[];
  onPick: (p: Player) => void;
}) {
  return (
    <div className="rounded-2xl border border-warning bg-warning/5 p-5">
      <div className="font-display text-xl mb-1">🔄 Squad rebuild</div>
      <div className="text-xs text-muted-foreground mb-4">
        Sign <span className="font-display text-warning">{needed - signed}</span> player
        {needed - signed === 1 ? "" : "s"} to refill empty slots.
        <span className="block mt-1">
          Survivors: <span className="text-warning">{remainingSquad.length}</span> · New signings:{" "}
          <span className="text-warning">{signed}</span>
        </span>
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search for a player to sign…"
        className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-warning transition"
      />
      {search.length >= 2 && results.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card/60 max-h-72 overflow-y-auto">
          {results.map((p) => (
            <li key={`${p.name}-${p.club}`}>
              <button
                onClick={() => onPick(p)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-warning/10 hover:text-warning transition"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {p.position} · {p.career_years} · {p.nationality}
                  </div>
                </div>
                <span className="shrink-0 font-display text-base px-2 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
                  {p.prime_rating}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {search.length >= 2 && results.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground text-center py-4">
          No matches. Try a different spelling.
        </p>
      )}
    </div>
  );
}

/**
 * Relegation rebuild — alternative UX when the user finished in the
 * bottom 2 of the league. Different vibe from a normal transfer window:
 *   - Keep only the top 5 players from your XI (by rating)
 *   - Auto-clear the rest of the squad
 *   - Next-season draft works as normal (you re-draft 6 new players;
 *     the wheel handles the pool)
 *   - No cup competition (you already lost league position)
 *
 * Matches the GOLAZO original "rebuild season" mechanic — relegation
 * has real consequences, not just a label.
 */
function RebuildSeasonCard({
  career,
  onStart,
}: {
  career: ReturnType<typeof useCareer.getState>;
  onStart: () => void;
}) {
  const top5 = [...career.squad]
    .sort((a, b) => b.prime_rating - a.prime_rating)
    .slice(0, RELEGATION_KEEP_TOP_N);
  return (
    <div className="min-h-screen px-4 py-8 max-w-2xl mx-auto">
      <header className="text-center">
        <Link
          to="/career"
          className="text-[11px] text-muted-foreground hover:text-warning underline"
        >
          ← GOLAZO hub
        </Link>
        <h1 className="mt-3 font-display text-3xl text-primary">📉 Rebuild Season</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          You were relegated. Time to rebuild from a smaller core.
        </p>
      </header>

      <div className="mt-8 rounded-2xl border-2 border-primary bg-primary/10 p-5">
        <div className="font-display text-lg text-primary mb-1">The rules</div>
        <ul className="text-sm space-y-1.5 text-foreground/85">
          <li>
            • You keep your <span className="text-primary">top {RELEGATION_KEEP_TOP_N}</span>{" "}
            players (by rating)
          </li>
          <li>• The other 6 slots get re-drafted next season</li>
          <li>• No cup competition — focus on getting back up</li>
        </ul>
      </div>

      <div className="mt-6">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Players you keep
        </div>
        <ul className="space-y-1.5">
          {top5.map((p, i) => (
            <li
              key={`${p.name}-${i}`}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-warning/40 bg-warning/5"
            >
              <div className="min-w-0">
                <div className="font-display text-sm truncate">{p.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {p.position} · {p.career_years} · {p.nationality}
                </div>
              </div>
              <span className="shrink-0 font-display text-base text-warning">{p.prime_rating}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={onStart}
        className="mt-8 w-full px-4 py-4 rounded-md bg-primary text-primary-foreground font-display text-lg tracking-wide hover:brightness-110 transition"
      >
        Start Rebuild Season {career.currentSeason + 1} →
      </button>
    </div>
  );
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
