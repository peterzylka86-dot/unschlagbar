import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useGame } from "@/lib/store";
import { FORMATIONS, FORMATION_KEYS } from "@/lib/formations";
import { LEAGUES, LEAGUE_IDS } from "@/lib/leagues";
import { getPlayers, getClubs } from "@/lib/data";
import { useMemo, useState } from "react";
import type { CompetitionKind } from "@/lib/leagues";
import type { Difficulty, DraftMode, RatingMode, Player } from "@/lib/game-types";

/**
 * Group competitions by time commitment so the user picks "how long
 * do I have" first, "which league specifically" second.
 *
 * UX colour discipline (post-cleanup):
 *   warning (gold) — SELECTED state for any option/chip/card. The brand
 *   primary (red)  — bold CTAs + destructive only
 *   success (green)— positive outcomes (W match, ✓ picked) only
 *   muted-foreground — group headers, hints, inactive
 *
 * Group headers use neutral text — the icon carries the personality, not
 * a color swatch that competes with the selected-state highlight.
 */
const COMPETITION_GROUPS: {
  id: string;
  title: string;
  icon: string;
  timeHint: string;
  kinds: CompetitionKind[];
}[] = [
  { id: "quick", title: "Quick", icon: "⚡", timeHint: "5–10 min · knockout", kinds: ["knockout"] },
  {
    id: "tournament",
    title: "Tournament",
    icon: "🏆",
    timeHint: "15–20 min · group + KO",
    kinds: ["groupKO"],
  },
  {
    id: "season",
    title: "Full Season",
    icon: "📅",
    timeHint: "20–30 min · full league",
    kinds: ["league"],
  },
];

export const Route = createFileRoute("/game")({
  validateSearch: (s: Record<string, unknown>) => ({ new: s.new === true || s.new === "true" }),
  head: () => ({ meta: [{ title: "Setup · UNSCHLAGBAR" }] }),
  component: GameSetup,
});

function GameSetup() {
  const { config, setConfig, reset, slots } = useGame();
  const formation = FORMATIONS[config.formation];
  const league = LEAGUES[config.league];
  const navigate = useNavigate();
  // Customize drawer — closed by default so first-time visitors see
  // exactly one decision (pick a league) + one action (Start). User
  // feedback ("zu viele verschiedene Optionen, bin etwas überfordert")
  // drove this restructure.
  const [customizeOpen, setCustomizeOpen] = useState(false);

  return (
    <div className="min-h-screen px-4 py-10 max-w-3xl mx-auto">
      <header className="text-center">
        <Link to="/" className="inline-block">
          <h1 className="brand-mark text-5xl inline-flex items-baseline gap-1 leading-none">
            <span>{league.brandMark.split(":")[0]}</span>
            <span className="text-primary">:</span>
            <span>{league.brandMark.split(":")[1]}</span>
          </h1>
          <div className="text-[10px] tracking-[0.3em] text-warning/80 mt-1">{league.tagline}</div>
        </Link>
        <p className="mt-2 text-muted-foreground">Draft your greatest {league.name} XI</p>
      </header>

      {/* Challenge-from-friend banner — shows when the user opened a
          shared URL that carries the challenger's score. Path B of the
          async-multiplayer roadmap: see what to beat before you spin. */}
      {config.challengerScore && (
        <div className="mt-6 p-4 rounded-xl border-2 border-primary/60 bg-primary/10 text-center">
          <div className="text-[10px] uppercase tracking-[0.25em] text-primary mb-1">
            🎯 Challenge accepted
          </div>
          <div className="font-display text-base text-foreground">
            {config.challengerScore.name ?? "Your friend"} played this — beat their{" "}
            <span className="text-primary font-display">
              {config.challengerScore.wins * 3 + config.challengerScore.draws} pts
            </span>
            <span className="text-muted-foreground">
              {" "}
              ({config.challengerScore.wins}W {config.challengerScore.draws}D{" "}
              {config.challengerScore.losses}L)
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Same league · same formation · same fixtures. Draft your own XI.
          </div>
        </div>
      )}

      <Section label="Competition">
        <div className="space-y-5">
          {COMPETITION_GROUPS.map((group) => {
            const ids = LEAGUE_IDS.filter((id) => group.kinds.includes(LEAGUES[id].kind));
            if (ids.length === 0) return null;
            return (
              <div key={group.id}>
                <div className="flex items-baseline justify-between mb-2 px-0.5">
                  <h3 className="font-display text-sm tracking-wide text-foreground/80">
                    <span className="mr-1.5">{group.icon}</span>
                    {group.title}
                  </h3>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {group.timeHint}
                  </span>
                </div>
                <div
                  className={`grid gap-2 ${
                    ids.length === 1
                      ? "grid-cols-1"
                      : ids.length === 2
                        ? "grid-cols-2"
                        : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
                  }`}
                >
                  {ids.map((id) => {
                    const l = LEAGUES[id];
                    const isLive = id === "worldcup2026";
                    const selected = config.league === id;
                    // Selected → warning-gold (consistent with every other
                    // "selected" state on this screen). LIVE accent is a
                    // small pulsing dot — not a full card recolour — so it
                    // doesn't compete with the selection signal.
                    return (
                      <button
                        key={id}
                        onClick={() => setConfig({ league: id })}
                        className={`relative p-3 rounded-xl border text-left transition ${
                          selected
                            ? "border-warning bg-warning/10 text-warning"
                            : "border-border bg-card hover:border-foreground/30"
                        }`}
                      >
                        {isLive && (
                          <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[9px] font-display tracking-[0.15em] uppercase text-warning">
                            <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse"></span>
                            LIVE
                          </span>
                        )}
                        <div className="text-2xl leading-none">{l.flag}</div>
                        <div className="mt-1.5 font-display text-sm">{l.name}</div>
                        <div
                          className={`text-[10px] ${selected ? "opacity-80" : "text-muted-foreground"}`}
                        >
                          {l.formatLabel}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Pitch — visual confirmation of the currently-selected formation.
          Lives above the Start button so the user sees "this is what
          I'm about to play with" before committing. Formation can be
          changed inside Customize below. */}
      <Section label="">
        <Pitch slots={slots} />
      </Section>

      {/* THE primary CTA — red, bold, single-decisive button on the page.
          Above the Customize drawer so the happy path is one tap.  */}
      <button
        onClick={() => {
          reset();
          navigate({ to: "/draft" });
        }}
        className="mt-8 w-full py-4 rounded-xl bg-primary text-primary-foreground font-display text-xl tracking-wide hover:brightness-110 shadow-[0_18px_40px_-12px] shadow-primary/60 transition"
      >
        {league.kickoffWord} →
      </button>

      {/* Customize drawer — collapsed by default. Power-user options
          live here: formation, difficulty (incl. ratings-hidden), draft
          mode, rating mode, founding player. First-time visitors are
          shielded from the decision-fatigue these options used to
          cause when they sat above the fold. */}
      <div className="mt-8">
        <button
          onClick={() => setCustomizeOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border bg-card/50 hover:bg-card hover:border-warning/40 transition text-left"
          aria-expanded={customizeOpen}
        >
          <div>
            <div className="font-display text-sm tracking-[0.18em] uppercase text-foreground/85">
              ⚙ Customize
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Formation, difficulty, draft mode — defaults work great
            </div>
          </div>
          <span
            className={`text-warning text-lg transition-transform ${
              customizeOpen ? "rotate-180" : ""
            }`}
            aria-hidden
          >
            ⌄
          </span>
        </button>

        {customizeOpen && (
          <div className="mt-2 space-y-0">
            <Section
              label="Difficulty"
              hint="Rerolls let you re-spin the wheel when it lands on a bad club. Hard hides ratings — pure gut feel."
            >
              <div className="grid grid-cols-3 gap-2">
                <OptionCard
                  active={config.difficulty === "easy"}
                  title="Easy"
                  sub="3 rerolls · ratings shown"
                  onClick={() => setConfig({ difficulty: "easy" as Difficulty, showRatings: true })}
                />
                <OptionCard
                  active={config.difficulty === "normal"}
                  title="Normal"
                  sub="1 reroll · ratings shown"
                  onClick={() =>
                    setConfig({ difficulty: "normal" as Difficulty, showRatings: true })
                  }
                />
                <OptionCard
                  active={config.difficulty === "hard"}
                  title="Hard"
                  sub="No rerolls · ratings hidden"
                  onClick={() =>
                    setConfig({ difficulty: "hard" as Difficulty, showRatings: false })
                  }
                />
              </div>
            </Section>

            <Section
              label="Formation"
              hint="How your XI lines up. 4-3-3 is the modern classic; 5-4-1 locks the back; 3-5-2 favors midfield."
            >
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {FORMATION_KEYS.map((k) => (
                  <Chip
                    key={k}
                    active={config.formation === k}
                    onClick={() => setConfig({ formation: k })}
                  >
                    {k}
                  </Chip>
                ))}
              </div>
              <p className="mt-3 text-sm text-muted-foreground text-center">
                {formation.description}
              </p>
            </Section>

            <Section
              label="Draft Mode"
              hint="Squad-first is the simplest — pick any player from the wheel's club. Quick gives you 2 per spin."
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <OptionCard
                  active={config.draftMode === "squad"}
                  title="Squad First"
                  sub="Spin a club, pick any player, choose their position"
                  onClick={() => setConfig({ draftMode: "squad" as DraftMode })}
                />
                <OptionCard
                  active={config.draftMode === "position"}
                  title="Position First"
                  sub="Pick a slot, then spin for a club to fill it"
                  onClick={() => setConfig({ draftMode: "position" as DraftMode })}
                />
                <OptionCard
                  active={config.draftMode === "quick"}
                  title="Quick ⚡"
                  sub="Two players per club — for the impatient"
                  onClick={() => setConfig({ draftMode: "quick" as DraftMode })}
                />
              </div>
            </Section>

            <Section
              label="Player Ratings"
              hint="Prime = each player at their career-best year. Career = their rating in the specific season they played."
            >
              <div className="grid grid-cols-2 gap-2">
                <OptionCard
                  active={config.ratingMode === "career"}
                  title="Career Seasons"
                  sub="Players rated as they were that exact season"
                  onClick={() => setConfig({ ratingMode: "career" as RatingMode })}
                />
                <OptionCard
                  active={config.ratingMode === "prime"}
                  title="Prime Mode"
                  sub="Every player at their career-best rating"
                  onClick={() => setConfig({ ratingMode: "prime" as RatingMode })}
                />
              </div>
            </Section>

            <Section
              label="Founding Player (Optional)"
              hint="Anchor your XI around one player you've got in mind. The wheel handles the rest."
            >
              <FoundingPlayerPicker
                league={config.league}
                current={config.foundingPlayer}
                onPick={(p) => setConfig({ foundingPlayer: p })}
                onClear={() => setConfig({ foundingPlayer: undefined })}
              />
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="mt-10">
      {label && (
        <div className="mb-3 px-0.5">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">{label}</h2>
          {hint && (
            <p className="text-[11px] text-muted-foreground/80 mt-1 leading-tight">{hint}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  // Selected → warning-gold (same as OptionCard, league cards, founding-
  // player card). One language for "this is picked" across the screen.
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 rounded-lg border font-display tracking-wide transition text-sm ${
        active
          ? "bg-warning/15 border-warning text-warning"
          : "bg-card border-border text-foreground hover:border-foreground/40"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * FoundingPlayerPicker — optional search input that lets the user name
 * ONE specific player they want to anchor their XI around (e.g. "give me
 * Dariusz Wosz from VfL Bochum"). On /draft mount the player gets
 * auto-assigned to a compatible slot before the wheel takes over.
 */
function FoundingPlayerPicker({
  league,
  current,
  onPick,
  onClear,
}: {
  league: import("@/lib/leagues").LeagueId;
  current: Player | undefined;
  onPick: (p: Player) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const players = useMemo(() => getPlayers(league), [league]);
  const clubs = useMemo(() => getClubs(league), [league]);
  const clubName = (id: string) => clubs.find((c) => c.id === id)?.short ?? id;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return players
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => b.prime_rating - a.prime_rating)
      .slice(0, 25);
  }, [players, query]);

  if (current) {
    return (
      <div className="flex items-center justify-between p-4 rounded-xl border bg-warning/10 border-warning">
        <div className="min-w-0">
          <div className="font-display text-lg text-warning truncate">⚡ {current.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {current.position} · {clubName(current.club)} · {current.career_years} · OVR{" "}
            {current.prime_rating}
          </div>
          <div className="text-[10px] text-warning/80 mt-1.5 uppercase tracking-[0.18em]">
            will be pre-assigned in your XI
          </div>
        </div>
        <button
          onClick={() => {
            onClear();
            setQuery("");
          }}
          className="shrink-0 ml-3 w-8 h-8 rounded-full border border-warning/50 text-warning hover:bg-warning/20 transition"
          aria-label="Clear founding player"
        >
          ×
        </button>
      </div>
    );
  }

  function surpriseMe() {
    // Pick a random top-50-by-rating player so the surprise is fun, not obscure
    const top = [...players].sort((a, b) => b.prime_rating - a.prime_rating).slice(0, 50);
    if (top.length === 0) return;
    onPick(top[Math.floor(Math.random() * top.length)]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name — e.g. Dariusz Wosz, Maldini, Cruyff…"
          className="flex-1 min-w-0 px-4 py-3 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-warning transition"
        />
        <button
          onClick={surpriseMe}
          className="shrink-0 px-4 py-3 rounded-xl border border-warning/50 bg-warning/10 text-warning font-display text-sm tracking-wide hover:bg-warning/25 transition whitespace-nowrap"
          title="Pick a random top-50 player from this league"
        >
          🎲 Surprise me
        </button>
      </div>
      {query.length >= 2 && (
        <div className="rounded-xl border border-border bg-card/60 max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">
              No match in this league. Try a different spelling or pick another league first.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {results.map((p, i) => (
                <li key={`${p.name}-${p.club}-${i}`}>
                  <button
                    onClick={() => {
                      onPick(p);
                      setQuery("");
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-warning/10 hover:text-warning transition flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {p.position} · {clubName(p.club)} · {p.career_years}
                      </div>
                    </div>
                    <span className="shrink-0 font-display text-base px-2 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
                      {p.prime_rating}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function OptionCard({
  active,
  title,
  sub,
  onClick,
}: {
  active: boolean;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  // All selected states are warning-gold. The `color` prop is gone —
  // semantic distinction belongs in the title/sub, not in the color.
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-xl border text-left transition ${
        active
          ? "border-warning bg-warning/10 text-warning"
          : "border-border bg-card hover:border-foreground/30"
      }`}
    >
      <div className={`font-display text-lg ${active ? "" : "text-foreground"}`}>{title}</div>
      <div className={`mt-1 text-xs ${active ? "opacity-80" : "text-muted-foreground"}`}>{sub}</div>
    </button>
  );
}

function Pitch({ slots }: { slots: ReturnType<typeof useGame.getState>["slots"] }) {
  return (
    <div
      className="relative w-full rounded-xl border border-pitch-line/30 bg-pitch-pattern overflow-hidden"
      style={{ aspectRatio: "16/9" }}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <rect
          x="1"
          y="1"
          width="98"
          height="98"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.3"
          className="text-pitch-line"
        />
        <line
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          stroke="currentColor"
          strokeWidth="0.3"
          className="text-pitch-line"
        />
        <circle
          cx="50"
          cy="50"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.3"
          className="text-pitch-line"
        />
      </svg>
      {slots.map((s) => (
        <div
          key={s.id}
          className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-success text-success-foreground text-[10px] font-bold flex items-center justify-center border border-success-foreground/30"
          style={{ left: `${s.x}%`, top: `${s.y}%` }}
        >
          {s.position}
        </div>
      ))}
    </div>
  );
}
