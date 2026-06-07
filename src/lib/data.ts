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
import uclClubs from "@/data/ucl/clubs.json";
import uclPlayers from "@/data/ucl/players.json";
import wcClubs from "@/data/worldcup/clubs.json";
import wcPlayers from "@/data/worldcup/players.json";
import womensClubs from "@/data/womens/clubs.json";
import womensPlayers from "@/data/womens/players.json";

const DATA: Record<LeagueId, { clubs: Club[]; players: Player[] }> = {
  bundesliga: { clubs: bundesligaClubs as Club[], players: bundesligaPlayers as Player[] },
  laliga: { clubs: laligaClubs as Club[], players: laligaPlayers as Player[] },
  seriea: { clubs: serieaClubs as Club[], players: serieaPlayers as Player[] },
  swiss: { clubs: swissClubs as Club[], players: swissPlayers as Player[] },
  ucl: { clubs: uclClubs as Club[], players: uclPlayers as Player[] },
  worldcup: { clubs: wcClubs as Club[], players: wcPlayers as Player[] },
  womens: { clubs: womensClubs as Club[], players: womensPlayers as Player[] },
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
