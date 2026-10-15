import type { Factor, Thresholds } from '../api/types'
import { RISK_LEVELS, type RiskLevel } from './risk'

const FACTORS: readonly Factor[] = ['wind', 'rain', 'snow']
/**
 * How far `shaderBounds` moves each bound, as a share of a quantisation step.
 * Float32 puts the shader's byte values up to about 0.00002 of a step off
 * (0.10 in/hr of rain comes out just under 0.10), and no pixel shows 0.01.
 */
const SHADER_ALLOWANCE = 0.01

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
 * bound, above an exclusive one. So a value on a bound is drawn wholly in the
 * band `levelFor` gives it, and band edges are where the hover readout puts
 * them. Each bound also moves 1% of a quantisation step that way, which
 * absorbs float32 error in the shader's byte values.
 */
export function shaderBounds(
  thresholds: Thresholds,
  step: number,
): [number, number, number, number] {
  const [moderate, high, severe, noTravel] = thresholds.bounds
  const allowance = step * SHADER_ALLOWANCE
  return [
    moderate - allowance,
    high - allowance,
    severe - allowance,
    thresholds.no_travel_inclusive ? noTravel - allowance : noTravel + allowance,
  ]
}
