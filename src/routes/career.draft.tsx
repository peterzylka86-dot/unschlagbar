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
import { getCareerClubs, getCareerPlayers } from "@/lib/data";
import { FORMATIONS } from "@/lib/formations";
import { isPositionCompatible, playerFitsSlot } from "@/lib/draft-helpers";
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
// 14 = 11 starters + 3 bench. The matchday-XI system (src/lib/
// matchday-xi.ts) auto-picks the best XI and lets the user rotate
// hot bench players in during the season. Legacy 11-player saves
// keep working — they just have no bench.
// 11 starters + 7 bench. A proper rotation pool so squad depth matters as
// players fatigue, age, and (in Real mode) decline season to season.
const SQUAD_SIZE = 18;

// Formation → 4-bucket need table. Read by computeNeed() so the AI rival
// loop + position-aware spin filtering both honor whatever formation the
// user picked at the top of the draft.
const FORMATION_NEEDS: Record<string, FormationNeed> = {
  "4-3-3": { G: 1, D: 4, M: 3, F: 3 },
  "4-4-2": { G: 1, D: 4, M: 4, F: 2 },
  "4-2-3-1": { G: 1, D: 4, M: 5, F: 1 }, // 2 CDM + 1 CAM = 3 MID + 2 wide MIDs
  "4-5-1": { G: 1, D: 4, M: 5, F: 1 },
  "3-4-3": { G: 1, D: 3, M: 4, F: 3 },
  "3-5-2": { G: 1, D: 3, M: 5, F: 2 },
  "5-4-1": { G: 1, D: 5, M: 4, F: 1 },
};

// Simple Mulberry32 seeded RNG so the same career produces the same draft
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
  draftOrder: string[]; // round-1 manager id sequence
  currentRound: number;
  currentPickInRound: number;
  usedPlayerKeys: Set<string>;
  currentClubId: string | null; // when user's spin lands on a club
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
  void leagueId; // referenced indirectly via founding-club lookup below
  // GOLAZO super-league pool: elite clubs (strength ≥ 80) across the career
  // leagues, PLUS the user's founding club. Picking GC doesn't trap you in
  // Switzerland and doesn't dilute the draft with Pro-Vercelli-tier clubs.
  const allClubs = useMemo(
    () => getCareerClubs(career.foundingClubId, career.careerMode),
    [career.foundingClubId, career.careerMode],
  );
  const allPlayers = useMemo(
    () => getCareerPlayers(career.foundingClubId, career.careerMode),
    [career.foundingClubId, career.careerMode],
  );
  const userClub = useMemo(
    () => allClubs.find((c) => c.id === career.foundingClubId) ?? null,
    [allClubs, career.foundingClubId],
  );

  // ─── Initialize draft state once on mount ─────────────────────────────
  const [draft, setDraft] = useState<DraftSnapshot | null>(null);
  // Auto-draft: once on, the user's remaining picks are made by the
  // assistant (best-fit for the formation) so you don't have to spin all 18
  // rounds by hand. Your founding pick stays yours.
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    if (draft) return;
    // Seed includes the season number so each season gets a NEW random
    // snake order. Previously the order was identical every season (only
    // startedAt was used) — the user's slot was locked from S1 forever.
    const seed = career.startedAt
      ? hashString(`${career.startedAt}-s${career.currentSeason}`)
      : 12345;
    const rand = mulberry32(seed);

    // Build AI rivals from the league's clubs (excluding the user's founding)
    const otherClubs = allClubs
      .filter((c) => c.id !== career.foundingClubId)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, AI_RIVALS_COUNT * 3); // top pool to pick from
    const archetypes = DEFAULT_ARCHETYPES;
    const ais = buildAIManagers(
      AI_RIVALS_COUNT,
      userClub?.name ?? "",
      archetypes,
      otherClubs.map((c) => ({
        name: c.name,
        letter: c.short.slice(0, 3),
        bg: c.color,
        fg: "#ffffff",
      })),
      rand,
    );

    // Map back to club ids (buildAIManagers uses name only)
    const aiManagers: Manager[] = ais.map((ai, i) => {
      const club = allClubs.find((c) => c.name === ai.foundingClub);
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

    // SEASON 2+ CARRY-OVER: the user's squad survives between seasons.
    // career.squad holds whatever survived the postseason transfer window
    // (survivors + signings - pendingDeparture). Pre-fill the draft state
    // with that squad — the user only picks replacements for empty slots.
    // (Season 1: career.squad is [] so this is a no-op.)
    const userManager: Manager = {
      id: "user",
      name: "You",
      badge: userClub?.short ?? "U",
      color: userClub?.color ?? "#facc15",
      archetypeStyle: "user",
      archetypeName: "You",
      foundingClubId: career.foundingClubId!,
      isUser: true,
      squad: [...career.squad],
    };

    // Carry-overs go into the used-keys set so AI rivals can't draft them.
    const usedKeys = new Set<string>(career.squad.map(playerKey));

    // Random draft order — user slot is random within the order
    const allManagers = [userManager, ...aiManagers];
    const order = [...allManagers].sort(() => rand() - 0.5).map((m) => m.id);

    setDraft({
      managers: allManagers,
      draftOrder: order,
      currentRound: 1,
      currentPickInRound: 1,
      usedPlayerKeys: usedKeys,
      currentClubId: null,
    });
  }, [draft, allClubs, allPlayers, career, userClub]);

  // ─── Drive the draft forward through AI picks ─────────────────────────
  useEffect(() => {
    if (!draft) return;
    if (draft.currentRound > SQUAD_SIZE) return;
    const onClockId = snakePickerId(draft.draftOrder, draft.currentRound, draft.currentPickInRound);
    if (!onClockId) return;
    const onClock = draft.managers.find((m) => m.id === onClockId);
    if (!onClock) return;

    // CARRY-OVER AUTO-PASS: if user is on clock at round R but their squad
    // already covers that round (squad.length >= R from carry-overs), skip
    // their turn. After 11 rounds the user ends with min(11, carry + picks).
    if (onClock.isUser && onClock.squad.length >= draft.currentRound) {
      const timer = setTimeout(() => {
        setDraft((prev) => (prev ? advance({ ...prev, currentClubId: null }) : prev));
      }, 200);
      return () => clearTimeout(timer);
    }

    if (onClock.isUser) {
      // Auto-draft: the assistant makes the user's picks too (best-fit),
      // bypassing the wheel so the rest of the draft completes fast.
      if (auto) {
        const timer = setTimeout(() => processUserAutoPick(onClock), 180);
        return () => clearTimeout(timer);
      }
      return; // wait for user input
    }

    // AI pick — run via setTimeout so the UI breathes between AI turns
    const timer = setTimeout(() => processAIPick(onClock), auto ? 60 : 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, auto]);

  // Auto-spin on user's turn (rounds 2+) — no manual click required.
  // User feedback: "I don't need to spin every time...but rather just land
  // on the club that I picked." Founding pick (round 1) doesn't need spin;
  // it's already founding-club-only.
  useEffect(() => {
    if (!draft) return;
    if (auto) return; // auto-draft bypasses the wheel entirely
    if (draft.currentClubId !== null) return; // already landed on a club
    const onClockId = snakePickerId(draft.draftOrder, draft.currentRound, draft.currentPickInRound);
    if (onClockId !== "user") return; // not the user's turn
    const user = draft.managers.find((m) => m.isUser);
    if (!user) return;
    if (user.squad.length === 0) return; // founding pick — pool is fixed
    // Short delay so user sees the previous pick result before next spin
    const timer = setTimeout(() => userSpin(), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, auto]);

  /** Auto-draft the USER's pick by OPEN FORMATION SLOT (the same strict
   *  slot logic the spin wheel uses) so the XI fills every position — a
   *  winger, two fullbacks, a keeper, not just the highest-rated CMs/STs.
   *  Founding pick stays the franchise. Once the XI is full, later rounds are
   *  bench depth (any position). */
  function processUserAutoPick(user: Manager) {
    setDraft((prev) => {
      if (!prev) return prev;
      const isFirstPick = user.squad.length === 0;
      const slotPositions = FORMATIONS[career.formation].slots.map((s) => s.position);
      // Which formation slots the current squad already covers.
      const filled: boolean[] = slotPositions.map(() => false);
      for (const p of user.squad) {
        for (let i = 0; i < slotPositions.length; i++) {
          if (!filled[i] && playerFitsSlot(slotPositions[i], p)) {
            filled[i] = true;
            break;
          }
        }
      }
      const openSlots = slotPositions.filter((_, i) => !filled[i]);
      const benchMode = openSlots.length === 0; // XI complete → bench depth
      const usable = (p: Player) =>
        !prev.usedPlayerKeys.has(playerKey(p)) &&
        (!isFirstPick || p.club === user.foundingClubId);
      let pool = allPlayers.filter(
        (p) => usable(p) && (benchMode || openSlots.some((sp) => playerFitsSlot(sp, p))),
      );
      // Safety: never strand the pick if no slot-filler is left.
      if (pool.length === 0) pool = allPlayers.filter(usable);
      if (pool.length === 0) return advance({ ...prev, currentClubId: null });
      pool.sort((a, b) => b.prime_rating - a.prime_rating);
      const pick = pool[0];
      if (isFirstPick && !career.franchisePlayerKey) {
        career.setFranchisePlayer(`${pick.club}:${pick.name}`);
      }
      const newManagers = prev.managers.map((m) =>
        m.isUser ? { ...m, squad: [...m.squad, pick] } : m,
      );
      const newUsed = new Set(prev.usedPlayerKeys);
      newUsed.add(playerKey(pick));
      return advance({ ...prev, managers: newManagers, usedPlayerKeys: newUsed, currentClubId: null });
    });
  }

  function processAIPick(ai: Manager) {
    setDraft((prev) => {
      if (!prev) return prev;
      const isFirstPick = ai.squad.length === 0;
      const need = computeNeed(ai.squad, career.formation);

      // Founding-club restriction: round 1 only
      let candidatePool: Player[];
      if (isFirstPick) {
        candidatePool = allPlayers.filter(
          (p) => p.club === ai.foundingClubId && !prev.usedPlayerKeys.has(playerKey(p)),
        );
      } else {
        candidatePool = allPlayers.filter((p) => !prev.usedPlayerKeys.has(playerKey(p)));
      }
      // Position need filter — only pick a player who fills an open slot
      candidatePool = candidatePool.filter((p) => {
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

      const newManagers = prev.managers.map((m) =>
        m.id === ai.id ? { ...m, squad: [...m.squad, pick] } : m,
      );
      const newUsed = new Set(prev.usedPlayerKeys);
      newUsed.add(playerKey(pick));
      return advance({ ...prev, managers: newManagers, usedPlayerKeys: newUsed });
    });
  }

  function userPickPlayer(p: Player) {
    setDraft((prev) => {
      if (!prev) return prev;
      const userMgr = prev.managers.find((m) => m.isUser);
      const isFoundingPick = userMgr ? userMgr.squad.length === 0 : false;
      const newManagers = prev.managers.map((m) =>
        m.isUser ? { ...m, squad: [...m.squad, p] } : m,
      );
      const newUsed = new Set(prev.usedPlayerKeys);
      newUsed.add(playerKey(p));
      // First pick of the user's career = franchise player. Locked forever:
      // can't be swapped mid-season or sold in the postseason window.
      if (isFoundingPick && !career.franchisePlayerKey) {
        career.setFranchisePlayer(`${p.club}:${p.name}`);
      }
      return advance({
        ...prev,
        managers: newManagers,
        usedPlayerKeys: newUsed,
        currentClubId: null,
      });
    });
  }

  function userSpin() {
    setDraft((prev) => {
      if (!prev) return prev;
      const userMgr = prev.managers.find((m) => m.isUser)!;
      // Use the same slot-level open-position logic as the pick pool —
      // an eligible club must have a player whose position can fill at
      // least one OPEN slot in the user's formation. LB/RB/LW/RW are
      // strict; CDM/CM/CAM share a family.
      const formation = FORMATIONS[career.formation];
      const slotPositions = formation.slots.map((s) => s.position);
      const filled: boolean[] = slotPositions.map(() => false);
      for (const p of userMgr.squad) {
        for (let i = 0; i < slotPositions.length; i++) {
          if (filled[i]) continue;
          if (playerFitsSlot(slotPositions[i], p)) {
            filled[i] = true;
            break;
          }
        }
      }
      const openSlotPositions = slotPositions.filter((_, i) => !filled[i]);
      // BENCH MODE: once all 11 formation slots are filled, the remaining
      // picks (rounds 12-14) are bench depth — ANY position is welcome.
      // Without this, openSlotPositions is empty at 11 players and the
      // wheel finds no eligible club, freezing the draft. (Bug: draft
      // stalled at 11 after SQUAD_SIZE went 11→14.)
      const benchMode = openSlotPositions.length === 0;
      const eligibleClubs = allClubs.filter((c) =>
        allPlayers.some(
          (p) =>
            p.club === c.id &&
            !prev.usedPlayerKeys.has(playerKey(p)) &&
            (benchMode || openSlotPositions.some((sp) => playerFitsSlot(sp, p))),
        ),
      );
      if (eligibleClubs.length === 0) return prev;
      const chosen = eligibleClubs[Math.floor(Math.random() * eligibleClubs.length)];
      return { ...prev, currentClubId: chosen.id };
    });
  }

  // ─── DERIVED VALUES — these must compute even when draft is null, so the
  // useMemo below is ALWAYS called (rules-of-hooks). The branches inside
  // gracefully handle missing state. ────────────────────────────────────
  const userManager = draft?.managers.find((m) => m.isUser) ?? null;
  const aiManagers = draft?.managers.filter((m) => !m.isUser) ?? [];
  const onClockId = draft
    ? snakePickerId(draft.draftOrder, draft.currentRound, draft.currentPickInRound)
    : null;
  const isUserTurn = onClockId === "user";
  const draftDone = draft ? draft.currentRound > SQUAD_SIZE : false;

  // What can the user pick from right now? Always computed.
  const userPickContext = useMemo(() => {
    if (!draft || !userManager || !isUserTurn) return null;

    // SLOT-LEVEL need: track which specific formation positions remain.
    // User spec: "respect lw and rw positions as well as rb and lb."
    // The 4-bucket simplifyPosition allowed a CB to fill an LB slot —
    // that's wrong in real football. Walking through the formation's
    // slot list and greedily matching squad members to compatible slots
    // tells us exactly which Position values are still open. The pool
    // filter then admits a player iff some open slot is isPositionCompatible
    // with them. CDM↔CM↔CAM stays flexible (same family); LB/RB/LW/RW/CB
    // each in their own family stays strict.
    const formation = FORMATIONS[career.formation];
    const slotPositions = formation.slots.map((s) => s.position);
    const filled: boolean[] = slotPositions.map(() => false);
    for (const p of userManager.squad) {
      for (let i = 0; i < slotPositions.length; i++) {
        if (filled[i]) continue;
        if (playerFitsSlot(slotPositions[i], p)) {
          filled[i] = true;
          break;
        }
      }
    }
    const openSlotPositions = slotPositions.filter((_, i) => !filled[i]);
    // BENCH MODE (rounds 12-14): formation full → any position welcome.
    const benchMode = openSlotPositions.length === 0;
    // matchesOpenSlot considers the candidate player's primary + alt
    // positions. Mbappé (LW+[ST]) shows up for both LW and ST slots.
    const matchesOpenSlot = (p: Player): boolean =>
      benchMode || openSlotPositions.some((slotPos) => playerFitsSlot(slotPos, p));

    const isFirstPick = userManager.squad.length === 0;
    if (isFirstPick) {
      // Pool is the founding club, no need to spin
      const pool = allPlayers
        .filter((p) => p.club === career.foundingClubId)
        .filter((p) => !draft.usedPlayerKeys.has(playerKey(p)))
        .filter((p) => matchesOpenSlot(p))
        .sort((a, b) => b.prime_rating - a.prime_rating)
        .slice(0, 16);
      return { mode: "founding" as const, pool, club: userClub };
    }
    if (!draft.currentClubId) return { mode: "needs-spin" as const };
    const club = allClubs.find((c) => c.id === draft.currentClubId);
    const pool = allPlayers
      .filter((p) => p.club === draft.currentClubId)
      .filter((p) => !draft.usedPlayerKeys.has(playerKey(p)))
      .filter((p) => matchesOpenSlot(p))
      .sort((a, b) => b.prime_rating - a.prime_rating)
      .slice(0, 12);
    return { mode: "picking" as const, pool, club };
  }, [
    draft,
    userManager,
    isUserTurn,
    allPlayers,
    allClubs,
    career.foundingClubId,
    career.formation,
    userClub,
  ]);

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
        <Link
          to="/career"
          className="text-[11px] text-muted-foreground hover:text-warning underline"
        >
          ← GOLAZO hub
        </Link>
        <div className="text-right">
          <div className="font-display text-2xl text-warning">Draft</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            Season {career.currentSeason} · Round {Math.min(draft.currentRound, SQUAD_SIZE)} /{" "}
            {SQUAD_SIZE}
          </div>
        </div>
      </header>

      {/* Squad progress bar — your XI fills left-to-right as you draft. */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
          <span>Your XI</span>
          <span className="tabular-nums">
            <span className="text-warning font-display">{userManager.squad.length}</span>
            <span className="opacity-60">/{SQUAD_SIZE}</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-card/60 overflow-hidden border border-border/60">
          <div
            className="h-full bg-gradient-to-r from-warning/80 to-warning transition-all duration-500 ease-out"
            style={{ width: `${(userManager.squad.length / SQUAD_SIZE) * 100}%` }}
          />
        </div>
      </div>

      {/* Draft slot reveal — the snake order is reshuffled every season so
          the user's draft slot is genuinely random. Show prominently so
          they can see "I pick X of 12" before the draft starts. */}
      <UserSlotBadge order={draft.draftOrder} totalManagers={draft.managers.length} />

      {/* Formation picker — only when no picks made yet (locking after first pick prevents broken squads) */}
      {userManager.squad.length === 0 && (
        <FormationPicker current={career.formation} onChange={career.setFormation} />
      )}

      {/* Auto-draft the rest — once your founding pick is in, let the
          assistant fill the remaining slots so you skip 17 manual spins. */}
      {!draftDone && userManager.squad.length >= 1 && !auto && (
        <button
          onClick={() => setAuto(true)}
          className="mt-4 w-full px-4 py-2.5 rounded-md border border-success/40 bg-success/5 text-success text-sm font-display tracking-wide hover:bg-success/15 transition"
        >
          ⚡ Auto-draft the rest (assistant fills best-fit)
        </button>
      )}
      {auto && !draftDone && (
        <div className="mt-4 w-full px-4 py-2.5 rounded-md border border-success/40 bg-success/10 text-success text-sm font-display tracking-wide text-center">
          ⚡ Auto-drafting…
        </div>
      )}

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
              />
            )}
            {!isUserTurn && (
              <AIPickingIndicator manager={draft.managers.find((m) => m.id === onClockId)} />
            )}

            <TacticalPitch userManager={userManager} formationKey={career.formation} />
            <UserSquadList userManager={userManager} />
          </div>

          {/* Right: AI rivals */}
          <aside className="space-y-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              Rivals
            </div>
            {aiManagers.map((m) => (
              <AIRivalCard key={m.id} manager={m} onClock={onClockId === m.id} />
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

function computeNeed(squad: Player[], formation: string = "4-3-3"): Set<SimplePosition> {
  const formationNeed = FORMATION_NEEDS[formation] ?? FORMATION_NEEDS["4-3-3"];
  const counts: Record<SimplePosition, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  squad.forEach((p) => {
    const bucket = simplifyPosition(p.position) as SimplePosition;
    counts[bucket]++;
  });
  const need = new Set<SimplePosition>();
  if (counts.GK < formationNeed.G) need.add("GK");
  if (counts.DEF < formationNeed.D) need.add("DEF");
  if (counts.MID < formationNeed.M) need.add("MID");
  if (counts.FWD < formationNeed.F) need.add("FWD");
  // BENCH DEPTH: once the formation's 11 slots are covered, the remaining
  // bench picks (rounds 12-14) accept ANY position — return all buckets so
  // the AI keeps drafting and the pool filter never empties. (Without this
  // the AI's candidate pool went empty at 11, mirroring the user-side
  // wheel freeze.)
  if (need.size === 0) {
    return new Set<SimplePosition>(["GK", "DEF", "MID", "FWD"]);
  }
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

/**
 * Pre-draft formation picker. Visible only when squad is empty (locking
 * after the first pick prevents 4-3-3 → 5-4-1 mid-draft, which would
 * leave the user with a wrong-shape squad).
 *
 * 7 formations, displayed as chip-buttons. Updates career.formation in
 * the store; the AI rival loop + need-calc both read from that.
 */
function UserSlotBadge({ order, totalManagers }: { order: string[]; totalManagers: number }) {
  const slot = order.indexOf("user") + 1; // 1-indexed
  if (slot === 0) return null;
  const ordSuffix = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };
  // Color cue: top 4 picks = warning gold (great), middle = neutral,
  // bottom 4 = muted (you'll be picking late in odd rounds).
  const colorClass =
    slot <= 4
      ? "border-warning bg-warning/10 text-warning"
      : slot >= totalManagers - 3
        ? "border-muted-foreground/40 bg-muted/10 text-muted-foreground"
        : "border-foreground/30 bg-card text-foreground";
  return (
    <div className={`mt-4 rounded-xl border-2 ${colorClass} p-4 text-center`}>
      <div className="text-[10px] uppercase tracking-[0.25em] opacity-80">Your draft slot</div>
      <div className="font-display text-3xl mt-1">
        {slot}
        <span className="text-base">{ordSuffix(slot)}</span>{" "}
        <span className="opacity-60 text-base">of {totalManagers}</span>
      </div>
      <div className="text-[10px] opacity-70 mt-1">
        Snake order — picks reverse each round. Re-rolled at the start of every season.
      </div>
    </div>
  );
}

/**
 * GOLAZO Career formations — user spec: only 4-3-3 and 4-4-2.
 *
 * The single-game mode still exposes the full FORMATIONS catalog, but
 * Career mode is intentionally limited to the two classic shapes. Keeps
 * the meta tight and avoids weird squad-vs-formation mismatches.
 */
const CAREER_FORMATIONS: Array<keyof typeof FORMATIONS> = ["4-3-3", "4-4-2"];

function FormationPicker({
  current,
  onChange,
}: {
  current: keyof typeof FORMATIONS;
  onChange: (f: keyof typeof FORMATIONS) => void;
}) {
  return (
    <div className="mt-6 p-4 rounded-xl border border-warning/40 bg-warning/5">
      <div className="text-[10px] uppercase tracking-[0.2em] text-warning mb-2">Formation</div>
      <div className="flex flex-wrap gap-1.5">
        {CAREER_FORMATIONS.map((k) => (
          <button
            key={k}
            onClick={() => onChange(k)}
            className={`px-3 py-1.5 rounded-md font-display text-sm tracking-wide transition ${
              current === k
                ? "bg-warning text-warning-foreground"
                : "border border-border bg-card hover:border-warning"
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {FORMATIONS[current].description} · Lock-in once you make your founding pick.
      </p>
    </div>
  );
}

function SnakeOrderStrip({
  order,
  managers,
  round,
  pickInRound,
}: {
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
        const m = managers.find((mm) => mm.id === id);
        if (!m) return null;
        const isOnClock = id === onClockId;
        const hasPicked = idx + 1 < pickInRound;
        return (
          <div
            key={id}
            className={`px-2 py-1.5 rounded text-center min-w-[60px] border ${
              isOnClock
                ? "border-warning bg-warning/20 text-warning"
                : hasPicked
                  ? "border-border bg-card/40 text-muted-foreground opacity-50"
                  : "border-border bg-card text-foreground"
            }`}
            style={{ borderTopColor: m.color, borderTopWidth: 3 }}
          >
            <div className="text-[9px] uppercase tracking-wider">
              {m.isUser ? "YOU" : m.archetypeName.split(" ")[0]}
            </div>
            <div className="text-[9px] mt-0.5 opacity-70">
              {m.squad.length}/{SQUAD_SIZE}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UserFoundingPick({
  club,
  pool,
  onPick,
}: {
  club: Club;
  pool: Player[];
  onPick: (p: Player) => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-warning bg-warning/10 p-5">
      <div className="text-xs uppercase tracking-[0.2em] text-warning mb-1">
        ⚡ Your founding pick
      </div>
      <div className="font-display text-xl">Pick any legend from {club.name}</div>
      <div className="text-xs text-muted-foreground mt-1">
        This is your career's anchor. Choose wisely — your founding club's legends are how it all
        starts.
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

function UserPickFromClub({
  club,
  pool,
  onPick,
}: {
  club: Club;
  pool: Player[];
  onPick: (p: Player) => void;
}) {
  // Re-spin removed per user spec: in GOLAZO, the wheel result sticks.
  // If a club has no eligible-position players for this round, the
  // auto-spin loop above will land somewhere else.
  return (
    <div className="rounded-2xl border border-warning bg-card/40 p-5">
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-warning">Wheel landed on</div>
        <div className="font-display text-xl">{club.name}</div>
      </div>
      {pool.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          No eligible players left at this club — the wheel will roll again automatically.
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
      {pool.map((p) => (
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
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        On the clock
      </div>
      <div className="font-display text-lg text-foreground mt-1">
        <span style={{ color: manager.color }}>{manager.badge}</span> {manager.archetypeName}
      </div>
      <div className="text-xs text-muted-foreground mt-1">…picking…</div>
    </div>
  );
}

/**
 * Tactical pitch view for the user's current draft state. Reads the
 * formation from FORMATIONS table so the pitch reflects the user's
 * chosen shape (4-3-3 / 4-4-2 / 3-5-2 / etc.).
 *
 * Filled slots = yellow circle with OVR + last name. Empty slots = gray
 * with position label. Helps the user see "what do I still need to fill"
 * at a glance.
 */
function TacticalPitch({
  userManager,
  formationKey,
}: {
  userManager: Manager;
  formationKey: keyof typeof FORMATIONS;
}) {
  const formation = FORMATIONS[formationKey];
  const SLOTS = formation.slots.map((s) => ({
    pos: s.position,
    x: s.x,
    y: s.y,
    family: simplifyPosition(s.position) as "GK" | "DEF" | "MID" | "FWD",
  }));

  // Match user's squad against the slot template, greedy first-fit by family
  const assigned: Array<Player | null> = SLOTS.map(() => null);
  const used = new Set<number>();
  // Sort squad by rating desc so the strongest fills the slot first
  const sortedSquad = [...userManager.squad].sort((a, b) => b.prime_rating - a.prime_rating);
  for (const p of sortedSquad) {
    const playerFamily = simplifyPosition(p.position) as "GK" | "DEF" | "MID" | "FWD";
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
        Your Squad ({userManager.squad.length}/{SQUAD_SIZE}) · 11 start + 3 bench
      </div>
      <div
        className="relative w-full mx-auto rounded-2xl border border-pitch-line/30 bg-pitch-pattern overflow-hidden"
        style={{ aspectRatio: "16/11", maxWidth: 540 }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          <rect
            x="1"
            y="1"
            width="98"
            height="98"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.3"
            className="text-pitch-line"
          />
          <line
            x1="0"
            y1="50"
            x2="100"
            y2="50"
            stroke="currentColor"
            strokeWidth="0.3"
            className="text-pitch-line"
          />
          <circle
            cx="50"
            cy="50"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.3"
            className="text-pitch-line"
          />
          <rect
            x="25"
            y="0"
            width="50"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.3"
            className="text-pitch-line"
          />
          <rect
            x="25"
            y="86"
            width="50"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.3"
            className="text-pitch-line"
          />
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
  const franchiseKey = useCareer((s) => s.franchisePlayerKey);
  return (
    <div className="mt-6">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
        Your squad ({userManager.squad.length}/{SQUAD_SIZE})
      </div>
      {userManager.squad.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">
          No picks yet — make your founding choice above.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {userManager.squad.map((p, i) => {
            const isFranchise = `${p.club}:${p.name}` === franchiseKey;
            return (
              <div
                key={`${p.name}-${i}`}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm ${
                  isFranchise ? "border-warning bg-warning/10" : "border-border bg-card"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate flex items-center gap-1">
                    {isFranchise && <span title="Franchise player — untouchable">⭐</span>}
                    <span className="truncate">{p.name}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {p.position} · {p.career_years}
                    {isFranchise && <span className="text-warning ml-1">· Franchise</span>}
                  </div>
                </div>
                <span className="shrink-0 font-display text-sm text-warning">{p.prime_rating}</span>
              </div>
            );
          })}
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
        <span className="text-[10px] text-muted-foreground">
          {manager.squad.length}/{SQUAD_SIZE}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
        {DEFAULT_ARCHETYPES.find((a) => a.style === manager.archetypeStyle)?.description ?? ""}
      </div>
      {lastPick && (
        <div className="text-[10px] mt-1.5 text-warning truncate">
          ★ {lastPick.name} ({lastPick.position})
        </div>
      )}
    </div>
  );
}

function SeasonReadyCard({
  userManager,
  allManagers,
}: {
  userManager: Manager;
  allManagers: Manager[];
}) {
  const career = useCareer();
  const avg =
    userManager.squad.reduce((a, p) => a + p.prime_rating, 0) /
    Math.max(1, userManager.squad.length);

  // Commit the draft result to the career store once on mount of this card.
  // Idempotent: if rivals are already saved, no-op.
  useEffect(() => {
    if (career.rivals.length > 0) return;
    const rivals = allManagers
      .filter((m) => !m.isUser)
      .map((m) => ({
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
    // Rerolls / re-spin mechanic was removed from GOLAZO — no reset needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-10 rounded-2xl border-2 border-warning bg-warning/10 p-6 text-center">
      <div className="text-4xl mb-2">⚽</div>
      <div className="font-display text-3xl text-warning mb-2">Squad ready</div>
      <div className="text-sm text-muted-foreground mb-1">
        Your XI is locked. Average rating:{" "}
        <span className="text-warning font-display">{avg.toFixed(1)}</span>
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
