import type {
  SleeperDraft,
  SleeperLeague,
  SleeperPick,
  SleeperRoster,
  SleeperUser,
} from './sleeperTypes'

const BASE = 'https://api.sleeper.app/v1'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Sleeper API request failed (${res.status}): ${url}`)
  }
  return res.json() as Promise<T>
}

export function getLeague(leagueId: string): Promise<SleeperLeague> {
  return getJson(`${BASE}/league/${leagueId}`)
}

export function getLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
  return getJson(`${BASE}/league/${leagueId}/users`)
}

export function getLeagueRosters(leagueId: string): Promise<SleeperRoster[]> {
  return getJson(`${BASE}/league/${leagueId}/rosters`)
}

export function getDraft(draftId: string): Promise<SleeperDraft> {
  return getJson(`${BASE}/draft/${draftId}`)
}

export function getDraftPicks(draftId: string): Promise<SleeperPick[]> {
  return getJson(`${BASE}/draft/${draftId}/picks`)
}
