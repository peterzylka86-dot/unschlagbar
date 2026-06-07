export type LeagueId =
  | "bundesliga"
  | "laliga"
  | "seriea"
  | "swiss"
  | "ucl"
  | "worldcup"
  | "worldcup2026"
  | "womens";

export type CompetitionKind = "league" | "knockout" | "groupKO";

export interface League {
  id: LeagueId;
  name: string;
  country: string;
  flag: string;
  matches: number; // total matches in a season for "unschlagbar"
  brandMark: string; // e.g. "34:0"
  tagline: string; // localized tagline (UNSCHLAGBAR / INVENCIBLE / ...)
  kickoffWord: string; // CTA on landing/start
  seasonWord: string; // header word in season screen
  matchesWord: string;
  defeatsWord: string;
  drawWord: string;
  winWord: string;
  lossWord: string;
  tableTitle: string;
  unbeatenLabel: string;
  opponentsCount: number; // distinct opponents available
  fixtureRounds: number; // for league kind
  kind: CompetitionKind; // league | knockout | groupKO
  /** Knockout: round labels in order. For groupKO, includes "Group" repeated for group matches. */
  rounds?: string[];
  /** Friendly short label for tile UI: "League · 34" / "Knockout · 4" */
  formatLabel: string;
}

export const LEAGUES: Record<LeagueId, League> = {
  bundesliga: {
    id: "bundesliga",
    name: "Bundesliga",
    country: "Germany",
    flag: "🇩🇪",
    matches: 34,
    brandMark: "34:0",
    tagline: "INVINCIBLE",
    kickoffWord: "Anpfiff",
    seasonWord: "Season",
    matchesWord: "Matches",
    defeatsWord: "Defeats",
    drawWord: "DRAW",
    winWord: "WIN",
    lossWord: "LOSS",
    tableTitle: "Final Table",
    unbeatenLabel: "Invincible",
    opponentsCount: 17,
    fixtureRounds: 2,
    kind: "league",
    formatLabel: "League · 34 matches",
  },
  laliga: {
    id: "laliga",
    name: "La Liga",
    country: "Spain",
    flag: "🇪🇸",
    matches: 38,
    brandMark: "38:0",
    tagline: "INVINCIBLE",
    kickoffWord: "¡Vamos!",
    seasonWord: "Season",
    matchesWord: "Matches",
    defeatsWord: "Defeats",
    drawWord: "DRAW",
    winWord: "WIN",
    lossWord: "LOSS",
    tableTitle: "Final Table",
    unbeatenLabel: "Invincible",
    opponentsCount: 19,
    fixtureRounds: 2,
    kind: "league",
    formatLabel: "League · 38 matches",
  },
  seriea: {
    id: "seriea",
    name: "Serie A",
    country: "Italy",
    flag: "🇮🇹",
    matches: 38,
    brandMark: "38:0",
    tagline: "INVINCIBLE",
    kickoffWord: "Forza!",
    seasonWord: "Season",
    matchesWord: "Matches",
    defeatsWord: "Defeats",
    drawWord: "DRAW",
    winWord: "WIN",
    lossWord: "LOSS",
    tableTitle: "Final Table",
    unbeatenLabel: "Invincible",
    opponentsCount: 19,
    fixtureRounds: 2,
    kind: "league",
    formatLabel: "League · 38 matches",
  },
  swiss: {
    id: "swiss",
    name: "Super League",
    country: "Switzerland",
    flag: "🇨🇭",
    matches: 36,
    brandMark: "36:0",
    tagline: "INVINCIBLE",
    kickoffWord: "Hopp Schwiiz!",
    seasonWord: "Season",
    matchesWord: "Matches",
    defeatsWord: "Defeats",
    drawWord: "DRAW",
    winWord: "WIN",
    lossWord: "LOSS",
    tableTitle: "Final Table",
    unbeatenLabel: "Invincible",
    opponentsCount: 11,
    fixtureRounds: 3,
    kind: "league",
    formatLabel: "League · 36 matches",
  },
  ucl: {
    id: "ucl",
    name: "Champions League",
    country: "Europe",
    flag: "🏆",
    matches: 13,
    brandMark: "13:0",
    tagline: "INVINCIBLE EUROPE",
    kickoffWord: "Kick-off",
    seasonWord: "European Nights",
    matchesWord: "Matches",
    defeatsWord: "Defeats",
    drawWord: "DRAW",
    winWord: "WIN",
    lossWord: "OUT",
    tableTitle: "Road to the Final",
    unbeatenLabel: "European Champions",
    opponentsCount: 13,
    fixtureRounds: 1,
    kind: "knockout",
    // Classic UCL format: 6 group matches (3 opps × home & away),
    // R16 / QF / SF two-legged, single-leg final = 13 matches.
    rounds: [
      "Group",
      "Group",
      "Group",
      "Group",
      "Group",
      "Group",
      "Round of 16",
      "Round of 16",
      "Quarter-Final",
      "Quarter-Final",
      "Semi-Final",
      "Semi-Final",
      "Final",
    ],
    formatLabel: "Group + KO · 13 matches",
  },
  worldcup: {
    id: "worldcup",
    name: "World Cup",
    country: "World",
    flag: "🌍",
    matches: 7,
    brandMark: "7:0",
    tagline: "WELTMEISTER",
    kickoffWord: "Kick-off!",
    seasonWord: "Tournament",
    matchesWord: "Matches",
    defeatsWord: "Defeats",
    drawWord: "DRAW",
    winWord: "WIN",
    lossWord: "OUT",
    tableTitle: "Road to Glory",
    unbeatenLabel: "World Champions",
    opponentsCount: 7,
    fixtureRounds: 1,
    kind: "groupKO",
    rounds: ["Group", "Group", "Group", "Round of 16", "Quarter-Final", "Semi-Final", "Final"],
    formatLabel: "Group + KO · 7 matches",
  },
  womens: {
    id: "womens",
    name: "Women's Elite",
    country: "World",
    flag: "♀",
    matches: 30,
    brandMark: "30:0",
    tagline: "UNBESIEGBAR",
    kickoffWord: "Kick-off!",
    seasonWord: "Season",
    matchesWord: "Matches",
    defeatsWord: "Defeats",
    drawWord: "DRAW",
    winWord: "WIN",
    lossWord: "LOSS",
    tableTitle: "Final Table",
    unbeatenLabel: "Untouchable",
    opponentsCount: 15,
    fixtureRounds: 2,
    kind: "league",
    formatLabel: "League · 30 matches",
  },
  worldcup2026: {
    id: "worldcup2026",
    name: "World Cup 2026 · LIVE",
    country: "World",
    flag: "🌎",
    matches: 7,
    brandMark: "7:0",
    tagline: "LIVE 2026",
    kickoffWord: "Kick-off!",
    seasonWord: "Tournament",
    matchesWord: "Matches",
    defeatsWord: "Defeats",
    drawWord: "DRAW",
    winWord: "WIN",
    lossWord: "OUT",
    tableTitle: "Road to Glory",
    unbeatenLabel: "2026 World Champions",
    opponentsCount: 7,
    fixtureRounds: 1,
    kind: "groupKO",
    rounds: ["Group", "Group", "Group", "Round of 16", "Quarter-Final", "Semi-Final", "Final"],
    formatLabel: "Group + KO · 7 matches · LIVE 26-man squads",
  },
};

export const LEAGUE_IDS = Object.keys(LEAGUES) as LeagueId[];
