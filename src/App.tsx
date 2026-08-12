import { useEffect, useState } from 'react'
import { getDraft, getLeague, getLeagueRosters, getLeagueUsers } from './lib/sleeperApi'
import type { SleeperDraft, SleeperLeague, SleeperRoster, SleeperUser } from './lib/sleeperTypes'
import { useDraftPicks } from './hooks/useDraftPicks'

const LEAGUE_ID_STORAGE_KEY = 'ffb-auction-assistant:league-id'

interface LeagueData {
  league: SleeperLeague
  users: SleeperUser[]
  rosters: SleeperRoster[]
  draft: SleeperDraft
}

function teamNameForRoster(roster: SleeperRoster, users: SleeperUser[]): string {
  const owner = users.find((u) => u.user_id === roster.owner_id)
  return owner?.metadata?.team_name || owner?.display_name || `Roster ${roster.roster_id}`
}

function App() {
  const [leagueIdInput, setLeagueIdInput] = useState(
    () => localStorage.getItem(LEAGUE_ID_STORAGE_KEY) ?? '',
  )
  const [connectedLeagueId, setConnectedLeagueId] = useState<string | null>(null)
  const [data, setData] = useState<LeagueData | null>(null)
  const [loading, setLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  const { picks, error: picksError } = useDraftPicks(data?.draft.draft_id ?? null)

  useEffect(() => {
    if (!connectedLeagueId) return
    let cancelled = false

    async function connect() {
      setLoading(true)
      setConnectError(null)
      try {
        const league = await getLeague(connectedLeagueId as string)
        const [users, rosters] = await Promise.all([
          getLeagueUsers(connectedLeagueId as string),
          getLeagueRosters(connectedLeagueId as string),
        ])
        const draft = await getDraft(league.draft_id)
        if (!cancelled) {
          setData({ league, users, rosters, draft })
        }
      } catch (e) {
        if (!cancelled) {
          setData(null)
          setConnectError(e instanceof Error ? e.message : 'Failed to connect to league')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    connect()
    return () => {
      cancelled = true
    }
  }, [connectedLeagueId])

  function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = leagueIdInput.trim()
    if (!trimmed) return
    localStorage.setItem(LEAGUE_ID_STORAGE_KEY, trimmed)
    setConnectedLeagueId(trimmed)
  }

  const sortedPicks = [...picks].sort((a, b) => b.pick_no - a.pick_no)

  return (
    <main>
      <h1>Fantasy Football Auction Assistant</h1>

      <form onSubmit={handleConnect} className="connect-form">
        <label htmlFor="league-id">Sleeper League ID</label>
        <input
          id="league-id"
          type="text"
          value={leagueIdInput}
          onChange={(e) => setLeagueIdInput(e.target.value)}
          placeholder="e.g. 1389362840074199040"
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Connecting…' : 'Connect'}
        </button>
      </form>

      {connectError && <p className="error">{connectError}</p>}

      {data && (
        <>
          <section>
            <h2>
              {data.league.name} — {data.league.season}
            </h2>
            <p>
              {data.league.total_rosters} teams · Draft status: {data.draft.status} ·{' '}
              {data.draft.type} · ${data.draft.settings.budget} budget · {data.draft.settings.rounds}{' '}
              rounds
            </p>
          </section>

          <section>
            <h3>Teams</h3>
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Keepers</th>
                </tr>
              </thead>
              <tbody>
                {data.rosters.map((roster) => (
                  <tr key={roster.roster_id}>
                    <td>{teamNameForRoster(roster, data.users)}</td>
                    <td>{roster.keepers?.length ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3>Live Picks ({picks.length})</h3>
            {picksError && <p className="error">{picksError}</p>}
            {sortedPicks.length === 0 ? (
              <p>No picks yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Pos</th>
                    <th>NFL Team</th>
                    <th>Amount</th>
                    <th>Bought By</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPicks.map((pick) => {
                    const roster = data.rosters.find((r) => r.roster_id === pick.roster_id)
                    return (
                      <tr key={pick.pick_no}>
                        <td>{pick.pick_no}</td>
                        <td>
                          {pick.metadata?.first_name} {pick.metadata?.last_name}
                        </td>
                        <td>{pick.metadata?.position}</td>
                        <td>{pick.metadata?.team}</td>
                        <td>${pick.metadata?.amount ?? '—'}</td>
                        <td>{roster ? teamNameForRoster(roster, data.users) : pick.roster_id}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </main>
  )
}

export default App
