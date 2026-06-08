import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/store";
import { ClubBadge } from "@/components/ClubBadge";
import { getClubs } from "@/lib/data";
import { LEAGUES } from "@/lib/leagues";
import type { Club, MatchResult } from "@/lib/game-types";
import { squadRating, computeLeagueTable, forecastSeasonPoints } from "@/lib/sim";
import { buildShareText, shareOrCopy, shareImage, challengeUrl } from "@/lib/share";
import { toPng } from "html-to-image";
import { isToday, saveDaily, dailyDateLabel } from "@/lib/daily";

export const Route = createFileRoute("/result")({
  validateSearch: (s: Record<string, unknown>) => ({
    unbeaten: s.unbeaten === true || s.unbeaten === "true",
  }),
  head: () => ({ meta: [{ title: "Result · UNSCHLAGBAR" }] }),
  component: ResultScreen,
});

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function ResultScreen() {
  const { unbeaten } = Route.useSearch();
  const { slots, matches, resetForNewRun, config } = useGame();
  const navigate = useNavigate();
  const league = LEAGUES[config.league];
  const isKO = league.kind !== "league";
  const CLUBS = useMemo(() => getClubs(config.league), [config.league]);
  const rating = squadRating(slots);
  const wins = matches.filter((m) => m.outcome === "W").length;
  const draws = matches.filter((m) => m.outcome === "D").length;
  const losses = matches.filter((m) => m.outcome === "L").length;
  const points = wins * 3 + draws;
  const firstLoss = matches.find((m) => m.outcome === "L");
  const eliminator = matches.find((m) => m.eliminates);
  const reachedFinal = matches.some((m) => m.round === "Final");
  const wonFinal = matches.some((m) => m.round === "Final" && m.outcome === "W");

  // Golden Boot + Playmaker — derived from per-match scorers attached by
  // /season. Older matches without scorers are skipped, so a season run
  // that pre-dates this feature renders without the badge (no crash).
  const { topScorer, topAssister } = useMemo(() => computeStarPerformers(matches), [matches]);

  // Daily Challenge: if the seed the user just played is today's seed AND
  // we have a result, persist it to localStorage so /daily and / can show
  // "you played today · streak X." First-play-wins is enforced inside
  // saveDaily (no overwrites on replay).
  useEffect(() => {
    if (!matches.length) return;
    if (config.challengeSeed == null) return;
    if (!isToday(config.challengeSeed)) return;
    saveDaily({
      seed: config.challengeSeed,
      wins,
      draws,
      losses,
      goalsFor: matches.reduce((a, m) => a + m.ourScore, 0),
      goalsAgainst: matches.reduce((a, m) => a + m.theirScore, 0),
      topScorer: topScorer ? { name: topScorer.name, goals: topScorer.goals } : undefined,
      playedAt: new Date().toISOString(),
      league: config.league,
    });
  }, [matches, config.challengeSeed, config.league, wins, draws, losses, topScorer]);

  const isDaily = config.challengeSeed != null && isToday(config.challengeSeed);

  // Overperformance score — only meaningful for league competitions.
  // Knockout/groupKO has a different success function (advance vs eliminate),
  // so we skip the forecast there and keep the trophy framing instead.
  //
  // The forecast is the analytic expected league points given THIS squad
  // against the actual season fixtures. delta > 0 means "your team beat
  // its forecast" — which is the Elevenary insight: succeeding with a
  // modest squad scores higher than winning everything with eleven
  // superstars. Bolts onto the binary unbeaten check without replacing it.
  const overperformance = useMemo(() => {
    if (isKO || !matches.length) return null;
    const seen = new Set<string>();
    const opps: Club[] = [];
    for (const m of matches) {
      if (!seen.has(m.opponent.id)) {
        seen.add(m.opponent.id);
        opps.push(m.opponent);
      }
    }
    const forecast = forecastSeasonPoints(opps, league.matches, rating);
    return { forecast, delta: points - forecast };
  }, [isKO, matches, league.matches, rating, points]);

  const { table, ourPosition } = useMemo(() => {
    if (isKO || !matches.length) return { table: [], ourPosition: 0 };
    const seen = new Set<string>();
    const opps: Club[] = [];
    for (const m of matches) {
      if (!seen.has(m.opponent.id)) {
        seen.add(m.opponent.id);
        opps.push(m.opponent);
      }
    }
    return computeLeagueTable(matches, opps, rating, league.matches);
  }, [matches, rating, league.matches, isKO]);

  const positionTone =
    ourPosition === 1
      ? "text-warning"
      : ourPosition <= 4
        ? "text-success"
        : ourPosition <= 10
          ? "text-foreground"
          : "text-destructive";

  return (
    <div className="min-h-screen px-4 py-12 max-w-3xl mx-auto text-center">
      {isKO ? (
        wonFinal ? (
          <>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-warning/40 bg-warning/10 text-warning text-xs font-semibold tracking-widest uppercase">
              🏆 {league.unbeatenLabel}
            </div>
            <h1 className="mt-6 brand-mark text-7xl text-warning">
              {league.brandMark.split(":")[0]}
              <span className="text-primary">:</span>
              {league.brandMark.split(":")[1]}
            </h1>
            <p className="mt-4 text-xl">
              Your XI lifted the trophy — {league.flag} {league.name}.
            </p>
          </>
        ) : (
          (() => {
            const groupExit = eliminator?.round === "Group";
            const groupMatches = matches.filter((m) => m.round === "Group");
            const groupPts = groupMatches.reduce(
              (a, m) => a + (m.outcome === "W" ? 3 : m.outcome === "D" ? 1 : 0),
              0,
            );
            return (
              <>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-destructive/40 bg-destructive/10 text-destructive text-xs font-semibold tracking-widest uppercase">
                  {groupExit
                    ? "Eliminated · Group Stage"
                    : `Eliminated${eliminator?.round ? ` · ${eliminator.round}` : ""}`}
                </div>
                <h1 className="mt-6 font-display text-6xl">
                  {wins}-{draws}-{losses}
                </h1>
                {groupExit ? (
                  <p className="mt-4 text-muted-foreground">
                    Crashed out in the group stage — {groupPts} {groupPts === 1 ? "pt" : "pts"} from{" "}
                    {groupMatches.length} matches. No knockout football this year.
                  </p>
                ) : eliminator ? (
                  <p className="mt-4 text-muted-foreground">
                    Knocked out {eliminator.home ? "vs" : "@"} {eliminator.opponent.name} (
                    {eliminator.ourScore}-{eliminator.theirScore}).
                  </p>
                ) : null}
              </>
            );
          })()
        )
      ) : unbeaten ? (
        <>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-success/40 bg-success/10 text-success text-xs font-semibold tracking-widest uppercase">
            ★ {league.unbeatenLabel} ★
          </div>
          <h1 className="mt-6 brand-mark text-8xl text-success">
            {league.brandMark.split(":")[0]}
            <span className="text-warning">:</span>
            {league.brandMark.split(":")[1]}
          </h1>
          <p className="mt-4 text-xl">
            Your XI went unbeaten — {league.flag} {league.name}.
          </p>
        </>
      ) : (
        <>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-destructive/40 bg-destructive/10 text-destructive text-xs font-semibold tracking-widest uppercase">
            Run ended
          </div>
          <h1 className="mt-6 font-display text-6xl">
            {wins}-{draws}-{losses}
          </h1>
          {firstLoss && (
            <p className="mt-4 text-muted-foreground">
              Dropped points on matchday {firstLoss.matchday} {firstLoss.home ? "vs" : "@"}{" "}
              {firstLoss.opponent.name} ({firstLoss.ourScore}-{firstLoss.theirScore}).
            </p>
          )}
        </>
      )}

      {/* KO recap strip */}
      {isKO && matches.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-2 text-left"
        >
          {matches.map((m, i) => {
            const tone =
              m.outcome === "W"
                ? "border-success/40 bg-success/5"
                : m.outcome === "D"
                  ? "border-warning/40 bg-warning/5"
                  : "border-destructive/40 bg-destructive/5";
            return (
              <div key={i} className={`rounded-lg border p-2 ${tone}`}>
                <div className="text-[9px] uppercase tracking-widest text-warning/80">
                  {m.round}
                </div>
                <div className="text-xs truncate mt-0.5">
                  {m.home ? "vs" : "@"} {m.opponent.short}
                </div>
                <div className="font-display text-base tabular-nums">
                  {m.ourScore}-{m.theirScore}
                </div>
              </div>
            );
          })}
          {!reachedFinal && (
            <div className="rounded-lg border border-dashed border-muted-foreground/30 p-2 text-muted-foreground">
              <div className="text-[9px] uppercase tracking-widest">Final</div>
              <div className="text-xs">—</div>
              <div className="font-display text-base">—</div>
            </div>
          )}
        </motion.div>
      )}

      {/* Overperformance card — league mode only. Shows actual vs forecast
          points so a 30-pt squad that beats its forecast feels like a win,
          not a failure. Hidden in KO modes where the success function is
          binary (advance vs eliminate). */}
      {overperformance && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className={`mt-6 inline-flex flex-col items-center gap-1 px-5 py-3 rounded-xl border-2 ${
            overperformance.delta > 0
              ? "border-success/40 bg-success/10"
              : overperformance.delta < 0
                ? "border-destructive/40 bg-destructive/10"
                : "border-warning/40 bg-warning/10"
          }`}
        >
          <div className="text-[10px] uppercase tracking-[0.25em] opacity-80">
            vs Forecast
          </div>
          <div
            className={`font-display text-2xl tabular-nums ${
              overperformance.delta > 0
                ? "text-success"
                : overperformance.delta < 0
                  ? "text-destructive"
                  : "text-warning"
            }`}
          >
            {overperformance.delta > 0 ? "+" : ""}
            {overperformance.delta.toFixed(1)} pts
          </div>
          <div className="text-[10px] text-muted-foreground">
            you {points} · forecast {overperformance.forecast.toFixed(1)}
          </div>
        </motion.div>
      )}

      {/* Final position scoreboard (league only) */}
      {!isKO && ourPosition > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-8 inline-flex items-stretch gap-0 rounded-xl overflow-hidden border-2 border-warning/40 shadow-[0_0_40px_-12px] shadow-warning/40"
        >
          <div className="px-5 py-3 bg-card/70 text-left">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Final position
            </div>
            <div className={`font-display text-4xl leading-none mt-1 ${positionTone}`}>
              {ordinal(ourPosition)}
              <span className="text-sm text-muted-foreground ml-1">/ {table.length}</span>
            </div>
          </div>
          <div className="px-5 py-3 scoreboard text-left tabular-nums flex flex-col justify-center">
            <div className="text-[10px] opacity-70">PTS</div>
            <div className="text-2xl">{points}</div>
          </div>
        </motion.div>
      )}

      {/* League table */}
      {table.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mt-8 text-left rounded-xl border bg-card/40 overflow-hidden"
        >
          <div className="px-3 py-2 border-b text-[10px] uppercase tracking-[0.2em] text-muted-foreground bg-background/50">
            {league.tableTitle}
          </div>
          <div className="divide-y divide-border/50">
            {table.map((row, i) => {
              const pos = i + 1;
              const zone =
                pos === 1
                  ? "border-l-warning"
                  : pos <= 4
                    ? "border-l-success"
                    : pos <= 6
                      ? "border-l-success/50"
                      : pos >= table.length - 2
                        ? "border-l-destructive"
                        : "border-l-transparent";
              return (
                <div
                  key={row.short + i}
                  className={`grid grid-cols-[28px_1fr_28px_28px_28px_44px_36px] sm:grid-cols-[28px_1fr_28px_28px_28px_60px_44px] items-center gap-2 px-3 py-1.5 text-xs tabular-nums border-l-4 ${zone} ${
                    row.isUs ? "bg-warning/10 font-semibold" : ""
                  }`}
                >
                  <div className="text-muted-foreground font-mono">{pos}</div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ background: row.color }}
                    />
                    <span className="truncate">{row.name}</span>
                  </div>
                  <div className="text-success/80">{row.w}</div>
                  <div className="text-warning/80">{row.d}</div>
                  <div className="text-destructive/80">{row.l}</div>
                  <div className="text-muted-foreground hidden sm:block">
                    {row.gf}:{row.ga}
                  </div>
                  <div className="font-display text-sm text-right">{row.pts}</div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <div className="mt-10">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Your XI · {rating} overall
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {slots.map((s) => {
            const club = s.player ? CLUBS.find((c) => c.id === s.player!.club) : null;
            return (
              <div
                key={s.id}
                className="flex items-center gap-2 p-2 rounded-lg border bg-card text-left"
              >
                {club && <ClubBadge club={club} size={32} />}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">{s.position}</div>
                  <div className="text-sm truncate">{s.player?.name ?? "—"}</div>
                </div>
                {s.player && (
                  <div className="font-display text-base text-warning">{s.player.prime_rating}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily badge — only shown when this run was today's daily. */}
      {isDaily && (
        <div className="mt-8 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-warning/40 bg-warning/10 text-warning text-[10px] font-semibold tracking-widest uppercase">
          🗓️ Daily Challenge · {dailyDateLabel(config.challengeSeed!)}
        </div>
      )}

      {/* Golden Boot + Playmaker — appears only when scorer data is present
          (Quick Match runs from /season enrich matches; older runs that
          never had scorers attached will silently skip this block). */}
      {(topScorer || topAssister) && (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md mx-auto">
          {topScorer && (
            <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-left">
              <div className="text-[10px] uppercase tracking-[0.25em] text-warning/80">
                ⚽ Golden Boot
              </div>
              <div className="font-display text-base truncate mt-1">{topScorer.name}</div>
              <div className="text-xs text-muted-foreground">
                {topScorer.goals} {topScorer.goals === 1 ? "goal" : "goals"}
              </div>
            </div>
          )}
          {topAssister && (
            <div className="rounded-xl border border-success/40 bg-success/5 px-4 py-3 text-left">
              <div className="text-[10px] uppercase tracking-[0.25em] text-success/80">
                🅰️ Playmaker
              </div>
              <div className="font-display text-base truncate mt-1">{topAssister.name}</div>
              <div className="text-xs text-muted-foreground">
                {topAssister.assists} {topAssister.assists === 1 ? "assist" : "assists"}
              </div>
            </div>
          )}
        </div>
      )}

      <ShareBlock />

      <div className="mt-10 flex justify-center gap-3 flex-wrap">
        <button
          onClick={() => {
            // Same league + formation, fresh squad. Go straight to the
            // wheel — skip the mode/setup screen since config is unchanged.
            // resetForNewRun() also wipes challengeSeed/challengerScore/
            // foundingPlayer so the next run gets fresh fixtures + no
            // stale H2H panel from a finished challenge.
            resetForNewRun();
            navigate({ to: "/draft" });
          }}
          className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-display tracking-wide hover:brightness-110"
        >
          New Run
        </button>
        <Link
          to="/"
          className="px-6 py-3 rounded-xl border hover:bg-card font-display tracking-wide"
        >
          Home
        </Link>
      </div>
    </div>
  );
}

function ShareBlock() {
  const { slots, matches, config } = useGame();
  const league = LEAGUES[config.league];
  const cardRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [renderingImage, setRenderingImage] = useState(false);

  // Re-derive locally so ShareBlock is self-contained — the parent
  // component already computes the same thing for on-screen display, but
  // passing props in would couple the two more tightly than needed.
  const { topScorer, topAssister } = useMemo(() => computeStarPerformers(matches), [matches]);
  const isDailyShare =
    config.challengeSeed != null && isToday(config.challengeSeed);

  // Overperformance — only computed for league mode (KO uses a different
  // success function). Mirrors the parent's computation.
  const overperformanceShare = useMemo(() => {
    if (league.kind !== "league" || !matches.length) return null;
    const seen = new Set<string>();
    const opps: Club[] = [];
    for (const m of matches) {
      if (!seen.has(m.opponent.id)) {
        seen.add(m.opponent.id);
        opps.push(m.opponent);
      }
    }
    const f = forecastSeasonPoints(opps, league.matches, squadRating(slots));
    const wins_ = matches.filter((m) => m.outcome === "W").length;
    const draws_ = matches.filter((m) => m.outcome === "D").length;
    const pts = wins_ * 3 + draws_;
    return { forecast: f, delta: pts - f };
  }, [matches, slots, league.kind, league.matches]);

  async function onShareText() {
    const text = buildShareText(config, slots, matches, config.challengeSeed);
    const r = await shareOrCopy(text, `${league.brandMark} ${league.tagline}`);
    setStatus(r === "shared" ? "Shared!" : "Copied to clipboard");
    setTimeout(() => setStatus(null), 2200);
  }
  async function onShareImage() {
    if (!cardRef.current) return;
    setRenderingImage(true);
    try {
      // Pre-warm fonts before rasterizing — html-to-image samples whatever
      // is currently in the cache, so if our display font (Bebas/Inter/etc)
      // hasn't been faulted in yet, we capture a fallback and the card
      // looks generic. `document.fonts.ready` resolves once the browser
      // has all currently-requested fonts loaded. Cheap, sometimes nothing,
      // worth doing.
      if (typeof document !== "undefined" && (document as Document & { fonts?: FontFaceSet }).fonts) {
        try {
          await (document as Document & { fonts: FontFaceSet }).fonts.ready;
        } catch {
          /* font load timeout — proceed anyway */
        }
      }
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#0a0a0a",
        // Render at the card's own intrinsic dimensions (1080×1080 set on
        // the offscreen element) — no transform scaling.
      });
      const filename = `unschlagbar-${config.league}-${config.challengeSeed ?? Date.now()}.png`;
      const text = buildShareText(config, slots, matches, config.challengeSeed);
      const result = await shareImage(dataUrl, filename, text, `${league.brandMark}`);
      setStatus(
        result === "shared"
          ? "Shared!"
          : result === "copied"
            ? "Image copied — paste in WhatsApp / X / Slack"
            : result === "downloaded"
              ? "Image saved"
              : "Image failed",
      );
      // Slightly longer toast for "copied" so the user sees the paste hint.
      setTimeout(() => setStatus(null), result === "copied" ? 3500 : 2200);
    } catch {
      setStatus("Image failed");
      setTimeout(() => setStatus(null), 2200);
    } finally {
      setRenderingImage(false);
    }
  }

  const wins = matches.filter((m) => m.outcome === "W").length;
  const draws = matches.filter((m) => m.outcome === "D").length;
  const losses = matches.filter((m) => m.outcome === "L").length;
  const gf = matches.reduce((a, m) => a + m.ourScore, 0);
  const ga = matches.reduce((a, m) => a + m.theirScore, 0);
  const unbeaten = matches.length > 0 && losses === 0;

  async function onChallengeFriend() {
    // Build the URL with the EXACT same seed the user just played. Friend
    // opens the link → same league, formation, difficulty, fixtures.
    // They draft their own squad and we compare points. Asymmetric
    // multiplayer with zero backend.
    const seed = config.challengeSeed ?? Math.floor(Math.random() * 1e9);
    const url = challengeUrl({
      league: config.league,
      formation: config.formation,
      difficulty: config.difficulty,
      ratingMode: config.ratingMode,
      draftMode: config.draftMode,
      showRatings: config.showRatings,
      seed,
      // Embed THIS user's score so the receiver sees what to beat.
      challenger: {
        wins,
        draws,
        losses,
        goalsFor: gf,
        goalsAgainst: ga,
      },
    });
    const userPts = wins * 3 + draws;
    const verb = config.challengerScore ? "Returning fire — your turn." : "Beat my run.";
    const inviteText = `${verb}\n\n${league.name} · ${wins}W ${draws}D ${losses}L · ${userPts} pts · ${gf}:${ga} goals${unbeaten ? " 🏆 UNBEATEN" : ""}\n\n${url}`;
    const r = await shareOrCopy(inviteText, "Beat my UNSCHLAGBAR run");
    setStatus(r === "shared" ? "Challenge sent!" : "Link copied — paste anywhere");
    setTimeout(() => setStatus(null), 2200);
  }

  const userPts = wins * 3 + draws;
  const them = config.challengerScore;
  const themPts = them ? them.wins * 3 + them.draws : null;
  const youWon = themPts !== null && userPts > themPts;
  const youLost = themPts !== null && userPts < themPts;
  const tied = themPts !== null && userPts === themPts;

  return (
    <div className="mt-10">
      {/* Head-to-head comparison panel — appears only when the URL carried
          a challenger's score. This is the async multiplayer payoff:
          "you 55 vs them 52 — you win this one." */}
      {them && themPts !== null && (
        <div
          className={`mb-6 max-w-md mx-auto p-5 rounded-2xl border-2 text-center ${
            youWon
              ? "border-success bg-success/10"
              : youLost
                ? "border-primary bg-primary/10"
                : "border-warning bg-warning/10"
          }`}
        >
          <div className="text-[10px] uppercase tracking-[0.25em] mb-2 opacity-80">
            🎯 Head-to-head
          </div>
          <div className="grid grid-cols-3 items-center gap-2">
            <div>
              <div className="font-display text-3xl tabular-nums">{userPts}</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
                You
              </div>
            </div>
            <div className="font-display text-base text-muted-foreground">vs</div>
            <div>
              <div className="font-display text-3xl tabular-nums opacity-70">{themPts}</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
                {them.name ?? "Friend"}
              </div>
            </div>
          </div>
          <div
            className={`mt-3 font-display text-sm ${
              youWon ? "text-success" : youLost ? "text-primary" : "text-warning"
            }`}
          >
            {youWon
              ? `🏆 You win by ${userPts - themPts} pt${userPts - themPts === 1 ? "" : "s"}!`
              : youLost
                ? `Lost by ${themPts - userPts} pt${themPts - userPts === 1 ? "" : "s"} — return fire ↩`
                : `Tied at ${userPts} pts — split decision`}
          </div>
        </div>
      )}

      <div className="flex flex-col items-stretch gap-2 max-w-md mx-auto">
        {/* Primary: native share with image attached. The image IS the
            challenge invite — recipient can tap to play. */}
        <button
          onClick={onShareImage}
          disabled={renderingImage}
          className="px-5 py-3 rounded-xl bg-primary text-primary-foreground font-display tracking-wide hover:brightness-110 transition shadow-[0_10px_30px_-10px] shadow-primary/60 disabled:opacity-60 disabled:cursor-wait"
        >
          {renderingImage ? "Rendering…" : "📸 Share image"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onChallengeFriend}
            className="px-4 py-2.5 rounded-xl border border-warning/50 bg-warning/10 text-warning font-display tracking-wide hover:bg-warning/20 transition"
          >
            {them ? "↩ Return fire" : "🎯 Challenge a friend"}
          </button>
          <button
            onClick={onShareText}
            className="px-4 py-2.5 rounded-xl border border-border hover:bg-card font-display tracking-wide transition"
          >
            📋 Copy recap
          </button>
        </div>
      </div>
      {status && <div className="mt-3 text-xs text-warning text-center">{status}</div>}

      {/* Offscreen share card used for PNG export — 1080×1080 (Instagram /
          X feed friendly). The on-screen recap doubles as the share artifact
          but we render a dedicated card so we control layout + watermark
          regardless of viewport size. Off-screen positioning means it
          never paints visibly. */}
      <div className="fixed -left-[9999px] top-0 pointer-events-none" aria-hidden>
        <div
          ref={cardRef}
          className="text-foreground"
          style={{
            width: "1080px",
            height: "1350px", // 4:5 portrait — Instagram/X-feed/WhatsApp
            // friendly and fits the XI list + Golden Boot + watermark
            // without clipping. Square (1080×1080) was too tight.
            background:
              "radial-gradient(circle at 30% 0%, rgba(250,204,21,0.18) 0%, transparent 55%), linear-gradient(135deg, #050505 0%, #0a0a0a 60%, #1a0a14 100%)",
            padding: "64px",
            display: "flex",
            flexDirection: "column",
            fontFamily:
              '"Inter", "Helvetica Neue", system-ui, -apple-system, sans-serif',
            color: "#fafafa",
          }}
        >
          {/* Top stripe — retro pixel accent */}
          <div
            style={{
              height: "8px",
              background:
                "repeating-linear-gradient(90deg, #facc15 0 12px, transparent 12px 24px)",
              opacity: 0.85,
            }}
          />

          {/* Hero block — brand mark dominates */}
          <div style={{ marginTop: "44px", textAlign: "center" }}>
            {isDailyShare && (
              <div
                style={{
                  display: "inline-block",
                  padding: "8px 18px",
                  borderRadius: "999px",
                  border: "1px solid rgba(250,204,21,0.4)",
                  background: "rgba(250,204,21,0.1)",
                  fontSize: "16px",
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  color: "#facc15",
                  marginBottom: "20px",
                }}
              >
                🗓️ Daily · {dailyDateLabel(config.challengeSeed!)}
              </div>
            )}
            <div
              style={{
                fontFamily: '"Bebas Neue", "Anton", Impact, sans-serif',
                fontSize: "220px",
                lineHeight: 0.85,
                letterSpacing: "0.02em",
                color: unbeaten ? "#22c55e" : "#facc15",
              }}
            >
              {league.brandMark.split(":")[0]}
              <span style={{ color: "#ef4444" }}>:</span>
              {league.brandMark.split(":")[1]}
            </div>
            <div
              style={{
                marginTop: "12px",
                fontSize: "22px",
                letterSpacing: "0.32em",
                textTransform: "uppercase",
                color: "#facc15",
              }}
            >
              {unbeaten ? `★ ${league.unbeatenLabel} ★` : league.tagline}
            </div>
            <div style={{ marginTop: "8px", fontSize: "22px", color: "#a3a3a3" }}>
              {league.flag} {league.name}
            </div>
          </div>

          {/* Score line — chunky, scoreboard feel */}
          {matches.length > 0 && (
            <div
              style={{
                marginTop: "44px",
                display: "flex",
                justifyContent: "center",
                alignItems: "baseline",
                gap: "28px",
                fontFamily: '"Bebas Neue", "Anton", Impact, sans-serif',
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "108px", color: "#22c55e", lineHeight: 1 }}>{wins}</div>
                <div style={{ fontSize: "16px", letterSpacing: "0.3em", color: "#737373" }}>W</div>
              </div>
              <div style={{ fontSize: "60px", color: "#525252" }}>·</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "108px", color: "#facc15", lineHeight: 1 }}>{draws}</div>
                <div style={{ fontSize: "16px", letterSpacing: "0.3em", color: "#737373" }}>D</div>
              </div>
              <div style={{ fontSize: "60px", color: "#525252" }}>·</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "108px", color: "#ef4444", lineHeight: 1 }}>{losses}</div>
                <div style={{ fontSize: "16px", letterSpacing: "0.3em", color: "#737373" }}>L</div>
              </div>
              <div
                style={{
                  marginLeft: "28px",
                  paddingLeft: "28px",
                  borderLeft: "2px solid rgba(255,255,255,0.12)",
                  textAlign: "center",
                }}
              >
                <div
                  style={{ fontSize: "68px", color: "#fafafa", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}
                >
                  {gf}:{ga}
                </div>
                <div style={{ fontSize: "16px", letterSpacing: "0.3em", color: "#737373" }}>
                  GOALS
                </div>
              </div>
            </div>
          )}

          {/* Overperformance pill — league mode only. The Elevenary insight:
              a modest XI beating its forecast scores higher than a stacked
              XI grinding out a perfect record. Reframes "33-1" as a win. */}
          {overperformanceShare && (
            <div
              style={{
                marginTop: "20px",
                alignSelf: "center",
                padding: "10px 22px",
                borderRadius: "999px",
                border: `2px solid ${
                  overperformanceShare.delta > 0
                    ? "rgba(34,197,94,0.5)"
                    : overperformanceShare.delta < 0
                      ? "rgba(239,68,68,0.5)"
                      : "rgba(250,204,21,0.5)"
                }`,
                background:
                  overperformanceShare.delta > 0
                    ? "rgba(34,197,94,0.12)"
                    : overperformanceShare.delta < 0
                      ? "rgba(239,68,68,0.12)"
                      : "rgba(250,204,21,0.12)",
                display: "flex",
                alignItems: "baseline",
                gap: "14px",
              }}
            >
              <span style={{ fontSize: "14px", letterSpacing: "0.3em", color: "#a3a3a3" }}>
                VS FORECAST
              </span>
              <span
                style={{
                  fontFamily: '"Bebas Neue", "Anton", Impact, sans-serif',
                  fontSize: "34px",
                  lineHeight: 1,
                  color:
                    overperformanceShare.delta > 0
                      ? "#22c55e"
                      : overperformanceShare.delta < 0
                        ? "#ef4444"
                        : "#facc15",
                }}
              >
                {overperformanceShare.delta > 0 ? "+" : ""}
                {overperformanceShare.delta.toFixed(1)} PTS
              </span>
            </div>
          )}

          {/* Top scorer (only if data present) + XI list in a 2-col layout */}
          <div
            style={{
              marginTop: "40px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "20px",
              flex: 1,
            }}
          >
            {/* Left: XI roster */}
            <div
              style={{
                padding: "20px",
                borderRadius: "16px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div
                style={{
                  fontSize: "14px",
                  letterSpacing: "0.3em",
                  textTransform: "uppercase",
                  color: "#facc15",
                  marginBottom: "12px",
                }}
              >
                Your XI · {squadRating(slots)} OVR
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {slots.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      fontSize: "20px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: '"JetBrains Mono", "Menlo", monospace',
                        fontSize: "14px",
                        color: "#facc15",
                        width: "44px",
                        flexShrink: 0,
                      }}
                    >
                      {s.position}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.player?.name ?? "—"}
                    </span>
                    {s.player && (
                      <span
                        style={{
                          fontFamily: '"Bebas Neue", "Anton", Impact, sans-serif',
                          fontSize: "22px",
                          color: "#facc15",
                          flexShrink: 0,
                        }}
                      >
                        {s.player.prime_rating}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Golden Boot + meta */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {topScorer && (
                <div
                  style={{
                    padding: "20px",
                    borderRadius: "16px",
                    border: "1px solid rgba(250,204,21,0.4)",
                    background: "rgba(250,204,21,0.08)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "14px",
                      letterSpacing: "0.3em",
                      textTransform: "uppercase",
                      color: "#facc15",
                      marginBottom: "8px",
                    }}
                  >
                    ⚽ Golden Boot
                  </div>
                  <div
                    style={{
                      fontFamily: '"Bebas Neue", "Anton", Impact, sans-serif',
                      fontSize: "44px",
                      lineHeight: 1.05,
                    }}
                  >
                    {topScorer.name}
                  </div>
                  <div style={{ fontSize: "22px", color: "#a3a3a3", marginTop: "4px" }}>
                    {topScorer.goals} {topScorer.goals === 1 ? "goal" : "goals"}
                  </div>
                </div>
              )}
              {topAssister && (
                <div
                  style={{
                    padding: "20px",
                    borderRadius: "16px",
                    border: "1px solid rgba(34,197,94,0.4)",
                    background: "rgba(34,197,94,0.06)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "14px",
                      letterSpacing: "0.3em",
                      textTransform: "uppercase",
                      color: "#22c55e",
                      marginBottom: "8px",
                    }}
                  >
                    🅰️ Playmaker
                  </div>
                  <div
                    style={{
                      fontFamily: '"Bebas Neue", "Anton", Impact, sans-serif',
                      fontSize: "36px",
                      lineHeight: 1.05,
                    }}
                  >
                    {topAssister.name}
                  </div>
                  <div style={{ fontSize: "20px", color: "#a3a3a3", marginTop: "4px" }}>
                    {topAssister.assists} {topAssister.assists === 1 ? "assist" : "assists"}
                  </div>
                </div>
              )}
              {/* Difficulty + formation chips fill remaining space */}
              <div
                style={{
                  marginTop: "auto",
                  padding: "16px 20px",
                  borderRadius: "16px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "18px",
                  color: "#a3a3a3",
                }}
              >
                <span>{config.formation}</span>
                <span style={{ textTransform: "uppercase", letterSpacing: "0.2em" }}>
                  {config.difficulty}
                </span>
              </div>
            </div>
          </div>

          {/* Footer watermark */}
          <div
            style={{
              marginTop: "32px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingTop: "16px",
              borderTop: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div
              style={{
                fontFamily: '"Bebas Neue", "Anton", Impact, sans-serif',
                fontSize: "24px",
                color: "#facc15",
                letterSpacing: "0.18em",
              }}
            >
              UNSCHLAGBAR
            </div>
            <div
              style={{
                fontSize: "18px",
                color: "#a3a3a3",
                letterSpacing: "0.18em",
              }}
            >
              unschlagbar.lovable.app
            </div>
          </div>

          {/* Bottom stripe — mirrors top */}
          <div
            style={{
              marginTop: "16px",
              height: "8px",
              background:
                "repeating-linear-gradient(90deg, #facc15 0 12px, transparent 12px 24px)",
              opacity: 0.85,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Tally goals + assists across a season's match feed. Returns the single
 *  top scorer and top assister (ties broken by first-seen, deterministic
 *  since the match feed itself is seeded). Returns nulls if no scorer
 *  data is present on the matches (e.g. an older run that ran before
 *  /season started enriching matches with scorers). */
export function computeStarPerformers(matches: MatchResult[]): {
  topScorer: { name: string; goals: number } | null;
  topAssister: { name: string; assists: number } | null;
} {
  const goals = new Map<string, number>();
  const assists = new Map<string, number>();
  matches.forEach((m) => {
    m.scorers?.forEach((s) => {
      goals.set(s.name, (goals.get(s.name) ?? 0) + 1);
      if (s.assister) assists.set(s.assister, (assists.get(s.assister) ?? 0) + 1);
    });
  });
  let topScorer: { name: string; goals: number } | null = null;
  goals.forEach((g, name) => {
    if (!topScorer || g > topScorer.goals) topScorer = { name, goals: g };
  });
  let topAssister: { name: string; assists: number } | null = null;
  assists.forEach((a, name) => {
    if (!topAssister || a > topAssister.assists) topAssister = { name, assists: a };
  });
  return { topScorer, topAssister };
}
