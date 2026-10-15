import { conditionsAt, type HourlySeries, roundHalfEven } from './forecast'

describe('roundHalfEven', () => {
  // Each case is what Python's round() returns for the same double.
  it.each([
    [0.125, 2, 0.12],
    [0.375, 2, 0.38],
    [2.675, 2, 2.67], // the double is a hair under 2.675
    [12.25, 1, 12.2],
    [12.35, 1, 12.3],
    [12.75, 1, 12.8],
    [34.95, 1, 35], // the double is a hair over 34.95
    [0.1 + 0.2, 2, 0.3],
    [-0.125, 2, -0.12],
    [1e-20, 2, 0],
  ])('rounds %s to %i decimals as %s', (x, digits, expected) => {
    expect(roundHalfEven(x, digits)).toBe(expected)
  })

  it.each([
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [0.01 / 0.02, 0], // 0.01 in/hr of snow in 0.02 steps
    [0.05 / 0.02, 2],
    [0.49 / 0.02, 24],
    [0.29 / 0.01, 29],
    [254.5, 254],
    [255.5, 256],
  ])('rounds %s to the even neighbour on a tie', (x, expected) => {
    expect(roundHalfEven(x)).toBe(expected)
  })
})

describe('conditionsAt', () => {
  const start = Date.parse('2026-10-16T00:00:00Z') / 1000
  const series: HourlySeries = {
    start,
    windMph: [10, 20, 30],
    rainIn: [0, 0.125, 0.4],
    snowIn: [0, 0.01, 0.2],
  }

  it('blends wind between hours and takes precipitation from the hour driven through', () => {
    expect(conditionsAt(series, start + 1800)).toEqual({ wind: 15, rain: 0.12, snow: 0.01 })
    expect(conditionsAt(series, start + 3600)).toEqual({ wind: 20, rain: 0.4, snow: 0.2 })
  })

  it('refuses a moment the forecast does not cover', () => {
    expect(() => conditionsAt(series, start - 1)).toThrow(RangeError)
    expect(() => conditionsAt(series, start + 2 * 3600)).toThrow(RangeError)
  })
})
