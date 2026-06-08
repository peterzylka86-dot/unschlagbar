import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BrandMark, WordMark } from "@/components/BrandMark";
import { decodeChallenge } from "@/lib/share";
import { useGame } from "@/lib/store";
import { dailySeed, getDaily, getDailyStreak } from "@/lib/daily";

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

  // Daily snapshot — read once on mount to keep SSR/CSR matched. The card
  // shows streak + whether today is still playable; the route /daily owns
  // the actual play flow.
  const [daily, setDaily] = useState<{ played: boolean; streak: number } | null>(null);
  useEffect(() => {
    const seed = dailySeed();
    setDaily({ played: !!getDaily(seed), streak: getDailyStreak() });
  }, []);
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
    // Vertical layout: card centers in the available space, footer always
    // lives in the natural flow below it. Previous structure absolutely-
    // positioned the footer at `bottom-5` over the viewport; on phones
    // where the card was taller than (viewport − 20px), the footer
    // collided with the card's bottom retro-stripes element. Fix is
    // structural — keep footer in flow, drop the absolute positioning.
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
          {/* Type hierarchy — 4 sizes only:
              • display: BrandMark
              • heading: text-lg (CTAs)
              • body: text-sm (descriptions, league list)
              • meta: text-[11px] uppercase tracked (badges, labels)
              All semantic colors via theme tokens (warning/primary/foreground)
              — no inline hex on this screen. */}
          <span className="pixel-badge text-[11px]">SEASON 25/26</span>

          <div className="mt-6 flex flex-col items-center gap-4">
            <BrandMark size="xl" to={undefined} />
            <WordMark className="text-[11px] text-warning/90" />
            <div className="scoreboard scanlines rounded-sm mt-1 text-lg">
              <span className="opacity-70">GAMES</span> <span>34</span>
              <span className="mx-2 opacity-50">|</span>
              <span className="opacity-70">LOSSES</span> <span>00</span>
            </div>
          </div>

          <div className="mt-6 mx-auto w-24 h-px bg-warning/40" />

          <p className="mt-5 text-sm text-foreground/85 font-light">
            Draft a perfect XI from{" "}
            <span className="text-warning">six decades of football</span>. Chase the unbeaten
            season.
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground tracking-wide">
            🌎 WC 2026 LIVE · 🏆 UCL · 🇩🇪 BL · 🇪🇸 LL · 🇮🇹 SA · 🇨🇭 SL · ♀ W
          </p>

          {/* Primary CTA — bigger, solid fill, drop shadow. Quick match is
              the lower-commitment entry, so it gets first-class treatment.
              Daily is shown above it as a daily-return hook.
              GOLAZO is a richer mode for users ready to invest. */}
          <div className="mt-9 flex flex-col items-stretch gap-3">
            {/* Daily card — same wheel for everyone today. The genre
                standard (RoadTo38, 17-0, 82-0+ all ship this). Shows
                streak when present; greys to "✓ played today" once done. */}
            <Link
              to="/daily"
              className="group inline-flex items-center justify-between gap-3 px-5 py-3 rounded-md border-2 border-warning/40 bg-warning/5 text-warning hover:bg-warning/10 hover:-translate-y-0.5 transition"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🗓️</span>
                <div className="text-left">
                  <div className="font-display text-sm tracking-[0.16em] uppercase">
                    Daily Challenge
                  </div>
                  <div className="text-[10px] tracking-[0.1em] text-muted-foreground normal-case">
                    {daily?.played
                      ? "✓ Played today — see your result"
                      : "Same wheel · everyone today"}
                  </div>
                </div>
              </div>
              {daily && daily.streak > 0 && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-warning/15 border border-warning/30">
                  <span className="text-sm">🔥</span>
                  <span className="font-display text-sm leading-none">{daily.streak}</span>
                </div>
              )}
            </Link>
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

          <div className="mt-8 grid grid-cols-3 gap-2 text-center">
            <Stat value="8" label="Competitions" />
            <Stat value="340+" label="Clubs" />
            <Stat value="60+" label="Years" />
          </div>

          {/* Ticker removed — it was charming but distracted attention from
              the primary CTAs above. Retro-pixel identity is carried by
              the stripes, scanlines, scoreboard, and BrandMark — the
              ticker was overkill. */}

          <div className="retro-stripes h-1.5 rounded mt-6 opacity-80" />
        </div>
      </div>

      {/* Footer lives in the natural flow at the bottom of the column.
          With `justify-between` on the outer flex, the card centers in
          the available space (via my-auto) and the footer pins to the
          column's end — never overlapping the card. */}
      <footer className="relative w-full max-w-xl text-center text-[11px] text-muted-foreground mt-6">
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
  // Display + meta — same hierarchy as the rest of the landing.
  return (
    <div className="border-t border-warning/20 pt-3">
      <div className="font-display text-2xl text-warning leading-none">{value}</div>
      <div className="mt-1.5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
