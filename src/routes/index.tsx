import { createFileRoute, Link } from "@tanstack/react-router";
import clubsData from "@/data/clubs.json";
import playersData from "@/data/players.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "34-0 — Bundesliga Draft Game" },
      { name: "description", content: "Draft the greatest Bundesliga XI of all time. Spin the wheel, pick your players, can you go unbeaten for 34 matches?" },
      { property: "og:title", content: "34-0 — Bundesliga Draft Game" },
      { property: "og:description", content: "Draft your XI, simulate a perfect Bundesliga season. Can you go 34-0?" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 60% 50% at 50% 40%, color-mix(in oklab, var(--color-primary) 22%, transparent), transparent 70%)" }} />
      <div className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent 0 38px, rgba(255,255,255,0.18) 38px 39px)" }} />
      <div
        className="relative w-full max-w-xl rounded-2xl border bg-card/40 backdrop-blur-md px-8 py-12 text-center"
        style={{ boxShadow: "0 40px 100px -30px rgba(220, 5, 21, 0.35)" }}
      >
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-warning/40 bg-warning/10 text-warning text-xs font-semibold tracking-widest uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
          Bundesliga Draft Game
        </div>

        <h1 className="mt-8 font-display text-7xl sm:text-8xl text-foreground leading-none text-shadow-glow">
          34<span className="inline-block align-middle mx-1 w-10 h-3 sm:w-14 sm:h-4 bg-primary rounded-sm shadow-[0_0_24px] shadow-primary/80" />0
        </h1>

        <p className="mt-8 text-lg text-foreground/85">
          Draft the greatest Bundesliga XI of all time.<br />
          Simulate a perfect season.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Spin the wheel. Pick your players. Can you go unbeaten?
        </p>

        <Link
          to="/game"
          search={{ new: true }}
          className="mt-8 inline-flex items-center gap-2 px-7 py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-lg shadow-[0_18px_40px_-10px] shadow-primary/70 hover:brightness-110 hover:-translate-y-0.5 transition"
        >
          Start New Run <span aria-hidden>→</span>
        </Link>

        <div className="mt-10 grid grid-cols-3 gap-2 text-center">
          <Stat value={String(clubsData.length)} label="Bundesliga Clubs" />
          <Stat value={`${Math.floor(playersData.length / 100) * 100}+`} label="Players" />
          <Stat value="60+" label="Years of History" />
        </div>
      </div>

      <footer className="absolute bottom-6 left-0 right-0 text-center text-xs text-muted-foreground">
        Inspired by <a href="https://38-0.app" className="underline hover:text-foreground" target="_blank" rel="noreferrer">38-0.app</a>. Fan project · not affiliated with the Bundesliga.
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-display text-2xl text-foreground">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
