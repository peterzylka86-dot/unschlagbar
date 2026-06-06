import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGame } from "@/lib/store";
import { FORMATIONS } from "@/lib/formations";
import { ClubBadge } from "@/components/ClubBadge";
import clubsData from "@/data/clubs.json";
import playersData from "@/data/players.json";
import type { Club, Player, Position, Slot } from "@/lib/game-types";

const CLUBS = clubsData as Club[];
const PLAYERS = playersData as Player[];

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
  const wheelRef = useRef<HTMLDivElement>(null);

  const formation = FORMATIONS[config.formation];
  const emptySlots = slots.filter(s => !s.player);
  const totalSlots = slots.length;
  const filledCount = totalSlots - emptySlots.length;
  const done = emptySlots.length === 0;

  function spinClub() {
    if (spinning) return;
    const pool = CLUBS.filter(c => !usedClubs.has(c.id));
    if (pool.length === 0) {
      // allow repeats if we run out
      setUsedClubs(new Set());
    }
    const candidates = pool.length ? pool : CLUBS;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const idx = CLUBS.findIndex(c => c.id === pick.id);
    const segAngle = 360 / CLUBS.length;
    const target = 360 * 6 + (360 - idx * segAngle - segAngle / 2);
    setSpinning(true);
    setAngle(prev => prev + target);
    setTimeout(() => {
      setSpinning(false);
      setCurrentClub(pick);
      setUsedClubs(prev => new Set(prev).add(pick.id));
    }, 3200);
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
  }

  function positionFirstPickPlayer(player: Player) {
    if (!pickingForSlot) return;
    assignPlayer(pickingForSlot.id, player);
    setUsedPlayers(prev => new Set(prev).add(`${player.club}:${player.name}`));
    setPickingForSlot(null);
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

  return (
    <div className="min-h-screen px-3 py-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-3">
        <Link to="/" className="font-display text-2xl">
          34<span className="inline-block align-middle mx-0.5 w-4 h-1.5 bg-primary rounded-sm" />0
        </Link>
        <div className="flex items-center gap-3 text-xs">
          <span className="px-2 py-1 rounded bg-card border">{config.formation}</span>
          <span className="px-2 py-1 rounded bg-card border">{filledCount}/{totalSlots}</span>
          <span className="px-2 py-1 rounded bg-warning/10 text-warning border border-warning/30">
            {rerollsLeft} reroll{rerollsLeft === 1 ? "" : "s"} left
          </span>
        </div>
      </header>

      <div className="mt-6 grid md:grid-cols-[1fr_360px] gap-6">
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
        <aside className="rounded-xl border bg-card/50 p-4 flex flex-col gap-4 min-h-[400px]">
          {done ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4">
              <h2 className="font-display text-3xl">Squad set.</h2>
              <p className="text-muted-foreground">Time to play 34 matches.</p>
              <button
                onClick={() => navigate({ to: "/season" })}
                className="px-6 py-3 rounded-xl bg-success text-success-foreground font-display tracking-wide hover:brightness-110"
              >
                Play Season →
              </button>
            </div>
          ) : assigningPlayer ? (
            <AssignPanel
              player={assigningPlayer}
              showRatings={config.showRatings}
              compatible={compatibleSlotsForAssign}
              onCancel={() => setAssigningPlayer(null)}
            />
          ) : config.draftMode === "position" && !pickingForSlot ? (
            <div className="text-center text-muted-foreground py-12">
              <p className="text-sm">Click an empty slot on the pitch to pick a position to fill.</p>
            </div>
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
            />
          ) : (
            <WheelPanel
              wheelRef={wheelRef}
              angle={angle}
              spinning={spinning}
              onSpin={spinClub}
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

function PitchView({ slots, showRatings, onSlotClick, highlightSlots }: {
  slots: Slot[];
  showRatings: boolean;
  onSlotClick: (s: Slot) => void;
  highlightSlots: string[];
}) {
  return (
    <div className="relative w-full rounded-xl border border-pitch-line/30 bg-pitch-pattern overflow-hidden" style={{ aspectRatio: "16/11" }}>
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
            className={`absolute -translate-x-1/2 -translate-y-1/2 group ${highlight ? "animate-pulse" : ""}`}
            style={{ left: `${s.x}%`, top: `${s.y}%` }}
          >
            <div
              className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition ${
                filled
                  ? "border-white/30 text-white"
                  : highlight
                  ? "bg-warning text-warning-foreground border-warning"
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
            </div>
            {filled && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] whitespace-nowrap max-w-[120px] truncate">
                {s.player!.name.split(" ").slice(-1)[0]}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function WheelPanel({ wheelRef, angle, spinning, onSpin, pickingForSlot, draftMode, onCancelSlot }: {
  wheelRef: React.RefObject<HTMLDivElement | null>;
  angle: number;
  spinning: boolean;
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
      <p className="text-sm text-muted-foreground">Spin the wheel to draw a club.</p>
      <div className="relative w-64 h-64">
        {/* pointer */}
        <div className="absolute top-1/2 right-[-6px] -translate-y-1/2 z-10">
          <div className="w-0 h-0 border-y-[10px] border-y-transparent border-r-[14px] border-r-warning" />
        </div>
        <motion.div
          ref={wheelRef}
          animate={{ rotate: angle }}
          transition={{ duration: 3.2, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 rounded-full border-4 border-card shadow-2xl"
        >
          <Wheel />
        </motion.div>
        <div className="absolute inset-[36%] rounded-full bg-card border border-border flex items-center justify-center font-display text-sm">
          SPIN
        </div>
      </div>
      <button
        onClick={onSpin}
        disabled={spinning}
        className="mt-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-display tracking-wide hover:brightness-110 disabled:opacity-50"
      >
        {spinning ? "Spinning…" : "Spin"}
      </button>
    </div>
  );
}

function Wheel() {
  const n = CLUBS.length;
  const r = 128;
  return (
    <svg viewBox="-130 -130 260 260" className="w-full h-full">
      {CLUBS.map((c, i) => {
        const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
        const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r;
        const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
        const d = `M0,0 L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} Z`;
        const am = (a0 + a1) / 2;
        const tx = Math.cos(am) * (r * 0.7);
        const ty = Math.sin(am) * (r * 0.7);
        return (
          <g key={c.id}>
            <path d={d} fill={c.color} stroke="rgba(0,0,0,0.25)" strokeWidth="0.5" />
            <text
              x={tx} y={ty}
              fontSize="7" fontWeight="900"
              fill="white"
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(${(am * 180) / Math.PI + 90} ${tx} ${ty})`}
              style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.4)", strokeWidth: 0.6 }}
            >
              {c.short}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PlayerPicker({ club, players, mode, showRatings, targetSlot, onPick, onReroll, rerollsLeft }: {
  club: Club;
  players: Player[];
  mode: "squad"|"position";
  showRatings: boolean;
  targetSlot: Slot | null;
  onPick: (p: Player) => void;
  onReroll?: () => void;
  rerollsLeft: number;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3">
        <ClubBadge club={club} />
        <div>
          <div className="font-display text-lg leading-tight">{club.name}</div>
          <div className="text-xs text-muted-foreground">Founded {club.founded} · {club.city}</div>
        </div>
      </div>
      {mode === "position" && targetSlot && (
        <div className="mt-3 text-xs text-muted-foreground">
          Filtered for <span className="text-warning font-display">{targetSlot.position}</span>-compatible players
        </div>
      )}
      <div className="mt-3 -mx-1 px-1 overflow-y-auto max-h-[420px] flex flex-col gap-1.5">
        {players.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No matching players from this club. {onReroll && "Try rerolling."}
          </p>
        )}
        {players.map(p => (
          <button
            key={p.name}
            onClick={() => onPick(p)}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-background/40 border border-border hover:border-warning hover:bg-background transition text-left"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{p.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {p.position} · {p.career_years} · {p.nationality}
              </div>
            </div>
            {showRatings && (
              <span className="font-display text-xl px-2 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
                {p.prime_rating}
              </span>
            )}
          </button>
        ))}
      </div>
      {onReroll && (
        <button
          onClick={onReroll}
          className="mt-3 px-4 py-2 text-xs rounded-lg border border-warning/40 text-warning hover:bg-warning/10"
        >
          Reroll wheel ({rerollsLeft} left)
        </button>
      )}
    </div>
  );
}

function AssignPanel({ player, showRatings, compatible, onCancel }: {
  player: Player;
  showRatings: boolean;
  compatible: Slot[];
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col h-full text-center">
      <h3 className="font-display text-xl">Assign to a slot</h3>
      <div className="mt-3 p-3 rounded-lg bg-background/40 border">
        <div className="font-medium">{player.name}</div>
        <div className="text-xs text-muted-foreground">{player.position} · {player.career_years}</div>
        {showRatings && (
          <div className="mt-1 font-display text-2xl text-warning">{player.prime_rating}</div>
        )}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        {compatible.length > 0
          ? "Click a glowing position on the pitch."
          : "No compatible empty slots remaining for this position."}
      </p>
      <button onClick={onCancel} className="mt-auto px-4 py-2 text-xs rounded-lg border hover:bg-background/50">
        Skip player
      </button>
    </div>
  );
}

export { AnimatePresence };
