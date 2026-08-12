import { useEffect, useState } from 'react'
import {
  getDraft,
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  getPreviousSeasonPrices,
  getProjections,
} from './lib/sleeperApi'
import type { SleeperDraft, SleeperLeague, SleeperRoster, SleeperUser } from './lib/sleeperTypes'
import { useDraftPicks } from './hooks/useDraftPicks'
import { computeBaseline, parseRosterRequirements, type BaselineResult } from './lib/valuation'
import { computeLeagueEconomy } from './lib/economy'
import { computePositionScarcity, computeTeamPositionNeeds } from './lib/scarcity'

const LEAGUE_ID_STORAGE_KEY = 'ffb-auction-assistant:league-id'

interface LeagueData {
  league: SleeperLeague
  users: SleeperUser[]
  rosters: SleeperRoster[]
  draft: SleeperDraft
}

function teamNameForRoster(roster: SleeperRoster | undefined, users: SleeperUser[]): string {
  if (!roster) return 'Unknown'
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

  const [baseline, setBaseline] = useState<BaselineResult | null>(null)
  const [baselineLoading, setBaselineLoading] = useState(false)
  const [baselineError, setBaselineError] = useState<string | null>(null)

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

  useEffect(() => {
    if (!data) return
    let cancelled = false

    async function loadBaseline() {
      setBaselineLoading(true)
      setBaselineError(null)
      try {
        const d = data as LeagueData
        const [projections, previousPrices] = await Promise.all([
          getProjections(d.league.season),
          getPreviousSeasonPrices(d.league.previous_league_id),
        ])
        if (cancelled) return
        const result = computeBaseline(
          projections,
          d.league.scoring_settings,
          d.rosters,
          d.league.roster_positions,
          d.league.total_rosters,
          d.draft.settings.budget,
          previousPrices,
        )
        if (!cancelled) setBaseline(result)
      } catch (e) {
        if (!cancelled) {
          setBaseline(null)
          setBaselineError(e instanceof Error ? e.message : 'Failed to compute baseline values')
        }
      } finally {
        if (!cancelled) setBaselineLoading(false)
      }
    }

    loadBaseline()
    return () => {
      cancelled = true
    }
  }, [data])

  function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = leagueIdInput.trim()
    if (!trimmed) return
    localStorage.setItem(LEAGUE_ID_STORAGE_KEY, trimmed)
    setConnectedLeagueId(trimmed)
  }

  const sortedPicks = [...picks].sort((a, b) => b.pick_no - a.pick_no)
  const rosterById = new Map(data?.rosters.map((r) => [r.roster_id, r]) ?? [])

  const economy = baseline ? computeLeagueEconomy(baseline, picks) : null
  const teamEconomyByRoster = new Map(economy?.teamEconomy.map((t) => [t.rosterId, t]) ?? [])

  const rosterReq =
    data != null ? parseRosterRequirements(data.league.roster_positions, data.league.total_rosters) : null
  const teamNeeds =
    data != null && baseline != null && rosterReq != null
      ? computeTeamPositionNeeds(data.rosters, baseline, picks, rosterReq)
      : []
  const positionScarcity = baseline ? computePositionScarcity(baseline, picks, teamNeeds) : []

  const keptPlayers = baseline?.players.filter((p) => p.isKept) ?? []
  const availablePlayers = baseline
    ? [...baseline.players]
        .filter((p) => !p.isKept && p.vor > 0 && !economy?.draftedPlayerIds.has(p.playerId))
        .sort((a, b) => b.dollarValue - a.dollarValue)
    : []

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

          {baselineLoading && <p>Computing baseline player values…</p>}
          {baselineError && <p className="error">{baselineError}</p>}

          {baseline && (
            <>
              <section>
                <h3>Keepers &amp; Team Budgets</h3>
                <p>
                  League spendable pool (after keeper costs and roster-slot reserves): $
                  {baseline.spendablePool}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>Keepers</th>
                      <th>Keeper Cost</th>
                      <th>Effective Budget</th>
                      <th>Picks Made</th>
                      <th>Spent</th>
                      <th>Remaining Budget</th>
                      <th>Remaining Slots</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baseline.teamBudgets.map((tb) => {
                      const roster = rosterById.get(tb.rosterId)
                      const teamKeepers = keptPlayers.filter((p) => p.keptByRosterId === tb.rosterId)
                      const te = teamEconomyByRoster.get(tb.rosterId)
                      return (
                        <tr key={tb.rosterId}>
                          <td>{teamNameForRoster(roster, data.users)}</td>
                          <td>
                            {teamKeepers.length === 0
                              ? '—'
                              : teamKeepers.map((p) => p.name).join(', ')}
                          </td>
                          <td>${tb.keeperCostTotal}</td>
                          <td>${tb.effectiveBudget}</td>
                          <td>{te?.picksMade ?? 0}</td>
                          <td>${te?.spentInDraft ?? 0}</td>
                          <td>${te?.remainingBudget ?? tb.effectiveBudget}</td>
                          <td>{te?.remainingSlots ?? tb.remainingSlots}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>

              {economy && (
                <section>
                  <h3>League Economy</h3>
                  <p>
                    Inflation index:{' '}
                    <strong>
                      {economy.inflationIndex != null ? economy.inflationIndex.toFixed(2) : '—'}
                    </strong>{' '}
                    {economy.inflationIndex != null &&
                      (economy.inflationIndex > 1
                        ? '(remaining players running more expensive than the preseason baseline)'
                        : economy.inflationIndex < 1
                          ? '(remaining players running cheaper than the preseason baseline)'
                          : '(exactly tracking the preseason baseline)')}
                  </p>
                  <p>
                    Remaining league money: ${economy.remainingTotalMoney} · Remaining VOR:{' '}
                    {economy.remainingTotalVor.toFixed(1)}
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Position</th>
                        <th>Spent So Far</th>
                        <th>Remaining VOR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(['QB', 'RB', 'WR', 'TE'] as const).map((pos) => (
                        <tr key={pos}>
                          <td>{pos}</td>
                          <td>${economy.positionSpending[pos]}</td>
                          <td>{economy.positionRemainingVor[pos].toFixed(1)}</td>
                        </tr>
                      ))}
                      {economy.otherSpending > 0 && (
                        <tr>
                          <td>Other</td>
                          <td>${economy.otherSpending}</td>
                          <td>—</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>
              )}

              <section>
                <h3>Positional Scarcity</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th>Remaining Players</th>
                      <th>Remaining VOR</th>
                      <th>Teams Needing Starter</th>
                      <th>Actual $/VOR So Far</th>
                      <th>Position Inflation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positionScarcity.map((ps) => (
                      <tr key={ps.position}>
                        <td>{ps.position}</td>
                        <td>{ps.remainingPlayerCount}</td>
                        <td>{ps.remainingVor.toFixed(1)}</td>
                        <td>{ps.teamsNeedingStarter}</td>
                        <td>{ps.actualDollarPerVor != null ? ps.actualDollarPerVor.toFixed(2) : '—'}</td>
                        <td>{ps.positionInflationIndex != null ? ps.positionInflationIndex.toFixed(2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section>
                <h3>Baseline Player Values ({availablePlayers.length} above replacement)</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Pos</th>
                      <th>NFL Team</th>
                      <th>Proj. Pts</th>
                      <th>VOR</th>
                      <th>$ Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availablePlayers.map((p) => (
                      <tr key={p.playerId}>
                        <td>{p.name}</td>
                        <td>{p.position}</td>
                        <td>{p.nflTeam}</td>
                        <td>{p.points.toFixed(1)}</td>
                        <td>{p.vor.toFixed(1)}</td>
                        <td>${p.dollarValue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}

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
                    const roster = rosterById.get(pick.roster_id)
                    return (
                      <tr key={pick.pick_no}>
                        <td>{pick.pick_no}</td>
                        <td>
                          {pick.metadata?.first_name} {pick.metadata?.last_name}
                        </td>
                        <td>{pick.metadata?.position}</td>
                        <td>{pick.metadata?.team}</td>
                        <td>${pick.metadata?.amount ?? '—'}</td>
                        <td>{teamNameForRoster(roster, data.users)}</td>
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
