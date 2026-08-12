import { useEffect, useState } from 'react'
import { getDraftPicks } from '../lib/sleeperApi'
import type { SleeperPick } from '../lib/sleeperTypes'

const POLL_INTERVAL_MS = 3000

export function useDraftPicks(draftId: string | null) {
  const [picks, setPicks] = useState<SleeperPick[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draftId) {
      setPicks([])
      return
    }

    let cancelled = false

    async function poll() {
      try {
        const data = await getDraftPicks(draftId as string)
        if (!cancelled) {
          setPicks(data)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to fetch draft picks')
        }
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [draftId])

  return { picks, error }
}
