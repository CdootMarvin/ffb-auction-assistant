import { useCallback, useEffect, useRef, useState } from 'react'
import { getDraftPicks } from '../lib/sleeperApi'
import type { SleeperPick } from '../lib/sleeperTypes'

const POLL_INTERVAL_MS = 3000

export function useDraftPicks(draftId: string | null) {
  const [picks, setPicks] = useState<SleeperPick[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const pollRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!draftId) {
      setPicks([])
      setLastUpdated(null)
      return
    }

    let cancelled = false

    async function poll() {
      try {
        const data = await getDraftPicks(draftId as string)
        if (!cancelled) {
          setPicks(data)
          setError(null)
          setLastUpdated(Date.now())
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to fetch draft picks')
        }
      }
    }

    pollRef.current = poll
    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [draftId])

  // Lets the UI trigger an immediate poll outside the regular interval (e.g. a
  // manual "refresh now" button) without waiting up to POLL_INTERVAL_MS.
  const refreshNow = useCallback(() => {
    pollRef.current()
  }, [])

  return { picks, error, lastUpdated, refreshNow }
}
