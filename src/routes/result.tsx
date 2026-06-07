import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/store";
import { ClubBadge } from "@/components/ClubBadge";
import { getClubs } from "@/lib/data";
import { LEAGUES } from "@/lib/leagues";
import type { Club } from "@/lib/game-types";
import { squadRating, computeLeagueTable } from "@/lib/sim";
import { buildShareText, shareOrCopy } from "@/lib/share";
import { toPng } from "html-to-image";

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
  const { slots, matches, reset, config } = useGame();
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

      <ShareBlock />

      <div className="mt-10 flex justify-center gap-3 flex-wrap">
        <button
          onClick={() => {
            reset();
            navigate({ to: "/game", search: { new: true } });
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

  async function onShareText() {
    const text = buildShareText(config, slots, matches, config.challengeSeed);
    const r = await shareOrCopy(text, `${league.brandMark} ${league.tagline}`);
    setStatus(r === "shared" ? "Shared!" : "Copied to clipboard");
    setTimeout(() => setStatus(null), 2200);
  }
  async function onShareImage() {
    if (!cardRef.current) return;
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#0a0a0a",
      });
      const link = document.createElement("a");
      link.download = `unschlagbar-${config.league}.png`;
      link.href = dataUrl;
      link.click();
      setStatus("Image saved");
      setTimeout(() => setStatus(null), 2200);
    } catch {
      setStatus("Image failed");
      setTimeout(() => setStatus(null), 2200);
    }
  }

  const wins = matches.filter((m) => m.outcome === "W").length;
  const draws = matches.filter((m) => m.outcome === "D").length;
  const losses = matches.filter((m) => m.outcome === "L").length;
  const gf = matches.reduce((a, m) => a + m.ourScore, 0);
  const ga = matches.reduce((a, m) => a + m.theirScore, 0);
  const unbeaten = matches.length > 0 && losses === 0;

  return (
    <div className="mt-10">
      <div className="flex justify-center gap-2 flex-wrap">
        <button
          onClick={onShareText}
          className="px-5 py-2.5 rounded-xl border border-warning/50 bg-warning/10 text-warning font-display tracking-wide hover:bg-warning/20"
        >
          📋 Share recap
        </button>
        <button
          onClick={onShareImage}
          className="px-5 py-2.5 rounded-xl border border-foreground/20 hover:bg-card font-display tracking-wide"
        >
          🖼️ Save as image
        </button>
      </div>
      {status && <div className="mt-2 text-xs text-warning">{status}</div>}

      {/* Offscreen share card used for PNG export */}
      <div className="fixed -left-[9999px] top-0 pointer-events-none" aria-hidden>
        <div
          ref={cardRef}
          className="w-[640px] p-8 bg-background text-foreground"
          style={{ background: "linear-gradient(135deg, #0a0a0a, #1a0a14)" }}
        >
          <div className="flex items-baseline justify-between">
            <div className="brand-mark text-5xl text-warning leading-none">
              {league.brandMark.split(":")[0]}
              <span className="text-primary">:</span>
              {league.brandMark.split(":")[1]}
            </div>
            <div className="text-right">
              <div className="text-[10px] tracking-[0.3em] text-warning/80">{league.tagline}</div>
              <div className="text-xs text-muted-foreground">
                {league.flag} {league.name}
              </div>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-1.5">
            {slots.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded border border-white/10 bg-white/5 text-sm"
              >
                <span className="font-mono text-[10px] text-warning w-8">{s.position}</span>
                <span className="truncate">{s.player?.name ?? "—"}</span>
              </div>
            ))}
          </div>
          {matches.length > 0 && (
            <div className="mt-6 flex items-center justify-between px-3 py-2 rounded border border-warning/40 bg-warning/10">
              <div className="font-display text-2xl">
                <span className="text-success">{wins}</span>
                <span className="text-muted-foreground mx-1">·</span>
                <span className="text-warning">{draws}</span>
                <span className="text-muted-foreground mx-1">·</span>
                <span className="text-destructive">{losses}</span>
              </div>
              <div className="font-display text-xl tabular-nums">
                {gf}:{ga}
              </div>
              {unbeaten && (
                <div className="text-xs font-display tracking-widest text-warning">
                  ★ {league.unbeatenLabel} ★
                </div>
              )}
            </div>
          )}
          <div className="mt-4 text-[10px] text-muted-foreground text-center">
            unschlagbar.lovable.app
          </div>
        </div>
      </div>
    </div>
  );
}
