import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { decodeHeatmap } from '../lib/heatmap'
import { ApiError, api } from './client'
import type { HeatmapRequest, TripRequest } from './types'

const MINUTE = 60_000

/** Retry only failures that a retry can fix: network blips and busy upstreams. */
function retryTransient(failureCount: number, error: Error): boolean {
  const transient = error instanceof ApiError && (error.status === 0 || error.status >= 502)
  return transient && failureCount < 1
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
    retry: retryTransient,
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
    retry: retryTransient,
    select: decodeHeatmap,
  })
}
