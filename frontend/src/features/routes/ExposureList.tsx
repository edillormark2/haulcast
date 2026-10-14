import type { Route } from '../../api/types'
import { formatMiles } from '../../lib/format'
import { RISK, RISK_LEVELS } from '../../lib/risk'

/** Miles per risk level, worst first, skipping levels the route never meets. */
export function ExposureList({ route }: { route: Route }) {
  const levels = [...RISK_LEVELS].reverse().filter((level) => route.exposure.miles[level] >= 0.05)
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted tabular-nums">
      {levels.map((level) => (
        <li key={level} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={level === 'no_travel' ? 'barricade size-2 rounded-xs' : 'size-2 rounded-xs'}
            style={level === 'no_travel' ? undefined : { backgroundColor: RISK[level].color }}
          />
          <span className={level === 'low' ? '' : 'font-semibold text-fg'}>
            {formatMiles(route.exposure.miles[level])}
          </span>
          <span>{RISK[level].label.toLowerCase()}</span>
        </li>
      ))}
    </ul>
  )
}
