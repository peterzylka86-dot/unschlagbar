export type LeagueId = "bundesliga" | "laliga" | "seriea" | "swiss";

export interface League {
  id: LeagueId;
  name: string;
  country: string;
  flag: string;
  matches: number;          // total matches in a season for "unschlagbar"
  brandMark: string;        // e.g. "34:0"
  tagline: string;          // localized tagline (UNSCHLAGBAR / INVENCIBLE / ...)
  kickoffWord: string;      // CTA on landing/start: Anpfiff / ¡Vamos! / Forza! / Hopp Schwiiz!
  seasonWord: string;       // header word in season screen
  matchesWord: string;      // localized "matches" label
  defeatsWord: string;      // localized "defeats" label
  drawWord: string;         // localized "draw"
  winWord: string;          // localized "win"
  lossWord: string;         // localized "loss"
  tableTitle: string;       // localized "final table"
  unbeatenLabel: string;    // localized "unbeaten" badge
  opponentsCount: number;   // distinct opponents to draft for the season
  fixtureRounds: number;    // how many times each opponent is played
}

export const LEAGUES: Record<LeagueId, League> = {
  bundesliga: {
    id: "bundesliga",
    name: "Bundesliga",
    country: "Germany",
    flag: "🇩🇪",
    matches: 34,
    brandMark: "34:0",
    tagline: "UNSCHLAGBAR",
    kickoffWord: "Anpfiff",
    seasonWord: "Saison",
    matchesWord: "Spiele",
    defeatsWord: "Niederlagen",
    drawWord: "REMIS",
    winWord: "SIEG",
    lossWord: "PLEITE",
    tableTitle: "Abschlusstabelle",
    unbeatenLabel: "Invincible",
    opponentsCount: 17,
    fixtureRounds: 2,
  },
  laliga: {
    id: "laliga",
    name: "La Liga",
    country: "Spain",
    flag: "🇪🇸",
    matches: 38,
    brandMark: "38:0",
    tagline: "INVENCIBLE",
    kickoffWord: "¡Vamos!",
    seasonWord: "Temporada",
    matchesWord: "Partidos",
    defeatsWord: "Derrotas",
    drawWord: "EMPATE",
    winWord: "VICTORIA",
    lossWord: "DERROTA",
    tableTitle: "Clasificación Final",
    unbeatenLabel: "Invencible",
    opponentsCount: 19,
    fixtureRounds: 2,
  },
  seriea: {
    id: "seriea",
    name: "Serie A",
    country: "Italy",
    flag: "🇮🇹",
    matches: 38,
    brandMark: "38:0",
    tagline: "IMBATTIBILE",
    kickoffWord: "Forza!",
    seasonWord: "Stagione",
    matchesWord: "Partite",
    defeatsWord: "Sconfitte",
    drawWord: "PAREGGIO",
    winWord: "VITTORIA",
    lossWord: "SCONFITTA",
    tableTitle: "Classifica Finale",
    unbeatenLabel: "Imbattibile",
    opponentsCount: 19,
    fixtureRounds: 2,
  },
  swiss: {
    id: "swiss",
    name: "Super League",
    country: "Switzerland",
    flag: "🇨🇭",
    matches: 36,
    brandMark: "36:0",
    tagline: "UNBESIEGT",
    kickoffWord: "Hopp Schwiiz!",
    seasonWord: "Saison",
    matchesWord: "Spiele",
    defeatsWord: "Niederlagen",
    drawWord: "UNENTSCHIEDEN",
    winWord: "SIEG",
    lossWord: "NIEDERLAGE",
    tableTitle: "Schlusstabelle",
    unbeatenLabel: "Unbesiegt",
    opponentsCount: 11,
    fixtureRounds: 3, // 12-club Swiss league: each opponent played ~3 times (rounded)
  },
};

export const LEAGUE_IDS = Object.keys(LEAGUES) as LeagueId[];
