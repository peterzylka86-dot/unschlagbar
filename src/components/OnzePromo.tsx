/**
 * Cross-promo to Onze (onzedaily.com) — send some of Unschlagbar's visitor
 * traffic to the sister game. Two surfaces: a prominent card (landing / hub /
 * recap) and a tiny always-present footer link.
 */

const ONZE_URL = "https://onzedaily.com";

/** The prominent promo card — styled to match the retro look. */
export function OnzeCard({ className = "" }: { className?: string }) {
  return (
    <a
      href={ONZE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`group flex items-center justify-between gap-3 px-4 py-3 rounded-md border border-warning/40 bg-warning/5 hover:bg-warning/10 hover:-translate-y-0.5 transition text-left ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-2xl shrink-0">⚽</span>
        <div className="min-w-0">
          <div className="font-display text-sm tracking-[0.12em] uppercase text-warning leading-tight">
            Also from us · ONZE
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
            The daily football XI guessing game — a new squad every day
          </div>
        </div>
      </div>
      <span
        aria-hidden
        className="text-[11px] font-display text-warning/80 shrink-0 group-hover:text-warning"
      >
        onzedaily.com →
      </span>
    </a>
  );
}

/** A tiny footer link for every screen. */
export function OnzeFooterLink({ className = "" }: { className?: string }) {
  return (
    <a
      href={ONZE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-[11px] text-muted-foreground hover:text-warning transition ${className}`}
    >
      ⚽ Play <span className="text-warning/90">Onze</span> — the daily football puzzle
    </a>
  );
}
