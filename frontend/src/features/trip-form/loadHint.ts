import type { RiskRules } from '../../api/types'
import { formatPounds } from '../../lib/format'
import { RISK } from '../../lib/risk'

/** Which load rules apply at this weight, in one sentence. */
export function loadHint(loadLb: number, rules: RiskRules['load_rules'] | undefined): string {
  if (!rules) return ''
  const loadRules = rules.filter((rule) => rule.heavier_than_lb !== null)
  const applying = loadRules
    .filter((rule) => loadLb > (rule.heavier_than_lb ?? Infinity))
    .sort((a, b) => a.min_wind_mph - b.min_wind_mph)
  if (applying.length === 0) {
    const lightest = Math.min(...loadRules.map((rule) => rule.heavier_than_lb ?? Infinity))
    return `At ${formatPounds(lightest)} or less, wind risk follows the standard bands.`
  }
  const clauses = applying.map(
    (rule) =>
      `${rule.min_wind_mph}–${(rule.max_wind_mph ?? rule.min_wind_mph) - 1} mph wind counts as ${RISK[rule.level].label}`,
  )
  const heaviest = Math.max(...applying.map((rule) => rule.heavier_than_lb ?? 0))
  return `Over ${formatPounds(heaviest)}: ${clauses.join(', and ')}.`
}
