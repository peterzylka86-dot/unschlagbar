import { createFileRoute, Link } from "@tanstack/react-router";
import clubsData from "@/data/clubs.json";
import playersData from "@/data/players.json";
import { BrandMark, WordMark } from "@/components/BrandMark";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "UNSCHLAGBAR · 34:0 — Retro Football Draft" },
      { name: "description", content: "Spin the wheel, draft a perfect XI from six decades of German football, and chase the unbeaten season. A retro fan project." },
      { property: "og:title", content: "UNSCHLAGBAR · 34:0" },
      { property: "og:description", content: "Draft your XI, simulate a perfect season. Can you go 34:0?" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      {/* faint pitch lines backdrop */}
      <div className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent 0 42px, rgba(255,240,200,0.5) 42px 43px)" }} />

      <div className="relative w-full max-w-xl">
        {/* top retro stripe */}
        <div className="retro-stripes h-2 rounded-t-2xl" />

        <div className="retro-card rounded-b-2xl bg-card/70 backdrop-blur-md px-8 pt-10 pb-8 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="pixel-badge text-[11px]">SAISON 25/26</span>
            <span className="px-2 py-0.5 text-[10px] tracking-[0.25em] uppercase text-warning border border-warning/40 rounded-sm bg-warning/5">
              Manager-Modus
            </span>
          </div>

          <div className="mt-7 flex flex-col items-center gap-4">
            <BrandMark size="xl" to={undefined} />
            <WordMark className="text-[11px] sm:text-xs text-warning/90" />
            {/* Anstoss-style CRT scoreboard */}
            <div className="scoreboard scanlines rounded-sm mt-1 text-xl">
              <span className="opacity-70">SPIELE</span>{" "}
              <span>34</span>
              <span className="mx-2 opacity-50">|</span>
              <span className="opacity-70">NIEDERLAGEN</span>{" "}
              <span>00</span>
            </div>
          </div>

          <div className="mt-7 mx-auto w-24 h-px bg-warning/40" />

          <p className="mt-6 text-base sm:text-lg text-foreground/85 font-light">
            Draft a perfect XI from six decades of <span className="text-warning">retro German football</span>.<br />
            Spin the wheel. Pick your players.
          </p>
          <p className="mt-2 text-sm text-muted-foreground italic">
            Can you go unbeaten — 34 matches, zero defeats?
          </p>

          <Link
            to="/game"
            search={{ new: true }}
            className="mt-9 inline-flex items-center gap-2 px-8 py-4 rounded-md bg-primary text-primary-foreground font-display text-xl tracking-[0.15em] uppercase shadow-[0_18px_40px_-10px] shadow-primary/70 hover:brightness-110 hover:-translate-y-0.5 transition border border-primary-foreground/10"
          >
            Anpfiff <span aria-hidden>→</span>
          </Link>

          <div className="mt-10 grid grid-cols-3 gap-2 text-center">
            <Stat value={String(clubsData.length)} label="Vereine" />
            <Stat value={`${Math.floor(playersData.length / 50) * 50}+`} label="Spieler" />
            <Stat value="60+" label="Jahre" />
          </div>

          {/* Anstoss-style ticker */}
          <div className="ticker mt-8 rounded-sm">
            <div className="ticker-track">
              <span>TRANSFERFENSTER GEÖFFNET</span>
              <span>RAHN TRIFFT AUS 20 METERN</span>
              <span>UERDINGEN BEZWINGT DYNAMO 7:3</span>
              <span>NETZER ÜBERNIMMT DAS MITTELFELD</span>
              <span>BREITNER KEHRT ZURÜCK</span>
              <span>EFFENBERG MIT GELB-ROT</span>
              <span>KAHN HÄLT ALLES</span>
              <span>BUNDESLIGA-LEGENDE GIBT COMEBACK</span>
            </div>
          </div>

          {/* bottom retro stripe */}
          <div className="retro-stripes h-1.5 rounded mt-6 opacity-80" />
        </div>
      </div>

      <footer className="absolute bottom-5 left-0 right-0 text-center text-[11px] text-muted-foreground px-4">
        Inspired by{" "}
        <a href="https://82-0.com" className="underline hover:text-warning" target="_blank" rel="noreferrer">82-0.com</a>
        {" "}· A fun fan project — not affiliated with the Bundesliga, DFL, or any club shown.
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-t border-warning/20 pt-3">
      <div className="font-display text-3xl text-warning leading-none">{value}</div>
      <div className="mt-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
    </div>
  );
}
