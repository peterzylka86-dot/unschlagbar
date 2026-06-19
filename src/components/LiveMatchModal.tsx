/**
 * The Championship-Manager moment: a played match unfolds as a timed ticker.
 * Auto-advances ~1 event/650ms; the running score updates as goals land; Skip
 * jumps to full time; dismiss to return. Shared by the league season AND the
 * European nights so a Champions League match plays exactly like a league one.
 */
import { useEffect, useState } from "react";
import type { LiveEvent } from "@/lib/matchlive";

export function LiveMatchModal({
  live,
  onClose,
}: {
  live: {
    events: LiveEvent[];
    /** Top label, e.g. "Matchday 14" or "Champions League · Quarter-final". */
    label: string;
    oppName: string;
    ourScore: number;
    theirScore: number;
  };
  onClose: () => void;
}) {
  const [shown, setShown] = useState(1);
  const done = shown >= live.events.length;
  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setShown((n) => n + 1), 650);
    return () => clearTimeout(t);
  }, [shown, done]);

  const revealed = live.events.slice(0, shown);
  const us = revealed.filter((e) => e.type === "goal-us").length;
  const them = revealed.filter((e) => e.type === "goal-them").length;

  const icon = (t: LiveEvent["type"]) =>
    t === "goal-us" ? "⚽" : t === "goal-them" ? "💥" : t === "yellow" ? "🟨" : t === "red" ? "🟥" : t === "injury" ? "🚑" : t === "ht" ? "⏸️" : t === "ft" ? "🏁" : "🔊";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-background/90 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {live.label} · LIVE
          </div>
          <div className="mt-1 font-display text-3xl text-warning tabular-nums">
            {us} <span className="opacity-50 text-xl">–</span> {them}
          </div>
          <div className="text-[11px] text-muted-foreground">vs {live.oppName}</div>
        </div>

        <div className="mt-4 space-y-1.5 max-h-64 overflow-y-auto">
          {revealed.map((e, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 text-xs ${
                e.type === "goal-us"
                  ? "text-success"
                  : e.type === "goal-them"
                    ? "text-primary"
                    : e.type === "injury"
                      ? "text-primary/90"
                      : "text-foreground/80"
              }`}
            >
              <span className="font-mono text-[10px] text-muted-foreground w-7 shrink-0 text-right">
                {e.type === "ko" ? "" : e.type === "ft" ? "FT" : `${e.minute}'`}
              </span>
              <span className="shrink-0">{icon(e.type)}</span>
              <span>{e.text}</span>
            </div>
          ))}
        </div>

        <button
          onClick={done ? onClose : () => setShown(live.events.length)}
          className="mt-4 w-full px-4 py-2.5 rounded-md bg-warning text-warning-foreground font-display tracking-wide hover:brightness-110 transition"
        >
          {done ? "Continue →" : "Skip to full time ⏭"}
        </button>
      </div>
    </div>
  );
}
