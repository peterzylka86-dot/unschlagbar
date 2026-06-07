/**
 * /career/draft — the GOLAZO snake draft against AI rivals.
 *
 * This is the heart of Career mode. Five AI managers, each with a founding
 * club + archetype, draft against you in snake order (round 1: 1→N, round
 * 2: N→1, round 3: 1→N, …). 11 rounds because every manager needs an XI.
 *
 * Rules:
 *   - Round 1, pick 1 for each manager: MUST be from their own founding
 *     club. This is the GOLAZO "founding club" mechanic.
 *   - All subsequent picks: the manager spins for any club; pick any
 *     player from that club's pool who isn't already taken.
 *   - Once a player is picked by any manager, no one else can pick them.
 *   - AI manager picks are computed via scorePlayerByArchetype from
 *     career-core, then processed instantly so the user doesn't wait.
 *
 * On completion (all managers have 11 players), the user can advance to
 * the season-flow screen (next commit — currently shows "Squad ready").
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useCareer } from "@/lib/career-store";
import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/leagues";
import { getClubs, getPlayers } from "@/lib/data";
import { FORMATIONS } from "@/lib/formations";
import { isPositionCompatible } from "@/lib/draft-helpers";
import {
  buildAIManagers,
  snakePickerId,
  positionsNeeded,
  scorePlayerByArchetype,
  simplifyPosition,
  DEFAULT_ARCHETYPES,
  type AIManager,
  type SimplePosition,
  type FormationNeed,
} from "@/lib/career-core";
import type { Club, Player, Position } from "@/lib/game-types";

export const Route = createFileRoute("/career/draft")({
  head: () => ({ meta: [{ title: "Draft · GOLAZO" }] }),
  component: CareerDraft,
});

// 12-manager league (user + 11 AI rivals) — matches the GOLAZO league sizing
// we fixed yesterday (was capped at 8 by the archetype-slice bug; the
// buildAIManagers fix recycles archetypes when n > pool, so 11 works).
const AI_RIVALS_COUNT = 11;
const SQUAD_SIZE = 11;
// 4-3-3 default for now — could read from career config later
const FORMATION_NEED: FormationNeed = { G: 1, D: 4, M: 3, F: 3 };

// Simple Mulberry32 seeded RNG so the same career produces the same draft
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Manager {
  id: string;
  name: string;
  badge: string;
  color: string;
  archetypeStyle: string;
  archetypeName: string;
  foundingClubId: string;
  isUser: boolean;
  squad: Player[];
}

interface DraftSnapshot {
  managers: Manager[];
  draftOrder: string[];      // round-1 manager id sequence
  currentRound: number;
  currentPickInRound: number;
  usedPlayerKeys: Set<string>;
  currentClubId: string | null;   // when user's spin lands on a club
}

function playerKey(p: Player): string {
  return `${p.club}:${p.name}`;
}

function CareerDraft() {
  const career = useCareer();
  const navigate = useNavigate();

  // Guard: no active career → bounce to hub.
  // CRITICAL: this useEffect runs unconditionally. The "if not ready" check
  // happens at the END of the component via `notReady` render guard.
  // DO NOT return early before the other hooks — React's rules-of-hooks
  // requires the same hook count + order every render.
  useEffect(() => {
    if (!career.foundingClubId || !career.leagueId) {
      navigate({ to: "/career" });
    }
  }, [career.foundingClubId, career.leagueId, navigate]);

  // Use safe fallback ID for hooks even when career isn't ready — these
  // hooks must always be called, but their results are discarded when we
  // bail out at the end.
  const leagueId = (career.leagueId ?? "ucl") as LeagueId;
  const allClubs = useMemo(() => getClubs(leagueId), [leagueId]);
  const allPlayers = useMemo(() => getPlayers(leagueId), [leagueId]);
  const userClub = useMemo(
    () => allClubs.find(c => c.id === career.foundingClubId) ?? null,
    [allClubs, career.foundingClubId],
  );

  // ─── Initialize draft state once on mount ─────────────────────────────
  const [draft, setDraft] = useState<DraftSnapshot | null>(null);

  useEffect(() => {
    if (draft) return;
    const seed = career.startedAt ? hashString(career.startedAt) : 12345;
    const rand = mulberry32(seed);

    // Build AI rivals from the league's clubs (excluding the user's founding)
    const otherClubs = allClubs
      .filter(c => c.id !== career.foundingClubId)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, AI_RIVALS_COUNT * 3);  // top pool to pick from
    const archetypes = DEFAULT_ARCHETYPES;
    const ais = buildAIManagers(
      AI_RIVALS_COUNT,
      userClub?.name ?? "",
      archetypes,
      otherClubs.map(c => ({
        name: c.name,
        letter: c.short.slice(0, 3),
        bg: c.color,
        fg: "#ffffff",
      })),
      rand,
    );

    // Map back to club ids (buildAIManagers uses name only)
    const aiManagers: Manager[] = ais.map((ai, i) => {
      const club = allClubs.find(c => c.name === ai.foundingClub);
      return {
        id: ai.id,
        name: ai.archName,
        badge: ai.badge,
        color: club?.color ?? "#666",
        archetypeStyle: ai.archetype,
        archetypeName: ai.archName,
        foundingClubId: club?.id ?? "",
        isUser: false,
        squad: [],
      };
    });

    const userManager: Manager = {
      id: "user",
      name: "You",
      badge: userClub?.short ?? "U",
      color: userClub?.color ?? "#facc15",
      archetypeStyle: "user",
      archetypeName: "You",
      foundingClubId: career.foundingClubId!,
      isUser: true,
      squad: [],
    };

    // Random draft order — user slot is random within the order
    const allManagers = [userManager, ...aiManagers];
    const order = [...allManagers].sort(() => rand() - 0.5).map(m => m.id);

    setDraft({
      managers: allManagers,
      draftOrder: order,
      currentRound: 1,
      currentPickInRound: 1,
      usedPlayerKeys: new Set(),
      currentClubId: null,
    });
  }, [draft, allClubs, allPlayers, career, userClub]);

  // ─── Drive the draft forward through AI picks ─────────────────────────
  useEffect(() => {
    if (!draft) return;
    if (draft.currentRound > SQUAD_SIZE) return;
    const onClockId = snakePickerId(draft.draftOrder, draft.currentRound, draft.currentPickInRound);
    if (!onClockId) return;
    const onClock = draft.managers.find(m => m.id === onClockId);
    if (!onClock) return;
    if (onClock.isUser) return;  // wait for user input

    // AI pick — run via setTimeout so the UI breathes between AI turns
    const timer = setTimeout(() => processAIPick(onClock), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // Auto-spin on user's turn (rounds 2+) — no manual click required.
  // User feedback: "I don't need to spin every time...but rather just land
  // on the club that I picked." Founding pick (round 1) doesn't need spin;
  // it's already founding-club-only.
  useEffect(() => {
    if (!draft) return;
    if (draft.currentClubId !== null) return;  // already landed on a club
    const onClockId = snakePickerId(draft.draftOrder, draft.currentRound, draft.currentPickInRound);
    if (onClockId !== "user") return;          // not the user's turn
    const user = draft.managers.find(m => m.isUser);
    if (!user) return;
    if (user.squad.length === 0) return;       // founding pick — pool is fixed
    // Short delay so user sees the previous pick result before next spin
    const timer = setTimeout(() => userSpin(), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  function processAIPick(ai: Manager) {
    setDraft(prev => {
      if (!prev) return prev;
      const isFirstPick = ai.squad.length === 0;
      const need = computeNeed(ai.squad);

      // Founding-club restriction: round 1 only
      let candidatePool: Player[];
      if (isFirstPick) {
        candidatePool = allPlayers.filter(
          p => p.club === ai.foundingClubId && !prev.usedPlayerKeys.has(playerKey(p)),
        );
      } else {
        candidatePool = allPlayers.filter(p => !prev.usedPlayerKeys.has(playerKey(p)));
      }
      // Position need filter — only pick a player who fills an open slot
      candidatePool = candidatePool.filter(p => {
        const bucket = simplifyPosition(p.position) as SimplePosition;
        // Map 4-bucket need to 10-position acceptability
        if (bucket === "GK" && !need.has("GK")) return false;
        if (bucket === "DEF" && !need.has("DEF")) return false;
        if (bucket === "MID" && !need.has("MID")) return false;
        if (bucket === "FWD" && !need.has("FWD")) return false;
        return true;
      });

      if (candidatePool.length === 0) {
        // Nothing available — skip this AI's pick (shouldn't happen)
        return advance(prev);
      }

      candidatePool.sort((a, b) => {
        const scoreA = scorePlayerByArchetype(a, ai.archetypeStyle, need);
        const scoreB = scorePlayerByArchetype(b, ai.archetypeStyle, need);
        return scoreB - scoreA;
      });
      const pick = candidatePool[0];

      const newManagers = prev.managers.map(m =>
        m.id === ai.id ? { ...m, squad: [...m.squad, pick] } : m
      );
      const newUsed = new Set(prev.usedPlayerKeys);
      newUsed.add(playerKey(pick));
      return advance({ ...prev, managers: newManagers, usedPlayerKeys: newUsed });
    });
  }

  function userPickPlayer(p: Player) {
    setDraft(prev => {
      if (!prev) return prev;
      const newManagers = prev.managers.map(m =>
        m.isUser ? { ...m, squad: [...m.squad, p] } : m
      );
      const newUsed = new Set(prev.usedPlayerKeys);
      newUsed.add(playerKey(p));
      return advance({
        ...prev,
        managers: newManagers,
        usedPlayerKeys: newUsed,
        currentClubId: null,
      });
    });
  }

  function userSpin() {
    setDraft(prev => {
      if (!prev) return prev;
      const userManager = prev.managers.find(m => m.isUser)!;
      const need = computeNeed(userManager.squad);
      // Find a club whose pool contains at least one needed-position player
      const eligibleClubs = allClubs.filter(c => {
        return allPlayers.some(p => {
          if (p.club !== c.id) return false;
          if (prev.usedPlayerKeys.has(playerKey(p))) return false;
          const bucket = simplifyPosition(p.position) as SimplePosition;
          if (bucket === "GK" && !need.has("GK")) return false;
          if (bucket === "DEF" && !need.has("DEF")) return false;
          if (bucket === "MID" && !need.has("MID")) return false;
          if (bucket === "FWD" && !need.has("FWD")) return false;
          return true;
        });
      });
      if (eligibleClubs.length === 0) return prev;
      const chosen = eligibleClubs[Math.floor(Math.random() * eligibleClubs.length)];
      return { ...prev, currentClubId: chosen.id };
    });
  }

  // ─── DERIVED VALUES — these must compute even when draft is null, so the
  // useMemo below is ALWAYS called (rules-of-hooks). The branches inside
  // gracefully handle missing state. ────────────────────────────────────
  const userManager = draft?.managers.find(m => m.isUser) ?? null;
  const aiManagers = draft?.managers.filter(m => !m.isUser) ?? [];
  const onClockId = draft ? snakePickerId(draft.draftOrder, draft.currentRound, draft.currentPickInRound) : null;
  const isUserTurn = onClockId === "user";
  const draftDone = draft ? draft.currentRound > SQUAD_SIZE : false;

  // What can the user pick from right now? Always computed.
  const userPickContext = useMemo(() => {
    if (!draft || !userManager || !isUserTurn) return null;
    const need = computeNeed(userManager.squad);
    const isFirstPick = userManager.squad.length === 0;
    if (isFirstPick) {
      // Pool is the founding club, no need to spin
      const pool = allPlayers
        .filter(p => p.club === career.foundingClubId)
        .filter(p => !draft.usedPlayerKeys.has(playerKey(p)))
        .filter(p => {
          const bucket = simplifyPosition(p.position) as SimplePosition;
          if (bucket === "GK" && !need.has("GK")) return false;
          if (bucket === "DEF" && !need.has("DEF")) return false;
          if (bucket === "MID" && !need.has("MID")) return false;
          if (bucket === "FWD" && !need.has("FWD")) return false;
          return true;
        })
        .sort((a, b) => b.prime_rating - a.prime_rating)
        .slice(0, 16);
      return { mode: "founding" as const, pool, club: userClub };
    }
    if (!draft.currentClubId) return { mode: "needs-spin" as const };
    const club = allClubs.find(c => c.id === draft.currentClubId);
    const pool = allPlayers
      .filter(p => p.club === draft.currentClubId)
      .filter(p => !draft.usedPlayerKeys.has(playerKey(p)))
      .filter(p => {
        const bucket = simplifyPosition(p.position) as SimplePosition;
        if (bucket === "GK" && !need.has("GK")) return false;
        if (bucket === "DEF" && !need.has("DEF")) return false;
        if (bucket === "MID" && !need.has("MID")) return false;
        if (bucket === "FWD" && !need.has("FWD")) return false;
        return true;
      })
      .sort((a, b) => b.prime_rating - a.prime_rating)
      .slice(0, 12);
    return { mode: "picking" as const, pool, club };
  }, [draft, userManager, isUserTurn, allPlayers, allClubs, career.foundingClubId, userClub]);

  // ─── Render guards (after all hooks have been called) ─────────────────
  if (!career.foundingClubId || !career.leagueId) return null;
  if (!draft || !userManager) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Setting up the draft…
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-8 max-w-5xl mx-auto">
      <header className="flex items-center justify-between gap-3">
        <Link to="/career" className="text-[11px] text-muted-foreground hover:text-warning underline">
          ← GOLAZO hub
        </Link>
        <div className="text-right">
          <div className="font-display text-2xl text-warning">Draft</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            Season {career.currentSeason} · Round {Math.min(draft.currentRound, SQUAD_SIZE)} / {SQUAD_SIZE}
          </div>
        </div>
      </header>

      {/* Snake-order strip */}
      <div className="mt-6">
        <SnakeOrderStrip
          order={draft.draftOrder}
          managers={draft.managers}
          round={draft.currentRound}
          pickInRound={draft.currentPickInRound}
        />
      </div>

      {draftDone ? (
        <SeasonReadyCard userManager={userManager} allManagers={draft.managers} />
      ) : (
        <div className="mt-6 grid md:grid-cols-[1fr_320px] gap-6">
          {/* Left: user pick area */}
          <div>
            {isUserTurn && userPickContext?.mode === "founding" && (
              <UserFoundingPick
                club={userPickContext.club!}
                pool={userPickContext.pool}
                onPick={userPickPlayer}
              />
            )}
            {isUserTurn && userPickContext?.mode === "needs-spin" && (
              <UserNeedsSpin onSpin={userSpin} />
            )}
            {isUserTurn && userPickContext?.mode === "picking" && (
              <UserPickFromClub
                club={userPickContext.club!}
                pool={userPickContext.pool}
                onPick={userPickPlayer}
                onSkip={userSpin}
              />
            )}
            {!isUserTurn && (
              <AIPickingIndicator
                manager={draft.managers.find(m => m.id === onClockId)}
              />
            )}

            <TacticalPitch userManager={userManager} />
            <UserSquadList userManager={userManager} />
          </div>

          {/* Right: AI rivals */}
          <aside className="space-y-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Rivals</div>
            {aiManagers.map(m => (
              <AIRivalCard
                key={m.id}
                manager={m}
                onClock={onClockId === m.id}
              />
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function computeNeed(squad: Player[]): Set<SimplePosition> {
  // Convert squad of unschlagbar Player[] to position-needs against FORMATION_NEED
  const counts: Record<SimplePosition, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  squad.forEach(p => {
    const bucket = simplifyPosition(p.position) as SimplePosition;
    counts[bucket]++;
  });
  const need = new Set<SimplePosition>();
  if (counts.GK < FORMATION_NEED.G) need.add("GK");
  if (counts.DEF < FORMATION_NEED.D) need.add("DEF");
  if (counts.MID < FORMATION_NEED.M) need.add("MID");
  if (counts.FWD < FORMATION_NEED.F) need.add("FWD");
  return need;
}

function advance(d: DraftSnapshot): DraftSnapshot {
  const next = { ...d };
  next.currentPickInRound++;
  if (next.currentPickInRound > next.draftOrder.length) {
    next.currentPickInRound = 1;
    next.currentRound++;
  }
  return next;
}

// ─── sub-components ──────────────────────────────────────────────────────

function SnakeOrderStrip({ order, managers, round, pickInRound }: {
  order: string[];
  managers: Manager[];
  round: number;
  pickInRound: number;
}) {
  // Compute who has picked AT ALL so far in this round
  const onClockId = snakePickerId(order, round, pickInRound);
  const effectiveOrder = round % 2 === 0 ? [...order].reverse() : order;
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {effectiveOrder.map((id, idx) => {
        const m = managers.find(mm => mm.id === id);
        if (!m) return null;
        const isOnClock = id === onClockId;
        const hasPicked = idx + 1 < pickInRound;
        return (
          <div
            key={id}
            className={`px-2 py-1.5 rounded text-center min-w-[60px] border ${
              isOnClock ? "border-warning bg-warning/20 text-warning" :
              hasPicked ? "border-border bg-card/40 text-muted-foreground opacity-50" :
              "border-border bg-card text-foreground"
            }`}
            style={{ borderTopColor: m.color, borderTopWidth: 3 }}
          >
            <div className="text-[9px] uppercase tracking-wider">{m.isUser ? "YOU" : m.archetypeName.split(" ")[0]}</div>
            <div className="text-[9px] mt-0.5 opacity-70">{m.squad.length}/{SQUAD_SIZE}</div>
          </div>
        );
      })}
    </div>
  );
}

function UserFoundingPick({ club, pool, onPick }: {
  club: Club;
  pool: Player[];
  onPick: (p: Player) => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-warning bg-warning/10 p-5">
      <div className="text-xs uppercase tracking-[0.2em] text-warning mb-1">⚡ Your founding pick</div>
      <div className="font-display text-xl">Pick any legend from {club.name}</div>
      <div className="text-xs text-muted-foreground mt-1">
        This is your career's anchor. Choose wisely — your founding club's legends are how it all starts.
      </div>
      <PlayerGrid pool={pool} onPick={onPick} />
    </div>
  );
}

function UserNeedsSpin({ onSpin: _onSpin }: { onSpin: () => void }) {
  // Auto-spin fires from a useEffect at the top of the page — this is a
  // transient state shown for ~250ms while the spin computes.
  return (
    <div className="rounded-2xl border border-warning bg-warning/5 p-6 text-center animate-pulse">
      <div className="text-3xl mb-2">🎯</div>
      <div className="font-display text-xl text-warning">Spinning the wheel…</div>
    </div>
  );
}

function UserPickFromClub({ club, pool, onPick, onSkip }: {
  club: Club;
  pool: Player[];
  onPick: (p: Player) => void;
  onSkip: () => void;
}) {
  return (
    <div className="rounded-2xl border border-warning bg-card/40 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-warning">Wheel landed on</div>
          <div className="font-display text-xl">{club.name}</div>
        </div>
        <button
          onClick={onSkip}
          className="text-xs text-muted-foreground hover:text-warning underline"
        >
          Re-spin →
        </button>
      </div>
      {pool.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          No eligible players left at this club. Try a re-spin.
        </div>
      ) : (
        <PlayerGrid pool={pool} onPick={onPick} />
      )}
    </div>
  );
}

function PlayerGrid({ pool, onPick }: { pool: Player[]; onPick: (p: Player) => void }) {
  return (
    <div className="mt-3 space-y-1.5 max-h-[420px] overflow-y-auto">
      {pool.map(p => (
        <button
          key={`${p.club}-${p.name}-${p.position}`}
          onClick={() => onPick(p)}
          className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-card hover:border-warning hover:bg-warning/10 transition text-left"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{p.name}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {p.position} · {p.career_years} · {p.nationality}
            </div>
          </div>
          <span className="shrink-0 font-display text-lg px-2 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
            {p.prime_rating}
          </span>
        </button>
      ))}
    </div>
  );
}

function AIPickingIndicator({ manager }: { manager: Manager | undefined }) {
  if (!manager) return null;
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-6 text-center animate-pulse">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">On the clock</div>
      <div className="font-display text-lg text-foreground mt-1">
        <span style={{ color: manager.color }}>{manager.badge}</span> {manager.archetypeName}
      </div>
      <div className="text-xs text-muted-foreground mt-1">…picking…</div>
    </div>
  );
}

/**
 * Tactical pitch view for the user's current draft state. Shows the 4-3-3
 * formation with filled slots (player initials + rating) vs empty slots
 * (position label). Helps the user see "what do I still need to fill" at
 * a glance — feedback flagged this would help drafting decisions.
 */
function TacticalPitch({ userManager }: { userManager: Manager }) {
  // 4-3-3 slot positions (matches FORMATIONS["4-3-3"] in formations.ts).
  // Order: GK, LB, CB, CB, RB, CM, CM, CM, LW, ST, RW
  const SLOTS: Array<{ pos: string; x: number; y: number; family: "GK"|"DEF"|"MID"|"FWD" }> = [
    { pos: "GK",  x: 50, y: 90, family: "GK" },
    { pos: "LB",  x: 12, y: 72, family: "DEF" },
    { pos: "CB",  x: 35, y: 76, family: "DEF" },
    { pos: "CB",  x: 65, y: 76, family: "DEF" },
    { pos: "RB",  x: 88, y: 72, family: "DEF" },
    { pos: "CM",  x: 25, y: 52, family: "MID" },
    { pos: "CM",  x: 50, y: 56, family: "MID" },
    { pos: "CM",  x: 75, y: 52, family: "MID" },
    { pos: "LW",  x: 15, y: 22, family: "FWD" },
    { pos: "ST",  x: 50, y: 16, family: "FWD" },
    { pos: "RW",  x: 85, y: 22, family: "FWD" },
  ];

  // Match user's squad against the slot template, greedy first-fit by family
  const assigned: Array<Player | null> = SLOTS.map(() => null);
  const used = new Set<number>();
  // Sort squad by rating desc so the strongest fills the slot first
  const sortedSquad = [...userManager.squad].sort((a, b) => b.prime_rating - a.prime_rating);
  for (const p of sortedSquad) {
    const playerFamily = simplifyPosition(p.position) as "GK"|"DEF"|"MID"|"FWD";
    for (let i = 0; i < SLOTS.length; i++) {
      if (used.has(i)) continue;
      if (SLOTS[i].family !== playerFamily) continue;
      assigned[i] = p;
      used.add(i);
      break;
    }
  }

  return (
    <div className="mt-6">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
        Your XI ({userManager.squad.length}/{SQUAD_SIZE}) · 4-3-3
      </div>
      <div className="relative w-full mx-auto rounded-2xl border border-pitch-line/30 bg-pitch-pattern overflow-hidden"
           style={{ aspectRatio: "16/11", maxWidth: 540 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
          <rect x="1" y="1" width="98" height="98" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
          <circle cx="50" cy="50" r="9" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
          <rect x="25" y="0" width="50" height="14" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
          <rect x="25" y="86" width="50" height="14" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
        </svg>
        {SLOTS.map((slot, i) => {
          const player = assigned[i];
          const lastName = player ? player.name.split(" ").slice(-1)[0] : null;
          return (
            <div
              key={`${slot.pos}-${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
            >
              <div
                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition ${
                  player
                    ? "bg-warning text-warning-foreground border-warning-foreground/30 shadow-[0_4px_12px_-2px] shadow-warning/40"
                    : "bg-card border-border text-muted-foreground"
                }`}
              >
                {player ? player.prime_rating : slot.pos}
              </div>
              {lastName && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-0.5 px-1 py-0.5 rounded text-[9px] bg-black/70 text-white whitespace-nowrap max-w-[80px] truncate border border-white/10">
                  {lastName}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UserSquadList({ userManager }: { userManager: Manager }) {
  return (
    <div className="mt-6">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
        Your squad ({userManager.squad.length}/{SQUAD_SIZE})
      </div>
      {userManager.squad.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">No picks yet — make your founding choice above.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {userManager.squad.map((p, i) => (
            <div
              key={`${p.name}-${i}`}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {p.position} · {p.career_years}
                </div>
              </div>
              <span className="shrink-0 font-display text-sm text-warning">{p.prime_rating}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AIRivalCard({ manager, onClock }: { manager: Manager; onClock: boolean }) {
  const lastPick = manager.squad[manager.squad.length - 1];
  return (
    <div
      className={`p-3 rounded-xl border transition ${
        onClock ? "border-warning bg-warning/10" : "border-border bg-card/40"
      }`}
      style={{ borderTopColor: manager.color, borderTopWidth: 3 }}
    >
      <div className="flex items-center justify-between">
        <div className="font-display text-sm">{manager.archetypeName}</div>
        <span className="text-[10px] text-muted-foreground">{manager.squad.length}/{SQUAD_SIZE}</span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
        {DEFAULT_ARCHETYPES.find(a => a.style === manager.archetypeStyle)?.description ?? ""}
      </div>
      {lastPick && (
        <div className="text-[10px] mt-1.5 text-warning truncate">
          ★ {lastPick.name} ({lastPick.position})
        </div>
      )}
    </div>
  );
}

function SeasonReadyCard({ userManager, allManagers }: {
  userManager: Manager;
  allManagers: Manager[];
}) {
  const career = useCareer();
  const avg = userManager.squad.reduce((a, p) => a + p.prime_rating, 0) / Math.max(1, userManager.squad.length);

  // Commit the draft result to the career store once on mount of this card.
  // Idempotent: if rivals are already saved, no-op.
  useEffect(() => {
    if (career.rivals.length > 0) return;
    const rivals = allManagers
      .filter(m => !m.isUser)
      .map(m => ({
        id: m.id,
        name: m.name,
        badge: m.badge,
        color: m.color,
        archetypeName: m.archetypeName,
        archetypeStyle: m.archetypeStyle,
        foundingClubId: m.foundingClubId,
        squad: m.squad,
      }));
    career.commitDraft(userManager.squad, rivals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-10 rounded-2xl border-2 border-warning bg-warning/10 p-6 text-center">
      <div className="text-4xl mb-2">⚽</div>
      <div className="font-display text-3xl text-warning mb-2">Squad ready</div>
      <div className="text-sm text-muted-foreground mb-1">
        Your XI is locked. Average rating: <span className="text-warning font-display">{avg.toFixed(1)}</span>
      </div>
      <div className="text-xs text-muted-foreground mb-5">
        12-manager league. 22 matchdays. Top 8 qualify for the cup. Bottom 2 relegate.
      </div>
      <Link
        to="/career/season"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-warning text-warning-foreground font-display text-base tracking-wide hover:brightness-110 transition"
      >
        Start Season {career.currentSeason} →
      </Link>
    </div>
  );
}
