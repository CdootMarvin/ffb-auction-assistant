import type {
  SleeperDraft,
  SleeperLeague,
  SleeperPick,
  SleeperProjection,
  SleeperRoster,
  SleeperUser,
} from './sleeperTypes'

const BASE = 'https://api.sleeper.app/v1'
// Undocumented endpoint (not in Sleeper's official API docs) - confirmed working
// 2026-08-12, see DESIGN_DECISIONS.md. Different host from the documented v1 API.
const PROJECTIONS_BASE = 'https://api.sleeper.com/projections/nfl'
const PROJECTIONS_CACHE_KEY = (season: string) => `ffb-auction-assistant:projections:${season}`
const PROJECTIONS_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000

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

// Follows previous_league_id to last season's completed draft and returns a
// player_id -> price paid map, used for the keeper cost formula (MODELING.md
// Layer 0). Returns an empty map if there's no previous league.
export async function getPreviousSeasonPrices(
  previousLeagueId: string | null,
): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  if (!previousLeagueId) return prices

  const previousLeague = await getLeague(previousLeagueId)
  const picks = await getDraftPicks(previousLeague.draft_id)
  for (const pick of picks) {
    const amount = pick.metadata?.amount
    if (amount != null) {
      prices.set(pick.player_id, Number(amount))
    }
  }
  return prices
}

// Only QB/RB/WR/TE requested - this league's roster_positions has no DEF/K slots,
// and fetching all positions unfiltered is ~8.5MB vs ~2.9MB filtered.
export async function getProjections(season: string): Promise<SleeperProjection[]> {
  const cacheKey = PROJECTIONS_CACHE_KEY(season)
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const { fetchedAt, data } = JSON.parse(cached) as { fetchedAt: number; data: SleeperProjection[] }
      if (Date.now() - fetchedAt < PROJECTIONS_CACHE_MAX_AGE_MS) {
        return data
      }
    }
  } catch {
    // corrupt cache entry - fall through and refetch
  }

  const url = `${PROJECTIONS_BASE}/${season}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&order_by=pts_half_ppr`
  const data = await getJson<SleeperProjection[]>(url)

  try {
    localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), data }))
  } catch {
    // localStorage full/unavailable - not fatal, just skip caching
  }

  return data
}
