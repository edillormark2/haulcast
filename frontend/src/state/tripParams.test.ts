import type { TripRequest } from '../api/types'
import { tripFromSearch, tripToSearch } from './tripParams'

const trip: TripRequest = {
  origin: { label: 'Chicago, Illinois, US', lat: 41.8781, lon: -87.6298 },
  destination: { label: 'Denver, Colorado, US', lat: 39.7392, lon: -104.9903 },
  departure: '2026-10-16T06:00:00-05:00',
  load_lb: 42_000,
  interval_mi: 25,
}

describe('trip URL parameters', () => {
  it('round-trips a trip, including labels with commas', () => {
    expect(tripFromSearch(tripToSearch(trip))).toEqual(trip)
  })

  it.each([
    ['missing destination', '?from=41,-87,Chicago&depart=2026-10-16T06:00:00Z&load=1&every=25'],
    ['bad interval', tripToSearch(trip).replace('every=25', 'every=15')],
    ['bad load', tripToSearch(trip).replace('load=42000', 'load=heavy')],
    ['bad date', tripToSearch(trip).replace(/depart=[^&]+/, 'depart=tomorrow')],
  ])('rejects a URL with a %s', (_, search) => {
    expect(tripFromSearch(search)).toBeNull()
  })
})
