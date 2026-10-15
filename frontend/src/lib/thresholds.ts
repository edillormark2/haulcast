import type { Factor, Thresholds } from '../api/types'
import { DECIMALS } from './forecast'
import { RISK_LEVELS, type RiskLevel } from './risk'

const FACTORS: readonly Factor[] = ['wind', 'rain', 'snow']

/** Risk level of one reading against its factor's bands. */
export function levelFor(value: number, thresholds: Thresholds): RiskLevel {
  const [moderate, high, severe, noTravel] = thresholds.bounds
  const index = (thresholds.no_travel_inclusive ? value >= noTravel : value > noTravel)
    ? 4
    : value >= severe
      ? 3
      : value >= high
        ? 2
        : value >= moderate
          ? 1
          : 0
  return RISK_LEVELS[index]
}

/** The worst level across wind, rain and snow. */
export function overallLevel(
  values: Record<Factor, number>,
  thresholds: Record<Factor, Thresholds>,
): RiskLevel {
  let worst = 0
  for (const factor of FACTORS) {
    worst = Math.max(worst, RISK_LEVELS.indexOf(levelFor(values[factor], thresholds[factor])))
  }
  return RISK_LEVELS[worst] ?? 'low'
}

/**
 * Bounds for GPU classification. The shader antialiases each band edge on the
 * side of the bound that the bound doesn't belong to: below an inclusive
 * bound, above an exclusive one. Each bound also moves that way by half the
 * last digit a reading shows (0.05 mph, 0.005 in/hr), where rounding carries
 * a value onto it or past it: 44.95 mph reads 45.0, 1.006 in/hr reads 1.01.
 * So the shader draws each value in the band the hover readout gives it,
 * rounded. Every byte sits at least half a digit inside its band, so one on a
 * threshold is drawn wholly in that band at any slope.
 */
export function shaderBounds(
  thresholds: Thresholds,
  factor: Factor,
): [number, number, number, number] {
  const [moderate, high, severe, noTravel] = thresholds.bounds
  const halfDigit = 10 ** -DECIMALS[factor] / 2
  return [
    moderate - halfDigit,
    high - halfDigit,
    severe - halfDigit,
    thresholds.no_travel_inclusive ? noTravel - halfDigit : noTravel + halfDigit,
  ]
}
