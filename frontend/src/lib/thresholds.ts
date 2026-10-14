import type { Factor, Thresholds } from '../api/types'
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
 * Bounds for GPU classification, which can only test `value >= bound`. An
 * exclusive No Travel bound moves up by half a quantisation step, so byte
 * values classify exactly as the server does.
 */
export function shaderBounds(
  thresholds: Thresholds,
  step: number,
): [number, number, number, number] {
  const [moderate, high, severe, noTravel] = thresholds.bounds
  return [moderate, high, severe, thresholds.no_travel_inclusive ? noTravel : noTravel + step / 2]
}
