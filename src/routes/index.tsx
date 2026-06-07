import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { BrandMark, WordMark } from "@/components/BrandMark";
import { decodeChallenge } from "@/lib/share";
import { useGame } from "@/lib/store";

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>) => ({
    challenge: typeof s.challenge === "string" ? s.challenge : undefined,
  }),
  head: () => ({
    meta: [
      { title: "UNSCHLAGBAR · 34:0 — Retro Football Draft" },
      { name: "description", content: "Pick your league, draft a perfect XI from six decades of football, and chase the unbeaten season. A retro fan project." },
      { property: "og:title", content: "UNSCHLAGBAR · 34:0" },
      { property: "og:description", content: "Draft your XI, simulate a perfect season. Can you go unbeaten?" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { challenge } = Route.useSearch();
  const navigate = useNavigate();
  const setConfig = useGame(s => s.setConfig);
  const reset = useGame(s => s.reset);
  useEffect(() => {
    if (!challenge) return;
    const payload = decodeChallenge(challenge);
    if (!payload) return;
    setConfig({
      league: payload.league,
      formation: payload.formation,
      difficulty: payload.difficulty,
      ratingMode: payload.ratingMode,
      draftMode: payload.draftMode,
      showRatings: payload.showRatings,
      challengeSeed: payload.seed,
    });
    reset();
    navigate({ to: "/game", search: { new: true } });
  }, [challenge, setConfig, reset, navigate]);
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      <div className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent 0 42px, rgba(255,240,200,0.5) 42px 43px)" }} />

      <div className="relative w-full max-w-xl">
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
            Pick your league. Draft a perfect XI from <span className="text-warning">six decades of football</span>.<br />
            Spin the wheel. Chase the unbeaten season.
          </p>
          <p className="mt-2 text-sm text-muted-foreground italic">
            🇩🇪 Bundesliga · 🇪🇸 La Liga · 🇮🇹 Serie A · 🇨🇭 Super League
          </p>

          <Link
            to="/game"
            search={{ new: true }}
            className="mt-9 inline-flex items-center gap-2 px-8 py-4 rounded-md bg-primary text-primary-foreground font-display text-xl tracking-[0.15em] uppercase shadow-[0_18px_40px_-10px] shadow-primary/70 hover:brightness-110 hover:-translate-y-0.5 transition border border-primary-foreground/10"
          >
            Kick-off <span aria-hidden>→</span>
          </Link>

          <div className="mt-10 grid grid-cols-3 gap-2 text-center">
            <Stat value="7" label="Competitions" />
            <Stat value="200+" label="Clubs" />
            <Stat value="60+" label="Years" />
          </div>

          <div className="ticker mt-8 rounded-sm">
            <div className="ticker-track">
              <span>TRANSFERFENSTER GEÖFFNET</span>
              <span>RAHN TRIFFT AUS 20 METERN</span>
              <span>BARÇA HOLT REKORDSIEG</span>
              <span>JUVE DOMINIERT TURIN</span>
              <span>YOUNG BOYS BLEIBEN OBEN</span>
              <span>EFFENBERG MIT GELB-ROT</span>
              <span>KAHN HÄLT ALLES</span>
              <span>LEGENDE GIBT COMEBACK</span>
            </div>
          </div>

          <div className="retro-stripes h-1.5 rounded mt-6 opacity-80" />
        </div>
      </div>

      <footer className="absolute bottom-5 left-0 right-0 text-center text-[11px] text-muted-foreground px-4">
        Inspired by{" "}
        <a href="https://82-0.com" className="underline hover:text-warning" target="_blank" rel="noreferrer">82-0.com</a>
        {" "}· A fun fan project — not affiliated with any league or club shown.
        <br />
        Want a multi-season career?{" "}
        <a href="https://golazo.app" className="underline hover:text-warning" target="_blank" rel="noreferrer">Try GOLAZO →</a>
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
