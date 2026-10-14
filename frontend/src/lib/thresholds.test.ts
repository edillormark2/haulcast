import type { Thresholds } from '../api/types'
import { levelFor, overallLevel, shaderBounds } from './thresholds'

// Wind for a load over 40,000 lb: the load rules collapse the High band.
const heavyWind: Thresholds = { unit: 'mph', bounds: [25, 35, 35, 45], no_travel_inclusive: true }
const rain: Thresholds = { unit: 'in/hr', bounds: [0.1, 0.25, 0.5, 1], no_travel_inclusive: false }
const snow: Thresholds = { unit: 'in/hr', bounds: [0.5, 1, 2, 3], no_travel_inclusive: false }

describe('levelFor', () => {
  it.each([
    [24.9, 'low'],
    [25, 'moderate'],
    [34.9, 'moderate'],
    [35, 'severe'],
    [44.9, 'severe'],
    [45, 'no_travel'],
  ] as const)('classifies %s mph of wind for a heavy load as %s', (value, level) => {
    expect(levelFor(value, heavyWind)).toBe(level)
  })

  it('keeps an exclusive No Travel bound in the band below', () => {
    expect(levelFor(1, rain)).toBe('severe')
    expect(levelFor(1.01, rain)).toBe('no_travel')
    expect(levelFor(3, snow)).toBe('severe')
  })
})

describe('overallLevel', () => {
  it('takes the worst factor', () => {
    const thresholds = { wind: heavyWind, rain, snow }
    expect(overallLevel({ wind: 10, rain: 0.3, snow: 0 }, thresholds)).toBe('high')
    expect(overallLevel({ wind: 40, rain: 0.3, snow: 0 }, thresholds)).toBe('severe')
  })
})

describe('shaderBounds', () => {
  it('lifts an exclusive bound by half a quantisation step', () => {
    expect(shaderBounds(rain, 0.01)).toEqual([0.1, 0.25, 0.5, 1.005])
    expect(shaderBounds(heavyWind, 0.5)).toEqual([25, 35, 35, 45])
  })
})
