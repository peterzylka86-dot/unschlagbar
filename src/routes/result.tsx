import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useGame } from "@/lib/store";
import { ClubBadge } from "@/components/ClubBadge";
import clubsData from "@/data/clubs.json";
import type { Club } from "@/lib/game-types";
import { squadRating } from "@/lib/sim";

const CLUBS = clubsData as Club[];

export const Route = createFileRoute("/result")({
  validateSearch: (s: Record<string, unknown>) => ({ unbeaten: s.unbeaten === true || s.unbeaten === "true" }),
  head: () => ({ meta: [{ title: "Ergebnis · UNSCHLAGBAR 34:0" }] }),
  component: ResultScreen,
});

function ResultScreen() {
  const { unbeaten } = Route.useSearch();
  const { slots, matches, reset } = useGame();
  const navigate = useNavigate();
  const rating = squadRating(slots);
  const wins = matches.filter(m => m.outcome === "W").length;
  const draws = matches.filter(m => m.outcome === "D").length;
  const losses = matches.filter(m => m.outcome === "L").length;
  const firstLoss = matches.find(m => m.outcome !== "W");

  return (
    <div className="min-h-screen px-4 py-12 max-w-3xl mx-auto text-center">
      {unbeaten ? (
        <>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-success/40 bg-success/10 text-success text-xs font-semibold tracking-widest uppercase">
            ★ Invincible ★
          </div>
          <h1 className="mt-6 brand-mark text-8xl text-success">34<span className="text-warning">:</span>0</h1>
          <p className="mt-4 text-xl">Your XI went unbeaten.</p>
        </>
      ) : (
        <>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-destructive/40 bg-destructive/10 text-destructive text-xs font-semibold tracking-widest uppercase">
            Run ended
          </div>
          <h1 className="mt-6 font-display text-6xl">{wins}-{draws}-{losses}</h1>
          {firstLoss && (
            <p className="mt-4 text-muted-foreground">
              Dropped points on matchday {firstLoss.matchday} {firstLoss.home ? "vs" : "@"} {firstLoss.opponent.name} ({firstLoss.ourScore}-{firstLoss.theirScore}).
            </p>
          )}
        </>
      )}

      <div className="mt-10">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Your XI · {rating} overall</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {slots.map(s => {
            const club = s.player ? CLUBS.find(c => c.id === s.player!.club) : null;
            return (
              <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg border bg-card text-left">
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

      <div className="mt-10 flex justify-center gap-3 flex-wrap">
        <button
          onClick={() => { reset(); navigate({ to: "/game", search: { new: true } }); }}
          className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-display tracking-wide hover:brightness-110"
        >
          New Run
        </button>
        <Link to="/" className="px-6 py-3 rounded-xl border hover:bg-card font-display tracking-wide">
          Home
        </Link>
      </div>
    </div>
  );
}
