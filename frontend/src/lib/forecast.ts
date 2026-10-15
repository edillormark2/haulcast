import type { Factor } from '../api/types'
import { HOUR_MS } from './time'

const HOUR_S = HOUR_MS / 1000

/**
 * Decimals a reading is shown to: 0.1 mph, 0.01 in/hr. Readings are rounded to
 * them before they're classified, here and on the server, so a value on screen
 * always matches its band.
 */
export const DECIMALS: Record<Factor, number> = { wind: 1, rain: 2, snow: 2 }

/**
 * Hourly forecast for one place, as the server reads it
 * (backend/planner/domain/forecast.py). Value `i` belongs to the top of the
 * hour `start + i` hours.
 */
export interface HourlySeries {
  /** UTC unix seconds of the first value. */
  start: number
  /** Instantaneous at each hour. */
  windMph: number[]
  /** Rain plus showers over the hour ending at each value's time. */
  rainIn: number[]
  /** Snowfall over the hour ending at each value's time. */
  snowIn: number[]
}

/** Wind (mph), rain and snow (in/hr) at a moment. */
export interface Conditions {
  wind: number
  rain: number
  snow: number
}

/**
 * Weather at `timestampS`, read exactly as the server reads it: wind blended
 * linearly between the surrounding hours, rain and snow from the hour being
 * driven through, each rounded to what the UI shows (0.1 mph, 0.01 in/hr).
 */
export function conditionsAt(series: HourlySeries, timestampS: number): Conditions {
  const offsetH = (timestampS - series.start) / HOUR_S
  const hour = Math.floor(offsetH)
  const windBefore = series.windMph[hour]
  const windAfter = series.windMph[hour + 1]
  const rain = series.rainIn[hour + 1]
  const snow = series.snowIn[hour + 1]
  if (
    windBefore === undefined ||
    windAfter === undefined ||
    rain === undefined ||
    snow === undefined
  ) {
    throw new RangeError(`No forecast for ${new Date(timestampS * 1000).toISOString()}`)
  }
  const fraction = offsetH - hour
  return roundReadings({ wind: windBefore + (windAfter - windBefore) * fraction, rain, snow })
}

/**
 * Readings rounded to the decimals the UI shows, halves to even, as the
 * server's `Conditions.measured` rounds them.
 */
export function roundReadings({ wind, rain, snow }: Conditions): Conditions {
  return {
    wind: roundHalfEven(wind, DECIMALS.wind),
    rain: roundHalfEven(rain, DECIMALS.rain),
    snow: roundHalfEven(snow, DECIMALS.snow),
  }
}

/**
 * Python's `round(x, digits)`: x's exact binary value rounded to `digits`
 * decimals, halves to even. The server rounds readings with it before packing
 * the heatmap, and `Math.round` and `toFixed` both round halves up: 0.125 in/hr
 * of rain is 0.12 in Python and 0.13 with `toFixed`, a byte apart.
 */
export function roundHalfEven(x: number, digits = 0): number {
  const scale = 10 ** digits
  const scaled = Math.abs(x) * scale
  const whole = Math.floor(scaled)
  const fraction = scaled - whole
  // Scaling can blur a value within a hair of a half, so those are decided
  // from the exact decimal digits. Without scaling, the fraction is exact.
  const rounded =
    digits === 0 || Math.abs(fraction - 0.5) > 1e-9
      ? fraction > 0.5 || (fraction === 0.5 && whole % 2 === 1)
        ? whole + 1
        : whole
      : roundExactly(Math.abs(x), digits)
  return Math.sign(x) * (rounded / scale)
}

/** `x` (≥ 0) times 10^digits, rounded half to even from its exact value. */
function roundExactly(x: number, digits: number): number {
  // Every double the heatmap rounds (above 1e-15) prints exactly in 100 decimals.
  const exact = x.toFixed(100)
  const point = exact.indexOf('.')
  const kept = Number(exact.slice(0, point) + exact.slice(point + 1, point + 1 + digits))
  const rest = exact.slice(point + 1 + digits)
  const half = '5'.padEnd(rest.length, '0')
  return rest > half || (rest === half && kept % 2 === 1) ? kept + 1 : kept
}
