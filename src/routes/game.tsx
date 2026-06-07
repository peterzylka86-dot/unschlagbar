import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useGame } from "@/lib/store";
import { FORMATIONS, FORMATION_KEYS } from "@/lib/formations";
import { LEAGUES, LEAGUE_IDS } from "@/lib/leagues";
import type { Difficulty, DraftMode, RatingMode } from "@/lib/game-types";

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {LEAGUE_IDS.map(id => {
            const l = LEAGUES[id];
            const kindTone = l.kind === "knockout" ? "text-warning"
              : l.kind === "groupKO" ? "text-primary"
              : "text-muted-foreground";
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
                <div className={`text-[10px] ${config.league === id ? "opacity-80" : kindTone}`}>{l.formatLabel}</div>
              </button>
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
