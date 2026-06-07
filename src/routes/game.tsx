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
 * Order matters: top group is the lowest-commitment entry point (best
 * for first-time visitors and lunch-break sessions). Full Season sits
 * at the bottom because it's the deepest experience.
 */
const COMPETITION_GROUPS: {
  id: string;
  title: string;
  icon: string;
  timeHint: string;
  accent: string;
  kinds: CompetitionKind[];
}[] = [
  {
    id: "quick",
    title: "Quick",
    icon: "⚡",
    timeHint: "5–10 min · knockout",
    accent: "text-warning",
    kinds: ["knockout"],
  },
  {
    id: "tournament",
    title: "Tournament",
    icon: "🏆",
    timeHint: "15–20 min · group + KO",
    accent: "text-primary",
    kinds: ["groupKO"],
  },
  {
    id: "season",
    title: "Full Season",
    icon: "📅",
    timeHint: "20–30 min · full league",
    accent: "text-success",
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

  return (
    <div className="min-h-screen px-4 py-10 max-w-3xl mx-auto">
      <header className="text-center">
        <Link to="/" className="inline-block">
          <h1 className="brand-mark text-5xl inline-flex items-baseline gap-1 leading-none">
            <span>{league.brandMark.split(":")[0]}</span><span className="text-primary">:</span><span>{league.brandMark.split(":")[1]}</span>
          </h1>
          <div className="text-[10px] tracking-[0.3em] text-warning/80 mt-1">{league.tagline}</div>
        </Link>
        <p className="mt-2 text-muted-foreground">Draft your greatest {league.name} XI</p>
      </header>

      <Section label="Competition">
        <div className="space-y-5">
          {COMPETITION_GROUPS.map(group => {
            const ids = LEAGUE_IDS.filter(id => group.kinds.includes(LEAGUES[id].kind));
            if (ids.length === 0) return null;
            return (
              <div key={group.id}>
                <div className="flex items-baseline justify-between mb-2 px-0.5">
                  <h3 className={`font-display text-sm tracking-wide ${group.accent}`}>
                    <span className="mr-1.5">{group.icon}</span>{group.title}
                  </h3>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {group.timeHint}
                  </span>
                </div>
                <div className={`grid gap-2 ${
                  ids.length === 1
                    ? "grid-cols-1"
                    : ids.length === 2
                      ? "grid-cols-2"
                      : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
                }`}>
                  {ids.map(id => {
                    const l = LEAGUES[id];
                    return (
                      <button
                        key={id}
                        onClick={() => setConfig({ league: id })}
                        className={`p-3 rounded-xl border text-left transition ${
                          config.league === id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card hover:border-foreground/30"
                        }`}
                      >
                        <div className="text-2xl leading-none">{l.flag}</div>
                        <div className="mt-1.5 font-display text-sm">{l.name}</div>
                        <div className={`text-[10px] ${config.league === id ? "opacity-80" : "text-muted-foreground"}`}>
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

      <Section label="Formation">
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {FORMATION_KEYS.map(k => (
            <Chip
              key={k}
              active={config.formation === k}
              onClick={() => setConfig({ formation: k })}
            >
              {k}
            </Chip>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground text-center">{formation.description}</p>
      </Section>


      <Section label="">
        <Pitch slots={slots} />
      </Section>

      <Section label="Difficulty">
        <div className="grid grid-cols-3 gap-2">
          <OptionCard
            active={config.difficulty === "easy"}
            color="success"
            title="Easy"
            sub="3 rerolls available"
            onClick={() => setConfig({ difficulty: "easy" as Difficulty })}
          />
          <OptionCard
            active={config.difficulty === "normal"}
            color="warning"
            title="Normal"
            sub="1 reroll available"
            onClick={() => setConfig({ difficulty: "normal" as Difficulty })}
          />
          <OptionCard
            active={config.difficulty === "hard"}
            color="primary"
            title="Hard"
            sub="No rerolls · ratings hidden"
            onClick={() => setConfig({ difficulty: "hard" as Difficulty, showRatings: false })}
          />
        </div>
      </Section>

      <Section label="Show Ratings">
        <div className="grid grid-cols-2 gap-2">
          <OptionCard
            active={config.showRatings}
            color="warning"
            title="On"
            sub="Player overalls visible"
            onClick={() => setConfig({ showRatings: true })}
          />
          <OptionCard
            active={!config.showRatings}
            color="muted"
            title="Off"
            sub="Blind mode — trust your gut"
            onClick={() => setConfig({ showRatings: false })}
          />
        </div>
      </Section>

      <Section label="Draft Mode">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <OptionCard
            active={config.draftMode === "squad"}
            color="success"
            title="Squad First"
            sub="Spin a club, pick any player, choose their position"
            onClick={() => setConfig({ draftMode: "squad" as DraftMode })}
          />
          <OptionCard
            active={config.draftMode === "position"}
            color="success"
            title="Position First"
            sub="Pick a slot, then spin for a club to fill it"
            onClick={() => setConfig({ draftMode: "position" as DraftMode })}
          />
          <OptionCard
            active={config.draftMode === "quick"}
            color="warning"
            title="Quick ⚡"
            sub="Two players per club — for the impatient"
            onClick={() => setConfig({ draftMode: "quick" as DraftMode })}
          />
        </div>
      </Section>

      <Section label="Founding Player (Optional)">
        <FoundingPlayerPicker
          league={config.league}
          current={config.foundingPlayer}
          onPick={(p) => setConfig({ foundingPlayer: p })}
          onClear={() => setConfig({ foundingPlayer: undefined })}
        />
      </Section>

      <Section label="Player Ratings">
        <div className="grid grid-cols-2 gap-2">
          <OptionCard
            active={config.ratingMode === "career"}
            color="primary"
            title="Career Seasons"
            sub="Players rated as they were that exact season"
            onClick={() => setConfig({ ratingMode: "career" as RatingMode })}
          />
          <OptionCard
            active={config.ratingMode === "prime"}
            color="primary"
            title="Prime Mode"
            sub="Every player at their career-best rating"
            onClick={() => setConfig({ ratingMode: "prime" as RatingMode })}
          />
        </div>
      </Section>

      <button
        onClick={() => { reset(); navigate({ to: "/draft" }); }}
        className="mt-10 w-full py-4 rounded-xl bg-success text-success-foreground font-display text-xl tracking-wide hover:brightness-110 transition"
      >
        {league.kickoffWord} →
      </button>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      {label && <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{label}</h2>}
      {children}
    </section>
  );
}

function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 rounded-lg border font-display tracking-wide transition text-sm ${
        active
          ? "bg-success/15 border-success text-success"
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
function FoundingPlayerPicker({ league, current, onPick, onClear }: {
  league: import("@/lib/leagues").LeagueId;
  current: Player | undefined;
  onPick: (p: Player) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const players = useMemo(() => getPlayers(league), [league]);
  const clubs = useMemo(() => getClubs(league), [league]);
  const clubName = (id: string) =>
    clubs.find(c => c.id === id)?.short ?? id;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return players
      .filter(p => p.name.toLowerCase().includes(q))
      .sort((a, b) => b.prime_rating - a.prime_rating)
      .slice(0, 25);
  }, [players, query]);

  if (current) {
    return (
      <div
        className="flex items-center justify-between p-4 rounded-xl border bg-warning/10 border-warning"
      >
        <div className="min-w-0">
          <div className="font-display text-lg text-warning truncate">
            ⚡ {current.name}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {current.position} · {clubName(current.club)} · {current.career_years} · OVR {current.prime_rating}
          </div>
          <div className="text-[10px] text-warning/80 mt-1.5 uppercase tracking-[0.18em]">
            will be pre-assigned in your XI
          </div>
        </div>
        <button
          onClick={() => { onClear(); setQuery(""); }}
          className="shrink-0 ml-3 w-8 h-8 rounded-full border border-warning/50 text-warning hover:bg-warning/20 transition"
          aria-label="Clear founding player"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Start your XI with one specific player you've already got in mind. The wheel handles the rest 10. Leave blank for pure random.
      </p>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name — e.g. Dariusz Wosz, Maldini, Cruyff…"
        className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-warning transition"
      />
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
                    onClick={() => { onPick(p); setQuery(""); }}
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
  active, title, sub, onClick, color,
}: { active: boolean; title: string; sub: string; onClick: () => void; color: "success"|"warning"|"primary"|"muted" }) {
  const colorClass = {
    success: "border-success bg-success/10 text-success",
    warning: "border-warning bg-warning/10 text-warning",
    primary: "border-primary bg-primary/10 text-primary",
    muted: "border-muted-foreground bg-muted/30 text-foreground",
  }[color];
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-xl border text-left transition ${
        active ? colorClass : "border-border bg-card hover:border-foreground/30"
      }`}
    >
      <div className={`font-display text-lg ${active ? "" : "text-foreground"}`}>{title}</div>
      <div className={`mt-1 text-xs ${active ? "opacity-80" : "text-muted-foreground"}`}>{sub}</div>
    </button>
  );
}

function Pitch({ slots }: { slots: ReturnType<typeof useGame.getState>["slots"] }) {
  return (
    <div className="relative w-full rounded-xl border border-pitch-line/30 bg-pitch-pattern overflow-hidden" style={{ aspectRatio: "16/9" }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
        <rect x="1" y="1" width="98" height="98" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
        <circle cx="50" cy="50" r="9" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-pitch-line" />
      </svg>
      {slots.map(s => (
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
