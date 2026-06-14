/**
 * Matchday-voice flavour — the wider Anstoss / Championship Manager texture
 * around the bare results. Where commentary.ts narrates the SCORE, this
 * narrates the SEASON: the gaffer's pre-match team talk, the daft things
 * that happen between games, the dressing-room mood, and the back-page
 * headlines.
 *
 * Same design contract as commentary.ts:
 *   • PURE + DETERMINISTIC — every line is keyed off a numeric seed derived
 *     from (season, matchday, facts). No Math.random, so a finished season
 *     reads identically on every re-render and resume.
 *   • Context-aware — lines are chosen from facts (run-in, underdog, big
 *     win, cold striker…) so they always fit the moment.
 *   • Tone: dry, fond, faintly tabloid — the cult-manager voice. Never mean.
 *
 * Placeholders: {player} = a squad player's name, {n} = a number.
 */

/** Deterministic index into a pool from a numeric seed. */
function pick<T>(pool: T[], seed: number): T {
  const i = ((seed % pool.length) + pool.length) % pool.length;
  return pool[i];
}

const FWD_POSITIONS = new Set(["ST", "CF", "LW", "RW", "SS"]);

// ─── 1 · Pre-match team talk (the gaffer's voice) ───────────────────────

const TALK_RUN_IN = [
  "This is the run-in. Forty-five minutes of football, a lifetime of regret if we switch off.",
  "Title business now. No heroics — just do your jobs.",
  "Every point is a final from here. Heads up, chests out.",
  "We've come too far to bottle it now. Out you go.",
];

const TALK_UNDERDOG = [
  "Nobody fancies us today. Good. Let them be comfortable.",
  "They've got the names. We've got the legs. Run them ragged.",
  "Sit in, stay patient, and punish one mistake. That's the plan.",
  "Make it ugly. Make it horrible. Make it ours.",
];

const TALK_FAVOURITE = [
  "Respect them for ten minutes, then put them to bed.",
  "No complacency. Three goals up is when teams get sloppy. Not us.",
  "Do it properly and we're home by the hour. Concentrate.",
  "They'll park the bus. Be patient, the door will open.",
];

const TALK_DERBY = [
  "You know what this one means to the people out there. Don't let them down.",
  "Bragging rights. That's all that matters today.",
  "Win the duels, win the day. Get stuck in.",
];

const TALK_GENERIC = [
  "Same standards as always. Tempo, intensity, no excuses.",
  "Trust the work we've done. Now go and enjoy it.",
  "First goal is everything today. Go and get it.",
  "Keep it tight at the back and the rest takes care of itself.",
];

/**
 * Gaffer's pre-match line. Returns null for ordinary fixtures so the talk
 * stays special — it fires on the run-in, big mismatches, or ~1-in-4
 * mid-table games.
 */
export function teamTalk(o: {
  matchday: number;
  totalMatchdays: number;
  ourRating: number;
  oppRating: number;
  home: boolean;
}): string | null {
  const seed = o.matchday * 17 + (o.home ? 3 : 0);
  const diff = o.ourRating - o.oppRating;
  if (o.matchday > o.totalMatchdays - 3) return pick(TALK_RUN_IN, seed);
  if (diff <= -6) return pick(TALK_UNDERDOG, seed);
  if (diff >= 8) return pick(TALK_FAVOURITE, seed);
  // Occasional derby-flavoured or generic talk for the in-between games.
  if (seed % 5 === 0) return pick(TALK_DERBY, seed);
  if (seed % 3 === 0) return pick(TALK_GENERIC, seed);
  return null;
}

// ─── 2 · Random between-match events (the Anstoss daftness) ─────────────

const EVENTS = [
  "{player} reversed the team bus into the chairman's parking space. Twice.",
  "A local baker has named a pie after {player}. It is selling out daily.",
  "{player} was spotted at 2am in a karaoke bar. The gaffer 'has had a word'.",
  "The training-ground cat adopted {player}. It now attends every session.",
  "{player} did a radio interview and accidentally promised the title.",
  "The chairman was photographed asleep in the directors' box. Again.",
  "{player}'s new haircut is the talk of the city. Opinions are divided.",
  "A fan proposed at the ground holding a banner with {player}'s face on it.",
  "{player} lost a club table-tennis final and has demanded a rematch.",
  "The kitman swears {player}'s lucky boots have not been washed since August.",
  "{player} got stuck in a lift before training and missed the warm-up.",
  "A rival manager called {player} 'overrated'. The dressing room noticed.",
  "{player} adopted a rescue dog and named it after the assistant coach.",
  "The club shop sold out of {player} shirts in a single afternoon.",
  "{player} turned up to training in fancy dress, having lost a bet.",
  "Local press ran six pages on {player}'s pre-match pasta order.",
  "{player} signed so many autographs the team coach left without him.",
  "A pundit drew {player} on the tactics board upside down. Live. On air.",
  "{player} scored a worldie in the warm-up and pulled a muscle celebrating.",
  "The chairman gifted the squad matching tracksuits. {player} hates his.",
];

/**
 * One daft event for a matchday, or null. Fires ~1 in 3 matchdays. Names a
 * deterministic squad player when one is available.
 */
export function matchdayEvent(season: number, matchday: number, squadNames: string[]): string | null {
  const seed = season * 101 + matchday * 37;
  if (seed % 3 !== 0) return null;
  const line = pick(EVENTS, seed);
  const name = squadNames.length ? squadNames[seed % squadNames.length] : "a player";
  return line.replace(/\{player\}/g, name);
}

// ─── 3 · Dressing-room morale (driven by real scorer data) ──────────────

const MORALE_HOT = [
  "{player} can't stop scoring — {n} for the season and counting.",
  "{player} is buzzing. {n} goals and the swagger to match.",
  "{player} has the whole dressing room believing. {n} already.",
];

const MORALE_COLD = [
  "{player} is 'not happy', say sources — still waiting for a first goal.",
  "{player}'s barren run is the quiet talk of the dressing room.",
  "Whispers that {player} feels misused. The goals haven't come.",
];

// ─── 4 · Tabloid back-page headlines ────────────────────────────────────

const HEADLINE_BIG_WIN = [
  "📰 FOUR! AND THEY WANTED MORE",
  "📰 GAFFER'S GAMBLE PAYS OFF IN STYLE",
  "📰 RUTHLESS. SIMPLY RUTHLESS.",
  "📰 NO MERCY ON A PERFECT AFTERNOON",
];

const HEADLINE_BIG_LOSS = [
  "📰 CRISIS? WHAT CRISIS, INSISTS BOSS",
  "📰 A DAY TO FORGET — AND FAST",
  "📰 QUESTIONS. AND NOT MANY ANSWERS.",
  "📰 BACK TO THE DRAWING BOARD",
];

const HEADLINE_CLEAN_SHEET = [
  "📰 SHUT THE DOOR, TOOK THE POINTS",
  "📰 THE BACK LINE WAS A FORTRESS",
];

export interface FlavourBeat {
  matchday: number;
  kind: "headline" | "morale" | "event";
  icon: string;
  text: string;
}

interface DiaryMatch {
  matchday: number;
  ourScore: number;
  theirScore: number;
  outcome: "W" | "D" | "L";
  scorers: { name: string }[];
}

interface DiaryPlayer {
  name: string;
  position: string;
  prime_rating: number;
}

/**
 * Build the season's news diary: a single, highest-priority flavour beat
 * per matchday, woven from the back-page headline (big results), the
 * dressing-room mood (a striker catching fire on real goal tallies), and
 * the daft random events. Priority per matchday: headline > morale > event,
 * so we never spam more than one line under a result.
 *
 * Pure: same (season, matches, squad) → same beats, every time.
 */
export function seasonDiary(opts: {
  season: number;
  matches: DiaryMatch[];
  squad: DiaryPlayer[];
}): FlavourBeat[] {
  const { season, matches, squad } = opts;
  const squadNames = squad.map((p) => p.name);
  const tally = new Map<string, number>();
  // Track which milestone (every 5th goal) we've already announced per player.
  const lastMilestone = new Map<string, number>();
  const beats: FlavourBeat[] = [];

  // Iterate in matchday order so running tallies are correct.
  const ordered = [...matches].sort((a, b) => a.matchday - b.matchday);
  for (const m of ordered) {
    const margin = m.ourScore - m.theirScore;
    let beat: FlavourBeat | null = null;

    // Priority 1 — headline on a notable result.
    if (m.outcome === "W" && margin >= 3) {
      beat = { matchday: m.matchday, kind: "headline", icon: "📰", text: pick(HEADLINE_BIG_WIN, m.matchday * 13 + m.ourScore * 5) };
    } else if (m.outcome === "L" && -margin >= 3) {
      beat = { matchday: m.matchday, kind: "headline", icon: "📰", text: pick(HEADLINE_BIG_LOSS, m.matchday * 13 + m.theirScore * 5) };
    } else if (m.outcome === "W" && m.theirScore === 0 && margin >= 2) {
      beat = { matchday: m.matchday, kind: "headline", icon: "📰", text: pick(HEADLINE_CLEAN_SHEET, m.matchday * 13) };
    }

    // Update running goal tallies regardless.
    for (const s of m.scorers) tally.set(s.name, (tally.get(s.name) ?? 0) + 1);

    // Priority 2 — morale: a player crossing a 5-goal milestone this matchday.
    if (!beat) {
      for (const s of m.scorers) {
        const total = tally.get(s.name) ?? 0;
        const milestone = Math.floor(total / 5) * 5;
        if (milestone >= 5 && milestone > (lastMilestone.get(s.name) ?? 0)) {
          lastMilestone.set(s.name, milestone);
          const line = pick(MORALE_HOT, m.matchday * 7 + milestone);
          beat = {
            matchday: m.matchday,
            kind: "morale",
            icon: "💬",
            text: line.replace(/\{player\}/g, s.name).replace(/\{n\}/g, String(total)),
          };
          break;
        }
      }
    }

    // Priority 3 — a daft event.
    if (!beat) {
      const ev = matchdayEvent(season, m.matchday, squadNames);
      if (ev) beat = { matchday: m.matchday, kind: "event", icon: "📣", text: ev };
    }

    if (beat) beats.push(beat);
  }

  // One end-of-season morale grumble: the highest-rated forward who never
  // scored. Pinned to the season's halfway point so it reads as a mid-year
  // story, not a final-day footnote.
  const coldForward = squad
    .filter((p) => FWD_POSITIONS.has(p.position) && (tally.get(p.name) ?? 0) === 0)
    .sort((a, b) => b.prime_rating - a.prime_rating)[0];
  if (coldForward && ordered.length >= 6) {
    const md = ordered[Math.floor(ordered.length / 2)].matchday;
    // Don't clobber a matchday that already has a beat.
    if (!beats.some((b) => b.matchday === md)) {
      beats.push({
        matchday: md,
        kind: "morale",
        icon: "💬",
        text: pick(MORALE_COLD, md * 11).replace(/\{player\}/g, coldForward.name),
      });
    }
  }

  return beats.sort((a, b) => a.matchday - b.matchday);
}
