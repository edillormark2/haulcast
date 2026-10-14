import type { Checkpoint, Route } from '../api/types'
import { labelAnchor, mileAtTime, pointAtMile } from './geo'

const T0 = Date.parse('2026-10-16T12:00:00Z')
const HOUR = 3_600_000

function checkpoint(index: number, mile: number, hours: number): Checkpoint {
  return {
    index,
    mile,
    lat: 0,
    lon: 0,
    eta: new Date(T0 + hours * HOUR).toISOString(),
    stretch: [0, 0],
    risk: 'low',
    factors: { wind: 'low', rain: 'low', snow: 'low' },
    drivers: [],
    load_rule: null,
    reason: '',
    weather: { wind_mph: 0, gust_mph: 0, rain_in_hr: 0, snow_in_hr: 0 },
  }
}

const route = {
  id: 'A',
  distance_mi: 100,
  geometry: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  geometry_miles: [0, 50, 100],
  checkpoints: [checkpoint(0, 0, 0), checkpoint(1, 50, 1), checkpoint(2, 100, 3)],
} as unknown as Route

describe('mileAtTime', () => {
  it('interpolates between checkpoint arrival times', () => {
    expect(mileAtTime(route, T0 + 0.5 * HOUR)).toBeCloseTo(25)
    expect(mileAtTime(route, T0 + 2 * HOUR)).toBeCloseTo(75) // slower second leg
  })

  it('holds at the ends', () => {
    expect(mileAtTime(route, T0 - HOUR)).toBe(0)
    expect(mileAtTime(route, T0 + 10 * HOUR)).toBe(100)
  })
})

describe('pointAtMile', () => {
  it('walks along the geometry by mile marker', () => {
    expect(pointAtMile(route, 25)).toEqual([0.5, 0])
    expect(pointAtMile(route, 75)).toEqual([1, 0.5])
  })
})

describe('labelAnchor', () => {
  it('picks the middle point farthest from the other routes', () => {
    const other = { ...route, geometry: [[0.5, 0]] } as unknown as Route
    const [lon, lat] = labelAnchor(route, [other])
    expect(lat).toBeGreaterThan(0) // the second, vertical half of the route
    expect(lon).toBe(1)
  })
})
