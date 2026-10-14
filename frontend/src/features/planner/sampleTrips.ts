import type { TripRequest } from '../../api/types'
import { nextHour, toOffsetIso } from '../../lib/time'

interface SampleTrip {
  title: string
  detail: string
  trip: Omit<TripRequest, 'departure'>
}

/** Real lanes of different lengths, so reviewers can try the planner in one click. */
export const SAMPLE_TRIPS: readonly SampleTrip[] = [
  {
    title: 'Dallas to Atlanta',
    detail: 'About 800 mi on truck routing',
    trip: {
      origin: { label: 'Dallas, Texas, US', lat: 32.7767, lon: -96.797 },
      destination: { label: 'Atlanta, Georgia, US', lat: 33.749, lon: -84.388 },
      load_lb: 42_000,
      interval_mi: 25,
    },
  },
  {
    title: 'Chicago to Denver',
    detail: 'About 1,000 mi across the Plains',
    trip: {
      origin: { label: 'Chicago, Illinois, US', lat: 41.8781, lon: -87.6298 },
      destination: { label: 'Denver, Colorado, US', lat: 39.7392, lon: -104.9903 },
      load_lb: 36_000,
      interval_mi: 25,
    },
  },
  {
    title: 'Los Angeles to Chicago',
    detail: 'About 2,000 mi, most of the 48 hours',
    trip: {
      origin: { label: 'Los Angeles, California, US', lat: 34.0522, lon: -118.2437 },
      destination: { label: 'Chicago, Illinois, US', lat: 41.8781, lon: -87.6298 },
      load_lb: 28_000,
      interval_mi: 50,
    },
  },
]

export function withNextDeparture(trip: SampleTrip['trip']): TripRequest {
  return { ...trip, departure: toOffsetIso(nextHour(new Date())) }
}
