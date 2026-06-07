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
      {
        name: "description",
        content:
          "Pick your league, draft a perfect XI from six decades of football, and chase the unbeaten season. A retro fan project.",
      },
      { property: "og:title", content: "UNSCHLAGBAR · 34:0" },
      {
        property: "og:description",
        content: "Draft your XI, simulate a perfect season. Can you go unbeaten?",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { challenge } = Route.useSearch();
  const navigate = useNavigate();
  const setConfig = useGame((s) => s.setConfig);
  const reset = useGame((s) => s.reset);
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
      // Carry the challenger's score (if present) into store so /result
      // can render the comparison + "send your score back" CTA.
      challengerScore: payload.challenger,
    });
    reset();
    navigate({ to: "/game", search: { new: true } });
  }, [challenge, setConfig, reset, navigate]);
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent 0 42px, rgba(255,240,200,0.5) 42px 43px)",
        }}
      />

      <div className="relative w-full max-w-xl">
        <div className="retro-stripes h-2 rounded-t-2xl" />

        <div className="retro-card rounded-b-2xl bg-card/70 backdrop-blur-md px-8 pt-10 pb-8 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="pixel-badge text-[11px]">SEASON 25/26</span>
            <span className="px-2 py-0.5 text-[10px] tracking-[0.25em] uppercase text-warning border border-warning/40 rounded-sm bg-warning/5">
              Manager Mode
            </span>
          </div>

          <div className="mt-7 flex flex-col items-center gap-4">
            <BrandMark size="xl" to={undefined} />
            <WordMark className="text-[11px] sm:text-xs text-warning/90" />
            <div className="scoreboard scanlines rounded-sm mt-1 text-xl">
              <span className="opacity-70">GAMES</span> <span>34</span>
              <span className="mx-2 opacity-50">|</span>
              <span className="opacity-70">LOSSES</span> <span>00</span>
            </div>
          </div>

          <div className="mt-7 mx-auto w-24 h-px bg-warning/40" />

          <p className="mt-6 text-base sm:text-lg text-foreground/85 font-light">
            Pick your league. Draft a perfect XI from{" "}
            <span className="text-warning">six decades of football</span>.<br />
            Spin the wheel. Chase the unbeaten season.
          </p>
          <p className="mt-2 text-sm text-muted-foreground italic">
            🌎 LIVE World Cup 2026 · 🏆 Champions League
            <br />
            🇩🇪 Bundesliga · 🇪🇸 La Liga · 🇮🇹 Serie A · 🇨🇭 Super League · ♀ Women's
          </p>

          {/* Primary CTA — bigger, solid fill, drop shadow. Quick match is
              the lower-commitment entry, so it gets first-class treatment.
              GOLAZO is a richer mode for users ready to invest. */}
          <div className="mt-9 flex flex-col items-stretch gap-3">
            <Link
              to="/game"
              search={{ new: true }}
              className="group inline-flex flex-col items-center gap-1 px-6 py-5 rounded-md bg-primary text-primary-foreground font-display text-lg tracking-[0.15em] uppercase shadow-[0_18px_40px_-10px] shadow-primary/70 hover:brightness-110 hover:-translate-y-0.5 transition border border-primary-foreground/10"
            >
              <span className="flex items-center gap-2">
                ⚡ Kick-off <span aria-hidden>→</span>
              </span>
              <span className="text-[10px] tracking-[0.18em] normal-case opacity-80">
                One match · 5–30 min
              </span>
            </Link>
            <Link
              to="/career"
              className="group inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md text-warning/90 font-display text-sm tracking-[0.18em] uppercase border border-warning/30 bg-transparent hover:bg-warning/10 hover:text-warning transition"
            >
              <span>🌟 GOLAZO career</span>
              <span className="text-[10px] tracking-[0.16em] normal-case opacity-70">
                · multi-season legacy
              </span>
              <span aria-hidden className="opacity-60">
                →
              </span>
            </Link>
          </div>

          <div className="mt-10 grid grid-cols-3 gap-2 text-center">
            <Stat value="8" label="Competitions" />
            <Stat value="340+" label="Clubs" />
            <Stat value="60+" label="Years" />
          </div>

          <div className="ticker mt-8 rounded-sm">
            <div className="ticker-track">
              <span>TRANSFER WINDOW OPEN</span>
              <span>RAHN SCORES FROM 20 YARDS</span>
              <span>BARÇA TAKE RECORD WIN</span>
              <span>JUVE DOMINATE TURIN</span>
              <span>YOUNG BOYS STAY ON TOP</span>
              <span>EFFENBERG SENT OFF</span>
              <span>KAHN SAVES EVERYTHING</span>
              <span>LEGEND MAKES COMEBACK</span>
            </div>
          </div>

          <div className="retro-stripes h-1.5 rounded mt-6 opacity-80" />
        </div>
      </div>

      <footer className="absolute bottom-5 left-0 right-0 text-center text-[11px] text-muted-foreground px-4">
        Inspired by{" "}
        <a
          href="https://82-0.com"
          className="underline hover:text-warning"
          target="_blank"
          rel="noreferrer"
        >
          82-0.com
        </a>{" "}
        · A fun fan project — not affiliated with any league or club shown.
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-t border-warning/20 pt-3">
      <div className="font-display text-3xl text-warning leading-none">{value}</div>
      <div className="mt-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
