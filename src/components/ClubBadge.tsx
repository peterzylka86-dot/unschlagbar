import type { Club } from "@/lib/game-types";

export function ClubBadge({ club, size = 48 }: { club: Club; size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-md font-display text-white shrink-0"
      style={{
        width: size, height: size,
        background: `linear-gradient(135deg, ${club.color}, color-mix(in oklab, ${club.color} 60%, black))`,
        boxShadow: `0 4px 14px -2px ${club.color}55, inset 0 0 0 1px rgba(255,255,255,0.08)`,
        fontSize: size * 0.34,
        letterSpacing: "0.02em",
      }}
      title={club.name}
    >
      {club.short}
    </div>
  );
}
