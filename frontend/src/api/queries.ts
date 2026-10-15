import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'

import { decodeHeatmap } from '../lib/heatmap'
import { ApiError, api } from './client'
import type { HeatmapRequest, TripRequest } from './types'

const MINUTE = 60_000
/** A busy service is retried this many times, after the wait it asks for… */
const BUSY_RETRIES = 3
/** …as long as that wait is short. A used-up hourly or daily quota isn't. */
const MAX_AUTO_WAIT_S = 60
/** Assumed when a busy service didn't say how long to wait. */
const DEFAULT_WAIT_S = 20

/**
 * Retry only failures that a retry can fix. Network blips and gateway errors
 * get one quick retry. A busy service gets a few, each after the wait it
 * asked for: Open-Meteo's per-minute limit clears within a minute.
 */
export function shouldRetry(failureCount: number, error: Error): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.busy) return failureCount < BUSY_RETRIES && busyWaitS(error) <= MAX_AUTO_WAIT_S
  return (error.status === 0 || error.status >= 502) && failureCount < 1
}

export function retryDelay(failureCount: number, error: Error): number {
  if (error instanceof ApiError && error.busy) return busyWaitS(error) * 1000
  return Math.min(1000 * 2 ** failureCount, 30_000)
}

function busyWaitS(error: ApiError): number {
  return error.retryAfter ?? DEFAULT_WAIT_S
}

/** An automatic retry after a busy service turned a request away. */
export interface BusyRetry {
  /** Who was busy, e.g. "Open-Meteo". */
  service: string
  /** Seconds the retry waits. */
  waitS: number
  /** Failures so far: a new value means a new wait has started. */
  attempt: number
}

/** The retry a query is waiting on after a busy refusal, if any. */
export function busyRetry(
  query: Pick<UseQueryResult, 'failureReason' | 'failureCount' | 'isFetching'>,
): BusyRetry | null {
  const error = query.failureReason
  if (!query.isFetching || !(error instanceof ApiError) || !error.busy) return null
  return {
    service: error.service ?? 'Haulcast',
    waitS: busyWaitS(error),
    attempt: query.failureCount,
  }
}

export function useRiskRules() {
  return useQuery({
    queryKey: ['rules'],
    queryFn: ({ signal }) => api.rules(signal),
    staleTime: Infinity,
  })
}

export function usePlaceSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['geocode', trimmed.toLowerCase()],
    queryFn: ({ signal }) => api.geocode(trimmed, signal),
    enabled: trimmed.length >= 2,
    staleTime: 24 * 60 * MINUTE,
    placeholderData: keepPreviousData,
  })
}

// Plans and heatmaps are not aborted on unmount: the server finishes the work
// regardless, and letting the request complete means a remount reuses it.
export function usePlan(trip: TripRequest | null) {
  return useQuery({
    queryKey: ['plan', trip],
    queryFn: () => api.plan(trip as TripRequest),
    enabled: trip !== null,
    staleTime: 10 * MINUTE,
    retry: shouldRetry,
    retryDelay,
    // Changing only the checkpoint interval keeps the old routes on screen
    // while the new ones load. A different trip starts from a clean map.
    placeholderData: (previous, previousQuery) => {
      const previousTrip = previousQuery?.queryKey[1] as TripRequest | null | undefined
      return trip && previousTrip && sameJourney(trip, previousTrip) ? previous : undefined
    },
  })
}

/** Same ends, departure and load: only the checkpoint spacing may differ. */
function sameJourney(a: TripRequest, b: TripRequest): boolean {
  return (
    a.origin.lat === b.origin.lat &&
    a.origin.lon === b.origin.lon &&
    a.destination.lat === b.destination.lat &&
    a.destination.lon === b.destination.lon &&
    a.departure === b.departure &&
    a.load_lb === b.load_lb
  )
}

export function useHeatmap(heatmapRequest: HeatmapRequest | undefined) {
  return useQuery({
    queryKey: ['heatmap', heatmapRequest],
    queryFn: () => api.heatmap(heatmapRequest as HeatmapRequest),
    enabled: heatmapRequest !== undefined,
    staleTime: 10 * MINUTE,
    retry: shouldRetry,
    retryDelay,
    select: decodeHeatmap,
  })
}
