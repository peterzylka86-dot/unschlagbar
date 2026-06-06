import type { Club, Player } from "./game-types";
import type { LeagueId } from "./leagues";

import bundesligaClubs from "@/data/bundesliga/clubs.json";
import bundesligaPlayers from "@/data/bundesliga/players.json";
import laligaClubs from "@/data/laliga/clubs.json";
import laligaPlayers from "@/data/laliga/players.json";
import serieaClubs from "@/data/seriea/clubs.json";
import serieaPlayers from "@/data/seriea/players.json";
import swissClubs from "@/data/swiss/clubs.json";
import swissPlayers from "@/data/swiss/players.json";

const DATA: Record<LeagueId, { clubs: Club[]; players: Player[] }> = {
  bundesliga: { clubs: bundesligaClubs as Club[], players: bundesligaPlayers as Player[] },
  laliga: { clubs: laligaClubs as Club[], players: laligaPlayers as Player[] },
  seriea: { clubs: serieaClubs as Club[], players: serieaPlayers as Player[] },
  swiss: { clubs: swissClubs as Club[], players: swissPlayers as Player[] },
};

export function getClubs(league: LeagueId): Club[] {
  return DATA[league].clubs;
}
export function getPlayers(league: LeagueId): Player[] {
  return DATA[league].players;
}
export function getLeagueData(league: LeagueId) {
  return DATA[league];
}
