import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandMark, WordMark } from "@/components/BrandMark";
import { useCareer } from "@/lib/career-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "UNSCHLAGBAR · GOLAZO — Football Management" },
      {
        name: "description",
        content:
          "GOLAZO — build a club from real legends or today's stars, manage your squad season after season, and chase a perfect dynasty. A retro football-management fan project.",
      },
      { property: "og:title", content: "UNSCHLAGBAR · GOLAZO" },
      {
        property: "og:description",
        content: "Draft your club, manage the dressing room, unearth wonderkids, build a dynasty.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const hasCareer = useCareer((s) => s.foundingClubId !== null);
  const season = useCareer((s) => s.currentSeason);

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-between px-4 py-6 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent 0 42px, rgba(255,240,200,0.5) 42px 43px)",
        }}
      />

      <div className="relative w-full max-w-xl my-auto">
        <div className="retro-stripes h-2 rounded-t-2xl" />

        <div className="retro-card rounded-b-2xl bg-card/70 backdrop-blur-md px-6 sm:px-8 pt-8 pb-6 text-center">
          <span className="pixel-badge text-[11px]">GOLAZO · MANAGER MODE</span>

          <div className="mt-6 flex flex-col items-center gap-4">
            <BrandMark size="xl" to={undefined} />
            <WordMark className="text-[11px] text-warning/90" />
            <div className="scoreboard scanlines rounded-sm mt-1 text-lg">
              <span className="opacity-70">GOLAZO</span>
              <span className="mx-2 opacity-50">|</span>
              <span className="opacity-70">DYNASTY</span>
            </div>
          </div>

          <div className="mt-6 mx-auto w-24 h-px bg-warning/40" />

          <p className="mt-5 text-sm text-foreground/85 font-light">
            Build a club from <span className="text-warning">real legends or today's stars</span>,
            run the dressing room, unearth wonderkids, and chase a dynasty across the seasons.
          </p>

          <div className="mt-9 flex flex-col items-stretch gap-3">
            <Link
              to="/career"
              className="group inline-flex items-center justify-between gap-3 px-6 py-5 rounded-md bg-warning text-background font-semibold shadow-[0_18px_40px_-10px] shadow-warning/60 border border-warning/30 transition hover:-translate-y-0.5 hover:brightness-110"
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">🌟</span>
                <div className="text-left">
                  <div className="font-display text-lg tracking-[0.15em] uppercase leading-tight">
                    {hasCareer ? "Continue career" : "Start your GOLAZO"}
                  </div>
                  <div className="text-[11px] tracking-[0.12em] normal-case opacity-80 mt-0.5">
                    {hasCareer ? `Season ${season} in progress` : "Pick a club · draft · build a dynasty"}
                  </div>
                </div>
              </div>
              <span aria-hidden className="opacity-70">
                →
              </span>
            </Link>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-2 text-center">
            <Stat value="Real" label="Current stars" />
            <Stat value="Legends" label="All-time greats" />
            <Stat value="∞" label="Seasons" />
          </div>

          <div className="retro-stripes h-1.5 rounded mt-6 opacity-80" />
        </div>
      </div>

      <footer className="relative w-full max-w-xl text-center text-[11px] text-muted-foreground mt-6">
        A fun fan project — not affiliated with any league or club shown.
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-t border-warning/20 pt-3">
      <div className="font-display text-2xl text-warning leading-none">{value}</div>
      <div className="mt-1.5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
