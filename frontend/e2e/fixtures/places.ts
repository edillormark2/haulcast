import type { PlaceSuggestion } from '../../src/api/types'

/** GET /api/geocode/?q=…: suggestions for the place fields. */
export const PLACES: PlaceSuggestion[] = [
  {
    label: 'Dallas, Texas, US',
    lat: 32.7767,
    lon: -96.797,
    name: 'Dallas',
    detail: 'Texas, US',
    kind: 'city',
  },
  {
    label: 'Atlanta, Georgia, US',
    lat: 33.749,
    lon: -84.388,
    name: 'Atlanta',
    detail: 'Georgia, US',
    kind: 'city',
  },
]
