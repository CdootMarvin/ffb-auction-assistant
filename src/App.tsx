import { useEffect, useMemo, useState } from 'react'
import {
  getDraft,
  getDraftPicks,
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
import { computeRealisticBidders } from './lib/bidders'
import { computeDynamicValues } from './lib/dynamicValue'
import { generateExplanation } from './lib/explanation'
import {
  computeHistoricalAccuracy,
  sameRosterFormat,
  type HistoricalAccuracyResult,
} from './lib/historicalAccuracy'
import { runBacktest, type BacktestResult } from './lib/backtest'

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
  // Auto-reconnect on mount if a league was previously connected (e.g. the tab
  // was refreshed or crashed mid-draft) - draft-day resilience, see ROADMAP.md
  // Phase 11.
  const [connectedLeagueId, setConnectedLeagueId] = useState<string | null>(
    () => localStorage.getItem(LEAGUE_ID_STORAGE_KEY) || null,
  )
  const [data, setData] = useState<LeagueData | null>(null)
  const [loading, setLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  const [baseline, setBaseline] = useState<BaselineResult | null>(null)
  const [baselineLoading, setBaselineLoading] = useState(false)
  const [baselineError, setBaselineError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)

  const [historicalAccuracy, setHistoricalAccuracy] = useState<HistoricalAccuracyResult | null>(null)
  const [historicalAccuracyLoading, setHistoricalAccuracyLoading] = useState(false)
  const [historicalAccuracyNote, setHistoricalAccuracyNote] = useState<string | null>(null)
  const [backtest, setBacktest] = useState<BacktestResult | null>(null)

  const {
    picks,
    error: picksError,
    lastUpdated: picksLastUpdated,
    refreshNow: refreshPicksNow,
  } = useDraftPicks(data?.draft.draft_id ?? null)

  // Ticks independently of poll success/failure so the staleness warning below
  // still advances even if repeated polls fail with the identical error message
  // (which wouldn't otherwise trigger a re-render).
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 5000)
    return () => clearInterval(interval)
  }, [])
  const picksStaleSeconds = picksLastUpdated != null ? Math.round((nowTick - picksLastUpdated) / 1000) : null
  const picksStale = picksStaleSeconds != null && picksStaleSeconds > 15

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
          const message = e instanceof Error ? e.message : ''
          setConnectError(
            message.includes('404')
              ? `League ${connectedLeagueId} not found - double check the League ID.`
              : message || 'Failed to connect to league',
          )
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

  useEffect(() => {
    if (!data || !data.league.previous_league_id) {
      setHistoricalAccuracy(null)
      setHistoricalAccuracyNote(null)
      return
    }
    let cancelled = false

    async function loadHistoricalAccuracy() {
      setHistoricalAccuracyLoading(true)
      setHistoricalAccuracyNote(null)
      setHistoricalAccuracy(null)
      setBacktest(null)
      try {
        const d = data as LeagueData
        const historicalLeague = await getLeague(d.league.previous_league_id as string)
        if (cancelled) return

        if (!sameRosterFormat(d.league.roster_positions, historicalLeague.roster_positions)) {
          setHistoricalAccuracyNote(
            `Prior season (${historicalLeague.season}) used a different roster format ` +
              `(${historicalLeague.roster_positions.join(', ')}) than this season - not structurally ` +
              `comparable, excluded rather than mixed in.`,
          )
          return
        }

        const [historicalRosters, historicalDraft] = await Promise.all([
          getLeagueRosters(historicalLeague.league_id),
          getDraft(historicalLeague.draft_id),
        ])
        const [historicalProjections, historicalPicks] = await Promise.all([
          getProjections(historicalLeague.season),
          getDraftPicks(historicalLeague.draft_id),
        ])
        if (cancelled) return

        const result = computeHistoricalAccuracy(
          historicalLeague,
          historicalRosters,
          historicalProjections,
          historicalDraft.settings.budget,
          historicalPicks,
        )
        if (!cancelled) setHistoricalAccuracy(result)

        const backtestResult = runBacktest(
          historicalLeague,
          historicalRosters,
          historicalProjections,
          historicalDraft.settings.budget,
          historicalPicks,
        )
        if (!cancelled) setBacktest(backtestResult)
      } catch (e) {
        if (!cancelled) {
          setHistoricalAccuracyNote(
            e instanceof Error ? e.message : 'Failed to compute historical accuracy',
          )
        }
      } finally {
        if (!cancelled) setHistoricalAccuracyLoading(false)
      }
    }

    loadHistoricalAccuracy()
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
    setSearchQuery('')
    setSelectedPlayerId(null)
  }

  const sortedPicks = [...picks].sort((a, b) => b.pick_no - a.pick_no)
  const rosterById = new Map(data?.rosters.map((r) => [r.roster_id, r]) ?? [])

  // Memoized as a group: these all transitively depend only on baseline/picks/data,
  // not on UI-only state like searchQuery. Without this, every keystroke in the
  // search box (or any other unrelated re-render) would recompute the full
  // economy/scarcity/bidders/dynamicValue pipeline over every player and team from
  // scratch - wasteful, and risks feeling janky under live-draft time pressure.
  const { economy, teamEconomyByRoster, positionScarcity, dynamicValues, keptPlayers, availablePlayers } =
    useMemo(() => {
      const economy = baseline ? computeLeagueEconomy(baseline, picks) : null
      const teamEconomyByRoster = new Map(economy?.teamEconomy.map((t) => [t.rosterId, t]) ?? [])

      const rosterReq =
        data != null ? parseRosterRequirements(data.league.roster_positions, data.league.total_rosters) : null
      const teamNeeds =
        data != null && baseline != null && rosterReq != null
          ? computeTeamPositionNeeds(data.rosters, baseline, picks, rosterReq)
          : []
      const positionScarcity = baseline ? computePositionScarcity(baseline, picks, teamNeeds) : []

      const bidders =
        baseline && economy
          ? computeRealisticBidders(baseline.players, economy.draftedPlayerIds, teamEconomyByRoster, teamNeeds)
          : new Map()

      const dynamicValues =
        baseline && economy
          ? computeDynamicValues(baseline.players, economy.draftedPlayerIds, economy, positionScarcity, bidders)
          : new Map()

      const keptPlayers = baseline?.players.filter((p) => p.isKept) ?? []
      const availablePlayers = baseline
        ? [...baseline.players]
            .filter((p) => !p.isKept && p.vor > 0 && !economy?.draftedPlayerIds.has(p.playerId))
            .sort(
              (a, b) =>
                (dynamicValues.get(b.playerId)?.currentValue ?? b.dollarValue) -
                (dynamicValues.get(a.playerId)?.currentValue ?? a.dollarValue),
            )
        : []

      return { economy, teamEconomyByRoster, teamNeeds, positionScarcity, bidders, dynamicValues, keptPlayers, availablePlayers }
    }, [baseline, picks, data])

  const searchMatches = searchQuery.trim()
    ? availablePlayers
        .filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
        .slice(0, 8)
    : []
  const selectedPlayer = availablePlayers.find((p) => p.playerId === selectedPlayerId) ?? null
  const selectedDv = selectedPlayer ? dynamicValues.get(selectedPlayer.playerId) : undefined
  const selectedScarcity = selectedPlayer
    ? positionScarcity.find((s) => s.position === selectedPlayer.position)
    : undefined
  const explanation =
    selectedPlayer && selectedDv
      ? generateExplanation(selectedPlayer, selectedDv, selectedScarcity, data?.league.total_rosters ?? 0)
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
              <section className="decision-panel">
                <h3>On the Board</h3>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setSelectedPlayerId(null)
                  }}
                  placeholder="Search for the player up for bid…"
                  className="player-search"
                />
                {searchMatches.length > 0 && (
                  <ul className="search-matches">
                    {searchMatches.map((p) => (
                      <li key={p.playerId}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPlayerId(p.playerId)
                            setSearchQuery('')
                          }}
                        >
                          {p.name} ({p.position}, {p.nflTeam})
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {selectedPlayer && selectedDv && (
                  <div className={`decision-card recommendation-${selectedDv.recommendation.toLowerCase()}`}>
                    <h4>
                      {selectedPlayer.name} — {selectedPlayer.position}, {selectedPlayer.nflTeam}
                    </h4>
                    <div className="decision-stats">
                      <div>
                        <span className="stat-label">Current Value</span>
                        <span className="stat-value">${selectedDv.currentValue}</span>
                      </div>
                      <div>
                        <span className="stat-label">Expected Price</span>
                        <span className="stat-value">${selectedDv.expectedPrice}</span>
                      </div>
                      <div>
                        <span className="stat-label">Range</span>
                        <span className="stat-value">
                          ${selectedDv.rangeLow}–${selectedDv.rangeHigh}
                        </span>
                      </div>
                      <div>
                        <span className="stat-label">Your Max</span>
                        <span className="stat-value">${selectedDv.recommendedMax}</span>
                      </div>
                      <div>
                        <span className="stat-label">Demand</span>
                        <span className="stat-value">{selectedDv.realisticBidderCount} bidders</span>
                      </div>
                      <div>
                        <span className="stat-label">Recommendation</span>
                        <span className="stat-value">{selectedDv.recommendation}</span>
                      </div>
                    </div>
                    <ul className="explanation">
                      {explanation.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

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
                <h3>Player Values ({availablePlayers.length} above replacement)</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Pos</th>
                      <th>NFL Team</th>
                      <th>Pre-Draft Value</th>
                      <th>Current Value</th>
                      <th>Expected Price</th>
                      <th>Range</th>
                      <th>Bidders</th>
                      <th>Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availablePlayers.map((p) => {
                      const dv = dynamicValues.get(p.playerId)
                      return (
                        <tr key={p.playerId}>
                          <td>{p.name}</td>
                          <td>{p.position}</td>
                          <td>{p.nflTeam}</td>
                          <td>${p.dollarValue}</td>
                          <td>${dv?.currentValue ?? p.dollarValue}</td>
                          <td>${dv?.expectedPrice ?? p.dollarValue}</td>
                          <td>
                            {dv ? `$${dv.rangeLow}–$${dv.rangeHigh}` : '—'}
                          </td>
                          <td>{dv?.realisticBidderCount ?? 0}</td>
                          <td>{dv?.recommendation ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>

              <section>
                <h3>Historical Model Accuracy</h3>
                {historicalAccuracyLoading && <p>Checking prior seasons…</p>}
                {historicalAccuracyNote && <p>{historicalAccuracyNote}</p>}
                {historicalAccuracy && (
                  <>
                    <p>
                      Static baseline methodology (Layers 1-2) applied to the {historicalAccuracy.season} season's
                      real projections and league settings, compared against actual sale prices from that
                      completed draft. {historicalAccuracy.overall.count} of{' '}
                      {historicalAccuracy.overall.count + historicalAccuracy.excludedPickCount} picks matched to a
                      projected player.
                    </p>
                    <p>
                      Overall: mean absolute error ${historicalAccuracy.overall.mae.toFixed(2)}, mean absolute % error{' '}
                      {(historicalAccuracy.overall.mape * 100).toFixed(0)}%, correlation{' '}
                      {historicalAccuracy.overall.correlation != null
                        ? historicalAccuracy.overall.correlation.toFixed(2)
                        : '—'}
                    </p>
                    <table>
                      <thead>
                        <tr>
                          <th>Position</th>
                          <th>Picks</th>
                          <th>MAE</th>
                          <th>MAPE</th>
                          <th>Correlation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['QB', 'RB', 'WR', 'TE'] as const).map((pos) => {
                          const s = historicalAccuracy.byPosition[pos]
                          return (
                            <tr key={pos}>
                              <td>{pos}</td>
                              <td>{s.count}</td>
                              <td>${s.mae.toFixed(2)}</td>
                              <td>{(s.mape * 100).toFixed(0)}%</td>
                              <td>{s.correlation != null ? s.correlation.toFixed(2) : '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <p>
                      Only one structurally comparable historical draft exists for this league (prior seasons used a
                      different roster format). Per MODELING.md's shrinkage approach, this isn't enough data to
                      justify moving any heuristic constant away from its documented default — findings here are
                      informative, not a basis for recalibration yet.
                    </p>
                  </>
                )}
              </section>

              {backtest && (
                <section>
                  <h3>Point-in-Time Backtest</h3>
                  <p>
                    Replayed the {backtest.season} draft pick by pick — at each pick, only picks that happened
                    strictly before it are known, exactly like a live draft. Compares three tiers of increasing
                    complexity against what each player actually sold for. {backtest.picks.length} of{' '}
                    {backtest.picks.length + backtest.excludedPickCount} picks matched to a projected player.
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>MAE</th>
                        <th>MAPE</th>
                        <th>Correlation</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Static baseline only (no draft-day adjustment)</td>
                        <td>${backtest.static.mae.toFixed(2)}</td>
                        <td>{(backtest.static.mape * 100).toFixed(0)}%</td>
                        <td>{backtest.static.correlation != null ? backtest.static.correlation.toFixed(2) : '—'}</td>
                      </tr>
                      <tr>
                        <td>+ League-wide inflation only</td>
                        <td>${backtest.inflationOnly.mae.toFixed(2)}</td>
                        <td>{(backtest.inflationOnly.mape * 100).toFixed(0)}%</td>
                        <td>
                          {backtest.inflationOnly.correlation != null
                            ? backtest.inflationOnly.correlation.toFixed(2)
                            : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td>Full model (+ positional scarcity + bidders)</td>
                        <td>${backtest.fullModel.mae.toFixed(2)}</td>
                        <td>{(backtest.fullModel.mape * 100).toFixed(0)}%</td>
                        <td>
                          {backtest.fullModel.correlation != null ? backtest.fullModel.correlation.toFixed(2) : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <h4>Full model, by position</h4>
                  <table>
                    <thead>
                      <tr>
                        <th>Position</th>
                        <th>Picks</th>
                        <th>MAE</th>
                        <th>MAPE</th>
                        <th>Correlation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(['QB', 'RB', 'WR', 'TE'] as const).map((pos) => {
                        const s = backtest.fullModelByPosition[pos]
                        return (
                          <tr key={pos}>
                            <td>{pos}</td>
                            <td>{s.count}</td>
                            <td>${s.mae.toFixed(2)}</td>
                            <td>{(s.mape * 100).toFixed(0)}%</td>
                            <td>{s.correlation != null ? s.correlation.toFixed(2) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p>
                    Honest limitation: this draws on the same single historical draft Phase 9 already used. Not a
                    held-out validation — a sanity/regression check. A better score here doesn't prove the extra
                    complexity is worth it beyond this one draft.
                  </p>
                </section>
              )}
            </>
          )}

          <section>
            <h3>Live Picks ({picks.length})</h3>
            <div className="picks-status">
              <span className={picksStale ? 'error' : undefined}>
                {picksStaleSeconds != null
                  ? `Updated ${picksStaleSeconds}s ago${picksStale ? ' — data may be stale, check your connection' : ''}`
                  : 'Waiting for first update…'}
              </span>
              <button type="button" onClick={refreshPicksNow}>
                Refresh now
              </button>
            </div>
            {picksError && <p className="error">Poll failed: {picksError} (will keep retrying automatically)</p>}
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
