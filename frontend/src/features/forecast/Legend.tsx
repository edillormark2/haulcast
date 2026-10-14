import type { Factor, HeatmapMetric, Thresholds } from '../../api/types'
import { cx } from '../../lib/cx'
import { RISK, RISK_LEVELS, type RiskLevel } from '../../lib/risk'

interface LegendProps {
  metric: HeatmapMetric
  thresholds: Record<Factor, Thresholds>
}

/**
 * Colour key for the heatmap. For a single factor it lists where each band
 * starts for this load, skipping bands the load rules collapse.
 */
export function Legend({ metric, thresholds }: LegendProps) {
  const entries =
    metric === 'risk'
      ? RISK_LEVELS.map((level) => ({ level, text: RISK[level].label }))
      : factorEntries(thresholds[metric])
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
      {entries.map(({ level, text }) => (
        <li key={level} className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
          <Swatch level={level} />
          {text}
        </li>
      ))}
    </ul>
  )
}

function Swatch({ level }: { level: RiskLevel }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block h-2.5 w-3.5 rounded-xs ring-1 ring-ink/10',
        level === 'no_travel' && 'barricade',
      )}
      style={level === 'no_travel' ? undefined : { backgroundColor: RISK[level].color }}
    />
  )
}

function factorEntries(thresholds: Thresholds): { level: RiskLevel; text: string }[] {
  const [moderate, high, severe, noTravel] = thresholds.bounds
  const starts: [RiskLevel, number][] = [
    ['moderate', moderate],
    ['high', high],
    ['severe', severe],
    ['no_travel', noTravel],
  ]
  const unit = thresholds.unit
  const entries: { level: RiskLevel; text: string }[] = [
    { level: 'low', text: `Below ${format(moderate)} ${unit}` },
  ]
  starts.forEach(([level, start], i) => {
    const next = starts[i + 1]?.[1]
    if (next !== undefined && next <= start) return // band emptied by a load rule
    const exclusive = level === 'no_travel' && !thresholds.no_travel_inclusive
    entries.push({
      level,
      text: `${RISK[level].label} ${exclusive ? 'above' : 'from'} ${format(start)}`,
    })
  })
  return entries
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '')
}
