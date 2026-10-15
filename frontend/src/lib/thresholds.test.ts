import type { Factor, Thresholds } from '../api/types'
import { DECIMALS, roundHalfEven } from './forecast'
import { RISK_LEVELS } from './risk'
import { levelFor, overallLevel, shaderBounds } from './thresholds'

const wind: Thresholds = { unit: 'mph', bounds: [25, 35, 45, 55], no_travel_inclusive: true }
// Over 30,000 lb, 45 mph is No Travel; over 40,000 lb, 35 mph is Severe too.
const mediumWind: Thresholds = { unit: 'mph', bounds: [25, 35, 45, 45], no_travel_inclusive: true }
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
  // Each factor, its bands and the physical value of one heatmap byte.
  const FACTORS = [
    ['wind up to 30,000 lb', 'wind', wind, 0.5],
    ['wind over 30,000 lb', 'wind', mediumWind, 0.5],
    ['wind over 40,000 lb', 'wind', heavyWind, 0.5],
    ['rain', 'rain', rain, 0.01],
    ['snow', 'snow', snow, 0.02],
  ] as const
  /** The narrowest blend, where the value doesn't change across a pixel. */
  const FLAT = 2e-5

  it('moves inclusive bounds down and an exclusive one up by half a shown digit', () => {
    const rounded = (bounds: number[]) => bounds.map((bound) => Number(bound.toFixed(9)))
    expect(rounded(shaderBounds(heavyWind, 'wind'))).toEqual([24.95, 34.95, 34.95, 44.95])
    expect(rounded(shaderBounds(rain, 'rain'))).toEqual([0.095, 0.245, 0.495, 1.005])
    expect(rounded(shaderBounds(snow, 'snow'))).toEqual([0.495, 0.995, 1.995, 3.005])
  })

  it.each(FACTORS)('draws every %s byte in its band', (_, factor, thresholds, step) => {
    // Bytes sit at least half a shown digit inside their band. That is all the
    // room rain has: its step is its digit, so 0.09 and 0.10 in/hr sit 0.005
    // either side of 0.095. Any blend narrower than that leaves them alone.
    for (const width of [FLAT, 0.99 * halfDigit(factor)]) {
      for (let byte = 0; byte <= 255; byte++) {
        const level = gpuLevel(gpuValue(byte, step), factor, thresholds, width)
        expect(RISK_LEVELS[level], `byte ${String(byte)}, blend ${String(width)}`).toBe(
          levelFor(byte * step, thresholds),
        )
      }
    }
  })

  it.each(FACTORS)(
    'keeps a %s threshold byte in its band at any slope',
    (_, factor, thresholds, step) => {
      // A steeper field blends each band edge over more of the value range, but
      // only on the side the bound doesn't belong to, so the byte on it stays put.
      for (const bound of thresholds.bounds) {
        const byte = Math.round(bound / step)
        for (const width of [FLAT, step / 2, step, 4 * step]) {
          const level = gpuLevel(gpuValue(byte, step), factor, thresholds, width)
          expect(Math.floor(level), `byte ${String(byte)}, blend ${String(width)}`).toBe(
            RISK_LEVELS.indexOf(levelFor(byte * step, thresholds)),
          )
        }
      }
    },
  )

  it.each(FACTORS)(
    'puts %s band edges where the rounded hover readout does',
    (_, factor, thresholds, step) => {
      // Values between bytes, as the shader interpolates them, every 1/200 of a
      // step, against the readout: rounded to the digit shown, then classified.
      // Values right on a moved bound are skipped: a hair of float error there
      // tips either one (24.95 is a hair under, so it reads 24.9).
      const edges = shaderBounds(thresholds, factor).map((bound) =>
        Math.round((bound / step) * 200),
      )
      const disagree: number[] = []
      for (let i = 0; i <= 255 * 200; i++) {
        if (edges.includes(i)) continue
        const value = (i / 200) * step
        const level = gpuLevel(Math.fround(value), factor, thresholds, FLAT)
        const readout = levelFor(roundHalfEven(value, DECIMALS[factor]), thresholds)
        if (RISK_LEVELS[level] !== readout) disagree.push(value)
      }
      expect(disagree).toEqual([])
    },
  )
})

/** Half the last digit a reading shows: 0.05 mph, 0.005 in/hr. */
function halfDigit(factor: Factor): number {
  return 10 ** -DECIMALS[factor] / 2
}

/** A byte as the shader reads it: a float32 texel (byte / 255), × 255, × the step. */
function gpuValue(byte: number, step: number): number {
  const f = Math.fround
  return f(f(f(byte / 255) * 255) * f(step))
}

/**
 * The shader's `bandLevel` with a blend `width` wide: each crossing blends in
 * below an inclusive bound and above an exclusive one.
 */
function gpuLevel(value: number, factor: Factor, thresholds: Thresholds, width: number): number {
  return shaderBounds(thresholds, factor).reduce((level, bound, i) => {
    const below = i < 3 || thresholds.no_travel_inclusive
    const start = Math.fround(bound) - (below ? width : 0)
    return level + smoothstep(start, start + width, value)
  }, 0)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}
