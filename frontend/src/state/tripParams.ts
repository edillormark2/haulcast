import { useCallback, useMemo, useSyncExternalStore } from 'react'

import type { CheckpointInterval, Place, TripRequest } from '../api/types'

/**
 * The planned trip lives in the URL, so a plan is a shareable link:
 * ?from=41.87810,-87.62980,Chicago, IL&to=…&depart=2026-10-16T06:00:00-05:00&load=42000&every=25
 */
export const INTERVALS: readonly CheckpointInterval[] = [10, 25, 50]

export function tripFromSearch(search: string): TripRequest | null {
  const params = new URLSearchParams(search)
  const origin = parsePlace(params.get('from'))
  const destination = parsePlace(params.get('to'))
  const departure = params.get('depart')
  const load = Number(params.get('load'))
  const interval = Number(params.get('every') ?? 25) as CheckpointInterval
  if (!origin || !destination || !departure || Number.isNaN(Date.parse(departure))) return null
  if (!Number.isInteger(load) || load < 0 || !INTERVALS.includes(interval)) return null
  return { origin, destination, departure, load_lb: load, interval_mi: interval }
}

export function tripToSearch(trip: TripRequest): string {
  const params = new URLSearchParams({
    from: formatPlace(trip.origin),
    to: formatPlace(trip.destination),
    depart: trip.departure,
    load: String(trip.load_lb),
    every: String(trip.interval_mi),
  })
  return `?${params}`
}

function parsePlace(value: string | null): Place | null {
  if (!value) return null
  const [lat, lon, ...label] = value.split(',')
  const place = { lat: Number(lat), lon: Number(lon), label: label.join(',').trim() }
  if (!place.label || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null
  return place
}

function formatPlace(place: Place): string {
  return `${place.lat.toFixed(5)},${place.lon.toFixed(5)},${place.label}`
}

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}

const getSearch = () => window.location.search

/** The trip in the URL, plus a setter that records a history entry. */
export function useTripParams() {
  const search = useSyncExternalStore(subscribe, getSearch)
  const trip = useMemo(() => tripFromSearch(search), [search])
  const setTrip = useCallback((next: TripRequest | null) => {
    const url = next ? tripToSearch(next) : window.location.pathname
    window.history.pushState(null, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])
  return [trip, setTrip] as const
}
