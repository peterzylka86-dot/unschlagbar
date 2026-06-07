/**
 * /career/recap — season recap, shareable as text + image.
 *
 * Sits between the season/cup end and /career/postseason. Reads the most
 * recent entry from career.seasonHistory (already written by /career/season's
 * PostSeasonCTA, possibly updated by /career/cup's outcome handler).
 *
 * The recap card itself is one purposely-styled <div ref={cardRef}> so we
 * can render it to PNG via html-to-image — same pattern as /result.
 * Shows:
 *   - Header: GOLAZO logo, "Season N · Club name"
 *   - Big position with ordinal + champion/relegation badge
 *   - Cup result badge
 *   - Tactic view: SVG-ish pitch with player names in formation positions
 *   - W·D·L · GF:GA · Top scorer
 *   - Trophy chips
 *   - Brand footer
 *
 * Two share buttons (same UX as /result): 📋 share text, 📸 save image.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { useCareer } from "@/lib/career-store";
import type { SeasonRecord } from "@/lib/career-store";
import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";
import { getClubs } from "@/lib/data";
import { FORMATIONS } from "@/lib/formations";
import { isPositionCompatible } from "@/lib/draft-helpers";
import { normalizeName } from "@/lib/career-core";
import { shareOrCopy } from "@/lib/share";
import type { Player, Position } from "@/lib/game-types";

// A star starts demanding a transfer when their season-form crosses this
// threshold. Bumped from 2.0 → 2.5 after user feedback — at 2.0 every
// season triggered a demand; at 2.5 it's a genuine outlier event.
const STAR_DEMAND_THRESHOLD = 2.5;

export const Route = createFileRoute("/career/recap")({
  head: () => ({ meta: [{ title: "Season Recap · GOLAZO" }] }),
  component: CareerRecap,
});

function CareerRecap() {
  const career = useCareer();
  const cardRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const latest = career.seasonHistory[career.seasonHistory.length - 1] ?? null;
  const leagueId = (latest?.leagueId ?? career.leagueId ?? "ucl") as LeagueId;
  const clubs = useMemo(() => getClubs(leagueId), [leagueId]);
  const club = useMemo(
    () => clubs.find((c) => c.id === (latest?.foundingClubId ?? career.foundingClubId)) ?? null,
    [clubs, latest, career.foundingClubId],
  );

  // Demanding star: hottest-form non-franchise player ≥ +2.5. After-cup
  // moment (user spec: "Lewandowski wanting out at the very bottom makes
  // no sense...also it should come after the season is over including Cup").
  const demandingStar = useMemo(() => {
    if (career.starDemandResolved) return null;
    const enriched = career.squad
      .map((p) => ({
        player: p,
        formVal: career.form[`${p.club}:${normalizeName(p.name)}`] ?? 0,
      }))
      .filter((e) => e.formVal >= STAR_DEMAND_THRESHOLD)
      .filter((e) => `${e.player.club}:${e.player.name}` !== career.franchisePlayerKey)
      .sort((a, b) => b.formVal - a.formVal);
    return enriched[0]?.player ?? null;
  }, [career.squad, career.form, career.franchisePlayerKey, career.starDemandResolved]);

  // Assign the current squad to formation slots — same logic the draft uses.
  const assignedXI = useMemo(() => {
    if (!latest) return [] as Array<{ x: number; y: number; pos: Position; player: Player | null }>;
    const formation = FORMATIONS[latest.formation];
    const slots = formation.slots.map((s) => ({ ...s }));
    const assigned: Array<Player | null> = slots.map(() => null);
    const sorted = [...career.squad].sort((a, b) => b.prime_rating - a.prime_rating);
    // Greedy: each player goes to the best-fit empty slot
    for (const p of sorted) {
      for (let i = 0; i < slots.length; i++) {
        if (assigned[i]) continue;
        if (isPositionCompatible(slots[i].position, p.position)) {
          assigned[i] = p;
          break;
        }
      }
    }
    // Fallback: any unfilled slot gets any unplaced player
    const placedNames = new Set(assigned.filter(Boolean).map((p) => p!.name));
    const unplaced = career.squad.filter((p) => !placedNames.has(p.name));
    for (let i = 0; i < slots.length; i++) {
      if (assigned[i]) continue;
      assigned[i] = unplaced.shift() ?? null;
    }
    return slots.map((s, i) => ({
      x: s.x,
      y: s.y,
      pos: s.position,
      player: assigned[i],
    }));
  }, [latest, career.squad]);

  if (!latest) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        No season to recap yet. Head back to{" "}
        <Link to="/career" className="underline ml-1">
          /career
        </Link>
        .
      </div>
    );
  }

  const shareText = buildRecapText(latest, club?.name ?? "Your XI", LEAGUES[leagueId].name);

  async function onShareText() {
    const r = await shareOrCopy(shareText, "GOLAZO Career Recap");
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
      link.download = `golazo-season-${latest.season}-${(club?.short ?? "xi").toLowerCase()}.png`;
      link.href = dataUrl;
      link.click();
      setStatus("Image saved");
      setTimeout(() => setStatus(null), 2200);
    } catch {
      setStatus("Image failed");
      setTimeout(() => setStatus(null), 2200);
    }
  }

  return (
    <div className="min-h-screen px-4 py-8 max-w-2xl mx-auto">
      <header className="text-center mb-6">
        <Link
          to="/career"
          className="text-[11px] text-muted-foreground hover:text-warning underline"
        >
          ← GOLAZO hub
        </Link>
        <h1 className="mt-3 font-display text-2xl text-warning">Season Recap</h1>
      </header>

      {/* THE SHAREABLE CARD — html-to-image renders this <div> as PNG. */}
      <div
        ref={cardRef}
        className="rounded-3xl border-2 border-warning/60 p-6 sm:p-8"
        style={{
          background: "linear-gradient(135deg, rgba(250,204,21,0.18) 0%, rgba(10,10,10,1) 60%)",
          color: "#fafafa",
        }}
      >
        {/* Header */}
        <div className="flex items-baseline justify-between mb-4">
          <div className="brand-mark text-2xl text-warning leading-none">GOLAZO</div>
          <div className="text-[10px] tracking-[0.3em] text-warning/80 uppercase">
            Career · S{latest.season}
          </div>
        </div>

        {/* Club + position */}
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">
            {LEAGUES[leagueId].name}
          </div>
          <div className="font-display text-3xl sm:text-4xl text-warning leading-tight">
            {club?.name ?? "Your XI"}
          </div>
          <div className="mt-4 inline-flex items-baseline gap-2">
            <span className="font-display text-6xl sm:text-7xl text-warning leading-none">
              {latest.finalPosition}
              <span className="text-2xl">{ordinalSuffix(latest.finalPosition)}</span>
            </span>
          </div>
          <div
            className={`mt-1 font-display text-lg ${
              latest.finalPosition === 1
                ? "text-warning"
                : latest.relegated
                  ? "text-primary"
                  : "text-foreground/80"
            }`}
          >
            {latest.finalPosition === 1
              ? "🏆 League Champion"
              : latest.relegated
                ? "📉 Relegated"
                : `of ${latest.totalLeagueClubs}`}
          </div>
        </div>

        {/* Cup result badge */}
        {latest.cupResult !== "did-not-qualify" && (
          <div className="text-center mt-3">
            <span className="inline-block px-3 py-1 rounded-full bg-warning/15 border border-warning/40 text-warning text-xs uppercase tracking-widest">
              Cup · {cupLabel(latest.cupResult)}
            </span>
          </div>
        )}

        {/* Tactical pitch */}
        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 text-center">
            Tactic · {latest.formation}
          </div>
          <TacticPitch slots={assignedXI} franchiseKey={career.franchisePlayerKey} />
        </div>

        {/* Stats row */}
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Stat label="W·D·L" value={`${latest.wins}·${latest.draws}·${latest.losses}`} />
          <Stat label="Goals" value={`${latest.goalsFor}:${latest.goalsAgainst}`} />
          <Stat
            label="Top scorer"
            value={
              latest.topScorer
                ? `${shorten(latest.topScorer.name)} · ${latest.topScorer.goals}`
                : "—"
            }
          />
        </div>

        {/* Trophies */}
        {latest.trophies.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            {latest.trophies.map((t, i) => (
              <span
                key={i}
                className="px-2.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-warning/20 text-warning border border-warning/40"
              >
                🏆 {t}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-warning/20 text-center text-[10px] tracking-[0.25em] text-muted-foreground uppercase">
          unschlagbar.com · multi-season legacy
        </div>
      </div>

      {/* SHARE ROW (not part of the captured image) */}
      <div className="mt-6 flex justify-center gap-2 flex-wrap">
        <button
          onClick={onShareText}
          className="px-5 py-2.5 rounded-xl border border-warning/50 bg-warning/10 text-warning font-display tracking-wide hover:bg-warning/20"
        >
          📋 Share text
        </button>
        <button
          onClick={onShareImage}
          className="px-5 py-2.5 rounded-xl border border-foreground/20 hover:bg-card font-display tracking-wide"
        >
          📸 Save image
        </button>
      </div>
      {status && <div className="mt-3 text-center text-xs text-muted-foreground">{status}</div>}

      {/* END-OF-SEASON STAR DEMAND — fires only when a non-franchise player
          ended the season on form ≥ +2.5. Threshold tuned to make this
          genuinely rare (not every-season noise). Gates the Continue button
          until the user picks "Keep him" or "Let him go". */}
      {demandingStar && (
        <StarDemandCard
          player={demandingStar}
          onKeep={() => {
            career.setRerollsNextSeason(1);
            career.setPendingDeparture(null);
            career.setStarDemandResolved(true);
          }}
          onLetGo={() => {
            career.setPendingDeparture(`${demandingStar.club}:${demandingStar.name}`);
            career.setRerollsNextSeason(3);
            career.setStarDemandResolved(true);
          }}
        />
      )}

      {/* CONTINUE — disabled while a demand is unresolved */}
      <div className="mt-8 text-center">
        {demandingStar ? (
          <button
            disabled
            className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning/30 text-warning-foreground font-display text-base tracking-wide opacity-60 cursor-not-allowed"
            title="Answer the star demand first"
          >
            Continue to transfer window →
          </button>
        ) : (
          <Link
            to="/career/postseason"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning text-warning-foreground font-display text-base tracking-wide hover:brightness-110 transition"
          >
            Continue to transfer window →
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * End-of-season star demand card.
 *
 * Lives on /career/recap (not /career/season) so it fires AFTER the cup is
 * over and is shown alongside the recap visual context, not at the bottom
 * of a long match feed.
 */
function StarDemandCard({
  player,
  onKeep,
  onLetGo,
}: {
  player: Player;
  onKeep: () => void;
  onLetGo: () => void;
}) {
  return (
    <div className="mt-8 rounded-2xl border-2 border-primary bg-primary/10 p-6">
      <div className="text-center mb-4">
        <div className="text-4xl mb-1">💬</div>
        <div className="text-[11px] uppercase tracking-widest text-primary">Star demand</div>
        <div className="font-display text-2xl text-warning mt-2">{player.name} wants out</div>
        <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto">
          After a hot season, your{" "}
          <span className="text-warning">
            {player.position} · {player.prime_rating}
          </span>{" "}
          rated {player.name} feels they've outgrown the squad. Convince them to stay or let them
          walk.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-5">
        <button
          onClick={onKeep}
          className="rounded-xl border-2 border-warning bg-warning/15 hover:bg-warning/25 p-4 text-left transition"
        >
          <div className="font-display text-warning text-lg mb-1">Keep him</div>
          <div className="text-[11px] text-muted-foreground leading-relaxed">
            He stays. Cost: next draft starts with only{" "}
            <span className="text-warning">1 reroll</span> (instead of 3) — you'll be stuck with
            what the wheel gives you.
          </div>
        </button>
        <button
          onClick={onLetGo}
          className="rounded-xl border-2 border-primary/40 bg-primary/5 hover:bg-primary/15 p-4 text-left transition"
        >
          <div className="font-display text-primary text-lg mb-1">Let him go</div>
          <div className="text-[11px] text-muted-foreground leading-relaxed">
            He walks. You keep all <span className="text-warning">3 rerolls</span> for next draft,
            but the slot has to be re-drafted.
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────

function buildRecapText(record: SeasonRecord, clubName: string, leagueName: string): string {
  const lines: string[] = [];
  lines.push(`🏆 GOLAZO Career · Season ${record.season}`);
  lines.push(`${clubName} · ${leagueName}`);
  lines.push("");
  const ord = `${record.finalPosition}${ordinalSuffix(record.finalPosition)}`;
  if (record.finalPosition === 1) {
    lines.push(`👑 ${ord} place — LEAGUE CHAMPION`);
  } else if (record.relegated) {
    lines.push(`📉 ${ord} place — relegated`);
  } else {
    lines.push(`📊 Finished ${ord} of ${record.totalLeagueClubs}`);
  }
  if (record.cupResult !== "did-not-qualify") {
    lines.push(`Cup: ${cupLabel(record.cupResult)}`);
  }
  lines.push(`Record: ${record.wins}W · ${record.draws}D · ${record.losses}L`);
  lines.push(`Goals: ${record.goalsFor}:${record.goalsAgainst}`);
  if (record.topScorer) {
    lines.push(`⚽ Top scorer: ${record.topScorer.name} (${record.topScorer.goals})`);
  }
  if (record.trophies.length > 0) {
    lines.push(`Trophies: ${record.trophies.join(", ")}`);
  }
  lines.push("");
  lines.push(`Tactic: ${record.formation}`);
  lines.push(`Built on unschlagbar.com`);
  return lines.join("\n");
}

function cupLabel(r: SeasonRecord["cupResult"]): string {
  switch (r) {
    case "champion":
      return "🏆 Winner";
    case "runner-up":
      return "🥈 Runner-up";
    case "semi-final":
      return "🥉 Semi-final";
    case "quarter-final":
      return "Quarter-final";
    default:
      return "—";
  }
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function shorten(name: string, max = 14): string {
  if (name.length <= max) return name;
  const parts = name.split(" ");
  if (parts.length < 2) return name.slice(0, max - 1) + "…";
  return parts[0][0] + ". " + parts.slice(-1)[0];
}

// ─── tactic pitch ────────────────────────────────────────────────────────

function TacticPitch({
  slots,
  franchiseKey,
}: {
  slots: Array<{ x: number; y: number; pos: Position; player: Player | null }>;
  franchiseKey: string | null;
}) {
  // Aspect 4:5-ish, looks good in both portrait card + downloaded PNG.
  return (
    <div
      className="relative w-full mx-auto rounded-xl overflow-hidden"
      style={{
        aspectRatio: "5 / 6",
        background:
          "linear-gradient(180deg, rgba(34,197,94,0.18) 0%, rgba(22,101,52,0.25) 50%, rgba(34,197,94,0.18) 100%)",
        border: "1px solid rgba(250,204,21,0.25)",
      }}
    >
      {/* halfway line */}
      <div
        className="absolute left-0 right-0"
        style={{ top: "50%", height: 1, background: "rgba(255,255,255,0.12)" }}
      />
      <div
        className="absolute rounded-full"
        style={{
          left: "50%",
          top: "50%",
          width: 40,
          height: 40,
          transform: "translate(-50%, -50%)",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      />
      {/* penalty boxes */}
      <div
        className="absolute"
        style={{
          left: "20%",
          right: "20%",
          top: 0,
          height: "12%",
          border: "1px solid rgba(255,255,255,0.12)",
          borderTop: "none",
        }}
      />
      <div
        className="absolute"
        style={{
          left: "20%",
          right: "20%",
          bottom: 0,
          height: "12%",
          border: "1px solid rgba(255,255,255,0.12)",
          borderBottom: "none",
        }}
      />

      {/* Players */}
      {slots.map((s, i) => {
        const isFranchise = s.player && `${s.player.club}:${s.player.name}` === franchiseKey;
        return (
          <div
            key={`slot-${i}`}
            className="absolute flex flex-col items-center text-center"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              transform: "translate(-50%, -50%)",
              width: "22%",
            }}
          >
            <div
              className={`rounded-full font-display flex items-center justify-center mb-1 ${
                isFranchise ? "border-2" : "border"
              }`}
              style={{
                width: 32,
                height: 32,
                borderColor: isFranchise ? "#facc15" : "rgba(250,204,21,0.5)",
                background: isFranchise ? "rgba(250,204,21,0.25)" : "rgba(10,10,10,0.7)",
                color: "#facc15",
                fontSize: 11,
              }}
            >
              {isFranchise ? "⭐" : s.pos}
            </div>
            <div
              className="text-[10px] leading-tight px-1 rounded"
              style={{
                background: "rgba(10,10,10,0.65)",
                color: "#fafafa",
                maxWidth: "100%",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {s.player ? shorten(s.player.name, 12) : "—"}
            </div>
            {s.player && (
              <div className="text-[9px] font-display" style={{ color: "#facc15" }}>
                {s.player.prime_rating}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg py-2 px-1"
      style={{
        background: "rgba(10,10,10,0.5)",
        border: "1px solid rgba(250,204,21,0.2)",
      }}
    >
      <div
        className="font-display text-sm"
        style={{
          color: "#facc15",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground mt-0.5">
        {label}
      </div>
    </div>
  );
}
