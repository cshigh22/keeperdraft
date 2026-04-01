// Hall of Champions — Type Definitions

export interface KeeperHighlight {
  playerName: string;
  position: string;
  keeperRound: number;
}

export interface PastWinnerData {
  id: string;
  leagueId: string;
  season: number;
  managerName: string;
  teamName: string;
  keeperHighlights: KeeperHighlight[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddPastWinnerInput {
  leagueId: string;
  season: number;
  managerName: string;
  teamName: string;
  keeperHighlights?: KeeperHighlight[];
}

export interface UpdatePastWinnerInput {
  id: string;
  managerName?: string;
  teamName?: string;
  keeperHighlights?: KeeperHighlight[];
}
