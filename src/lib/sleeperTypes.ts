// Shapes reflect the real Sleeper API responses, verified against raw JSON
// (not paraphrased/summarized) for league 1389362840074199040 on 2026-08-12.
// Only fields this app actually uses are declared.

export interface SleeperLeague {
  league_id: string
  name: string
  season: string
  status: string
  draft_id: string
  previous_league_id: string | null
  total_rosters: number
  roster_positions: string[]
  settings: {
    num_teams: number
    max_keepers: number
    reserve_slots: number
  }
  scoring_settings: Record<string, number>
}

export interface SleeperUser {
  user_id: string
  display_name: string
  metadata: { team_name?: string } | null
}

export interface SleeperRoster {
  roster_id: number
  owner_id: string | null
  co_owners: string[] | null
  players: string[] | null
  starters: string[] | null
  keepers: string[] | null
}

export interface SleeperDraft {
  draft_id: string
  // Null for a mock draft not tied to a queryable league - see metadata.league_id
  // instead, which points back to the real league it was generated from.
  league_id: string | null
  status: string
  type: string
  season: string
  settings: {
    budget: number
    rounds: number
    teams: number
  }
  metadata: { scoring_type?: string; league_id?: string; type?: string } | null
}

export interface SleeperProjection {
  player_id: string
  player: {
    position: string
    first_name: string
    last_name: string
    team: string | null
  } | null
  stats: Record<string, number>
}

export interface SleeperPick {
  pick_no: number
  round: number
  roster_id: number
  picked_by: string
  player_id: string
  metadata: {
    amount?: string
    first_name?: string
    last_name?: string
    position?: string
    team?: string
  } | null
}
