import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGame } from "@/lib/store";
import { FORMATIONS } from "@/lib/formations";
import { ClubBadge } from "@/components/ClubBadge";
import clubsData from "@/data/clubs.json";
import playersData from "@/data/players.json";
import type { Club, Player, Position, Slot, EraTier } from "@/lib/game-types";

const CLUBS = clubsData as Club[];
const PLAYERS = playersData as Player[];

const TIERS: { id: EraTier; label: string; sub: string }[] = [
  { id: "current",  label: "Today",     sub: "2024/25" },
  { id: "2000s",    label: "2000s",     sub: "post-Bosman" },
  { id: "90s",      label: "90s",       sub: "Lautern & Uerdingen" },
  { id: "70s-80s",  label: "70s-80s",   sub: "old guard" },
  { id: "legends",  label: "Legends",   sub: "pre-Bundesliga" },
];

export const Route = createFileRoute("/draft")({
  head: () => ({ meta: [{ title: "Drafting — 34-0" }] }),
  component: DraftScreen,
});

function isCompatible(slotPos: Position, playerPos: Position): boolean {
  if (slotPos === playerPos) return true;
  const buckets: Record<string, Position[]> = {
    DEF: ["CB","RB","LB"],
    MID: ["CDM","CM","CAM"],
    ATT: ["LW","RW","ST"],
  };
  for (const list of Object.values(buckets)) {
    if (list.includes(slotPos) && list.includes(playerPos)) return true;
  }
  return false;
}

function DraftScreen() {
  const { config, slots, rerollsLeft, assignPlayer, consumeReroll } = useGame();
  const navigate = useNavigate();
  const [spinning, setSpinning] = useState(false);
  const [angle, setAngle] = useState(0);
  const [currentClub, setCurrentClub] = useState<Club | null>(null);
  const [pickingForSlot, setPickingForSlot] = useState<Slot | null>(null);
  const [usedPlayers, setUsedPlayers] = useState<Set<string>>(new Set());
  const [usedClubs, setUsedClubs] = useState<Set<string>>(new Set());
  const [assigningPlayer, setAssigningPlayer] = useState<Player | null>(null);
  const [tier, setTier] = useState<EraTier>("current");
  const [autoSpinHint, setAutoSpinHint] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null);

  const tierClubs = useMemo(() => CLUBS.filter(c => c.era_tier === tier), [tier]);

  const formation = FORMATIONS[config.formation];
  void formation;
  const emptySlots = slots.filter(s => !s.player);
  const totalSlots = slots.length;
  const filledCount = totalSlots - emptySlots.length;
  const done = emptySlots.length === 0;

  function pickRandomTier(): EraTier {
    const tiersWithFresh = TIERS.filter(t =>
      CLUBS.some(c => c.era_tier === t.id && !usedClubs.has(c.id))
    );
    const pool = tiersWithFresh.length ? tiersWithFresh : TIERS;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  function spinClub() {
    if (spinning) return;
    const activeTier = pickRandomTier();
    setTier(activeTier);
    const tierPool = CLUBS.filter(c => c.era_tier === activeTier);
    const fresh = tierPool.filter(c => !usedClubs.has(c.id));
    const candidates = fresh.length ? fresh : tierPool;
    if (!candidates.length) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const idx = tierPool.findIndex(c => c.id === pick.id);
    const segAngle = 360 / tierPool.length;
    const target = 360 * 6 + (360 - idx * segAngle - segAngle / 2);
    setSpinning(true);
    setAngle(prev => prev + target);
    setTimeout(() => {
      setSpinning(false);
      setCurrentClub(pick);
      setUsedClubs(prev => new Set(prev).add(pick.id));
    }, 3600);
  }

  function playersForCurrentClub(): Player[] {
    if (!currentClub) return [];
    let pool = PLAYERS.filter(p => p.club === currentClub.id && !usedPlayers.has(`${p.club}:${p.name}`));
    if (config.draftMode === "position" && pickingForSlot) {
      pool = pool.filter(p => isCompatible(pickingForSlot.position, p.position));
    }
    return pool.slice().sort((a, b) => b.prime_rating - a.prime_rating);
  }

  function handleSquadFirstPickPlayer(player: Player) {
    setAssigningPlayer(player);
  }

  function commitToSlot(slotId: string) {
    if (!assigningPlayer) return;
    assignPlayer(slotId, assigningPlayer);
    setUsedPlayers(prev => new Set(prev).add(`${assigningPlayer.club}:${assigningPlayer.name}`));
    setAssigningPlayer(null);
    setCurrentClub(null);
    queueAutoSpin();
  }

  function positionFirstPickPlayer(player: Player) {
    if (!pickingForSlot) return;
    assignPlayer(pickingForSlot.id, player);
    setUsedPlayers(prev => new Set(prev).add(`${player.club}:${player.name}`));
    setPickingForSlot(null);
    setCurrentClub(null);
    // position-first waits for user to click next slot, no auto-spin
  }

  function queueAutoSpin() {
    // auto-spin in squad-first mode if more slots remain
    if (config.draftMode !== "squad") return;
    const remaining = slots.filter(s => !s.player).length - 1; // we just filled one (state not yet flushed)
    if (remaining <= 0) return;
    setAutoSpinHint(true);
    setTimeout(() => {
      setAutoSpinHint(false);
      spinClub();
    }, 700);
  }

  function skipAssign() {
    setAssigningPlayer(null);
    setCurrentClub(null);
  }

  function startReroll() {
    if (!consumeReroll()) return;
    setCurrentClub(null);
    setAssigningPlayer(null);
  }

  const compatibleSlotsForAssign = useMemo(() => {
    if (!assigningPlayer) return [];
    return slots.filter(s => !s.player && isCompatible(s.position, assigningPlayer.position));
  }, [assigningPlayer, slots]);

  // auto-skip if no compatible slots
  useEffect(() => {
    if (assigningPlayer && compatibleSlotsForAssign.length === 0) {
      const t = setTimeout(skipAssign, 600);
      return () => clearTimeout(t);
    }
  }, [assigningPlayer, compatibleSlotsForAssign.length]);

  return (
    <div className="min-h-screen px-3 py-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-3">
        <Link to="/" className="font-display text-2xl">
          34<span className="inline-block align-middle mx-0.5 w-4 h-1.5 bg-primary rounded-sm" />0
        </Link>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-card border">{config.formation}</span>
          <span className="px-2 py-1 rounded bg-card border tabular-nums">{filledCount}/{totalSlots}</span>
          <span className="px-2 py-1 rounded bg-warning/10 text-warning border border-warning/30 tabular-nums">
            {rerollsLeft} reroll{rerollsLeft === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="mt-6 grid md:grid-cols-[1fr_380px] gap-6">
        {/* Pitch */}
        <PitchView
          slots={slots}
          showRatings={config.showRatings}
          highlightSlots={compatibleSlotsForAssign.map(s => s.id)}
          onSlotClick={(s) => {
            if (assigningPlayer && compatibleSlotsForAssign.some(c => c.id === s.id)) {
              commitToSlot(s.id);
            } else if (config.draftMode === "position" && !s.player && !currentClub) {
              setPickingForSlot(s);
            }
          }}
        />

        {/* Side panel */}
        <aside className="rounded-2xl border bg-card/40 backdrop-blur-sm p-4 flex flex-col gap-3 min-h-[460px] shadow-[0_30px_80px_-40px_rgba(220,5,21,0.4)]">
          {done ? (
            <DonePanel onContinue={() => navigate({ to: "/season" })} />
          ) : assigningPlayer ? (
            <AssignPanel
              player={assigningPlayer}
              showRatings={config.showRatings}
              compatible={compatibleSlotsForAssign}
              onCancel={skipAssign}
            />
          ) : config.draftMode === "position" && !pickingForSlot ? (
            <PositionPrompt />
          ) : currentClub ? (
            <PlayerPicker
              club={currentClub}
              players={playersForCurrentClub()}
              mode={config.draftMode}
              showRatings={config.showRatings}
              targetSlot={pickingForSlot}
              onPick={(p) => config.draftMode === "squad" ? handleSquadFirstPickPlayer(p) : positionFirstPickPlayer(p)}
              onReroll={rerollsLeft > 0 ? () => { startReroll(); spinClub(); } : undefined}
              rerollsLeft={rerollsLeft}
              onSkip={() => { setCurrentClub(null); queueAutoSpin(); }}
            />
          ) : (
            <WheelPanel
              wheelRef={wheelRef}
              angle={angle}
              spinning={spinning}
              autoSpinHint={autoSpinHint}
              tier={tier}
              tierClubs={tierClubs}
              onTier={(t) => { if (!spinning) setTier(t); }}
              onSpin={() => spinClub()}
              pickingForSlot={pickingForSlot}
              draftMode={config.draftMode}
              onCancelSlot={() => setPickingForSlot(null)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function DonePanel({ onContinue }: { onContinue: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center h-full text-center gap-4 py-8"
    >
      <div className="text-5xl">⚽</div>
      <h2 className="font-display text-3xl">Squad set.</h2>
      <p className="text-muted-foreground">34 matches stand between you and immortality.</p>
      <button
        onClick={onContinue}
        className="px-7 py-3 rounded-xl bg-primary text-primary-foreground font-display tracking-wide hover:brightness-110 shadow-[0_10px_30px_-10px] shadow-primary/60"
      >
        Play Season →
      </button>
    </motion.div>
  );
}

function PositionPrompt() {
  return (
    <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-16 gap-3">
      <div className="text-3xl opacity-50">⊕</div>
      <p className="text-sm max-w-[220px]">Tap an empty position on the pitch to pick which slot to fill next.</p>
    </div>
  );
}

function PitchView({ slots, showRatings, onSlotClick, highlightSlots }: {
  slots: Slot[];
  showRatings: boolean;
  onSlotClick: (s: Slot) => void;
  highlightSlots: string[];
}) {
  return (
    <div className="relative w-full rounded-2xl border border-pitch-line/30 bg-pitch-pattern overflow-hidden shadow-2xl" style={{ aspectRatio: "16/11" }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
        <rect x="1" y="1" width="98" height="98" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
        <circle cx="50" cy="50" r="9" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
        <rect x="25" y="0" width="50" height="14" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
        <rect x="25" y="86" width="50" height="14" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
      </svg>
      {slots.map(s => {
        const filled = !!s.player;
        const highlight = highlightSlots.includes(s.id);
        const club = filled ? CLUBS.find(c => c.id === s.player!.club) : null;
        return (
          <button
            key={s.id}
            onClick={() => onSlotClick(s)}
            className="absolute -translate-x-1/2 -translate-y-1/2 group"
            style={{ left: `${s.x}%`, top: `${s.y}%` }}
          >
            <motion.div
              initial={false}
              animate={filled ? { scale: [0.6, 1.1, 1], opacity: 1 } : highlight ? { scale: [1, 1.12, 1] } : { scale: 1, opacity: 1 }}
              transition={highlight ? { duration: 1.1, repeat: Infinity } : { duration: 0.35 }}
              className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition ${
                filled
                  ? "border-white/30 text-white shadow-[0_8px_18px_-4px_rgba(0,0,0,0.6)]"
                  : highlight
                  ? "bg-warning text-warning-foreground border-warning shadow-[0_0_22px_-2px] shadow-warning/70"
                  : "bg-success/80 text-success-foreground border-success-foreground/30 hover:scale-110"
              }`}
              style={filled && club ? {
                background: `linear-gradient(135deg, ${club.color}, color-mix(in oklab, ${club.color} 50%, black))`,
              } : undefined}
            >
              {filled ? (
                showRatings ? <span className="font-display text-base">{s.player!.prime_rating}</span>
                : s.position
              ) : s.position}
            </motion.div>
            {filled && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-1.5 py-0.5 rounded backdrop-blur-md bg-black/50 text-white text-[10px] whitespace-nowrap max-w-[120px] truncate border border-white/10">
                {s.player!.name.split(" ").slice(-1)[0]}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function WheelPanel({ wheelRef, angle, spinning, autoSpinHint, tier, tierClubs, onTier, onSpin, pickingForSlot, draftMode, onCancelSlot }: {
  wheelRef: React.RefObject<HTMLDivElement | null>;
  angle: number;
  spinning: boolean;
  autoSpinHint: boolean;
  tier: EraTier;
  tierClubs: Club[];
  onTier: (t: EraTier) => void;
  onSpin: () => void;
  pickingForSlot: Slot | null;
  draftMode: "squad"|"position";
  onCancelSlot: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-3">
      {draftMode === "position" && pickingForSlot && (
        <div className="w-full flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Filling slot:</span>
          <span className="px-2 py-1 rounded bg-warning/15 text-warning border border-warning/30 font-display">
            {pickingForSlot.position}
          </span>
          <button onClick={onCancelSlot} className="text-muted-foreground underline">change</button>
        </div>
      )}

      {/* Tier chips */}
      <div className="w-full flex flex-wrap gap-1 justify-center">
        {TIERS.map(t => (
          <button
            key={t.id}
            onClick={() => onTier(t.id)}
            disabled={spinning}
            className={`px-2.5 py-1 rounded-full text-[11px] font-display tracking-wide border transition ${
              tier === t.id
                ? "bg-primary text-primary-foreground border-primary shadow-[0_0_18px_-2px] shadow-primary/60"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            } disabled:opacity-40`}
            title={t.sub}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-muted-foreground -mt-1">
        {TIERS.find(t => t.id === tier)?.sub} · {tierClubs.length} clubs
      </div>

      <div className="relative w-64 h-64 mt-1">
        {/* glow */}
        <div className="absolute inset-[-12%] rounded-full pointer-events-none"
             style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--color-primary) 35%, transparent), transparent 65%)" }} />
        {/* pointer */}
        <div className="absolute top-1/2 right-[-10px] -translate-y-1/2 z-10">
          <div className="w-0 h-0 border-y-[12px] border-y-transparent border-r-[18px] border-r-warning drop-shadow-[0_0_8px_rgba(255,200,80,0.7)]" />
        </div>
        <motion.div
          ref={wheelRef}
          animate={{ rotate: angle }}
          transition={{ duration: 3.6, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 rounded-full border-[6px] border-card shadow-[0_24px_60px_-10px_rgba(0,0,0,0.7)]"
        >
          <Wheel clubs={tierClubs} />
        </motion.div>
        <div className="absolute inset-[36%] rounded-full bg-card border-2 border-border flex items-center justify-center font-display text-sm shadow-inner">
          {spinning ? "…" : "SPIN"}
        </div>
      </div>

      <button
        onClick={onSpin}
        disabled={spinning || autoSpinHint}
        className="mt-2 px-7 py-3 rounded-xl bg-primary text-primary-foreground font-display tracking-wide hover:brightness-110 disabled:opacity-50 shadow-[0_10px_30px_-12px] shadow-primary/70 transition"
      >
        {spinning ? "Spinning…" : autoSpinHint ? "Next club…" : "Spin"}
      </button>
    </div>
  );
}

function Wheel({ clubs }: { clubs: Club[] }) {
  const n = Math.max(1, clubs.length);
  const r = 128;
  const fs = n <= 12 ? 9 : n <= 18 ? 7 : 6;
  return (
    <svg viewBox="-130 -130 260 260" className="w-full h-full">
      {clubs.map((c, i) => {
        const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
        const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r;
        const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const d = `M0,0 L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
        const am = (a0 + a1) / 2;
        const tx = Math.cos(am) * (r * 0.68);
        const ty = Math.sin(am) * (r * 0.68);
        return (
          <g key={c.id}>
            <path d={d} fill={c.color} stroke="rgba(0,0,0,0.3)" strokeWidth="0.8" />
            <text
              x={tx} y={ty}
              fontSize={fs} fontWeight="900"
              fill="white"
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(${(am * 180) / Math.PI + 90} ${tx} ${ty})`}
              style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.5)", strokeWidth: 0.8 }}
            >
              {c.short}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PlayerPicker({ club, players, mode, showRatings, targetSlot, onPick, onReroll, rerollsLeft, onSkip }: {
  club: Club;
  players: Player[];
  mode: "squad"|"position";
  showRatings: boolean;
  targetSlot: Slot | null;
  onPick: (p: Player) => void;
  onReroll?: () => void;
  rerollsLeft: number;
  onSkip: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col h-full"
    >
      <div
        className="flex items-center gap-3 p-3 rounded-xl border border-white/10"
        style={{ background: `linear-gradient(135deg, color-mix(in oklab, ${club.color} 35%, transparent), transparent)` }}
      >
        <ClubBadge club={club} />
        <div className="min-w-0">
          <div className="font-display text-lg leading-tight truncate">{club.name}</div>
          <div className="text-xs text-muted-foreground">Founded {club.founded} · {club.city}</div>
        </div>
      </div>
      {mode === "position" && targetSlot && (
        <div className="mt-3 text-xs text-muted-foreground">
          Filtered for <span className="text-warning font-display">{targetSlot.position}</span>
        </div>
      )}
      <div className="mt-3 -mx-1 px-1 overflow-y-auto max-h-[380px] flex flex-col gap-1.5">
        {players.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No matching players from this club.
          </p>
        )}
        {players.map(p => (
          <button
            key={p.name}
            onClick={() => onPick(p)}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-background/50 border border-border hover:bg-background hover:-translate-y-0.5 transition text-left group"
            style={{ ["--club" as string]: club.color }}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate group-hover:text-warning">{p.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {p.position} · {p.career_years} · {p.nationality}
              </div>
            </div>
            {showRatings && (
              <span className="font-display text-xl px-2 py-0.5 rounded bg-warning/10 text-warning border border-warning/30 shadow-[0_0_12px_-4px] shadow-warning/60">
                {p.prime_rating}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        {onReroll && (
          <button
            onClick={onReroll}
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-warning/40 text-warning hover:bg-warning/10"
          >
            Reroll ({rerollsLeft})
          </button>
        )}
        <button
          onClick={onSkip}
          className="flex-1 px-3 py-2 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-background/50"
        >
          Skip club
        </button>
      </div>
    </motion.div>
  );
}

function AssignPanel({ player, showRatings, compatible, onCancel }: {
  player: Player;
  showRatings: boolean;
  compatible: Slot[];
  onCancel: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col h-full text-center"
    >
      <h3 className="font-display text-xl">Assign to a slot</h3>
      <div className="mt-3 p-4 rounded-xl bg-background/50 border border-warning/30 shadow-[0_0_24px_-8px] shadow-warning/40">
        <div className="font-medium text-lg">{player.name}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{player.position} · {player.career_years} · {player.nationality}</div>
        {showRatings && (
          <div className="mt-2 font-display text-3xl text-warning">{player.prime_rating}</div>
        )}
      </div>
      <p className="mt-5 text-sm text-muted-foreground">
        {compatible.length > 0
          ? "Tap a glowing position on the pitch."
          : "No compatible slots — skipping…"}
      </p>
      <button onClick={onCancel} className="mt-auto px-4 py-2 text-xs rounded-lg border hover:bg-background/50">
        Skip player
      </button>
    </motion.div>
  );
}

export { AnimatePresence };
