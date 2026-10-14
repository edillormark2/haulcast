import { useEffect, useRef, useState } from 'react'

import type { Checkpoint, Plan } from '../../api/types'
import { cx } from '../../lib/cx'
import { formatClock, formatDuration } from '../../lib/format'
import { riskAtLeast } from '../../lib/risk'
import { sameCheckpoint, useUiStore } from '../../state/uiStore'
import { RiskBadge } from '../../ui/RiskBadge'
import { Segmented } from '../../ui/Segmented'
import { WeatherReadout } from '../../ui/WeatherReadout'

/** Every checkpoint on the selected route: where, when, what weather, which risk. */
export function CheckpointList({ plan, departureMs }: { plan: Plan; departureMs: number }) {
  const selectedRouteId = useUiStore((state) => state.selectedRouteId)
  const selectRoute = useUiStore((state) => state.selectRoute)
  const focused = useUiStore((state) => state.focusedCheckpoint)
  const [riskyOnly, setRiskyOnly] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)

  const route = plan.routes.find((r) => r.id === selectedRouteId) ?? plan.routes[0]

  // Bring a checkpoint picked on the map into view.
  useEffect(() => {
    if (!focused || focused.routeId !== route?.id) return
    listRef.current
      ?.querySelector(`[data-index="${focused.index}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused, route?.id])

  if (!route) return null
  const visible = riskyOnly
    ? route.checkpoints.filter((checkpoint) => riskAtLeast(checkpoint.risk, 'moderate'))
    : route.checkpoints

  return (
    <section aria-label={`Checkpoints on ${route.name}`} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Segmented
          legend="Route"
          size="sm"
          value={route.id}
          options={plan.routes.map((r) => ({ value: r.id, label: `Route ${r.id}` }))}
          onChange={selectRoute}
          className="flex-1"
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-fg-muted select-none">
          <input
            type="checkbox"
            checked={riskyOnly}
            onChange={(event) => setRiskyOnly(event.target.checked)}
            className="size-3.5 accent-ink"
          />
          Moderate and up
        </label>
      </div>

      <p className="text-xs text-fg-muted">
        {route.checkpoints.length} checkpoints every {plan.trip.interval_mi} mi, weather read at the
        truck&apos;s arrival time.
      </p>

      {visible.length === 0 ? (
        <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-fg-muted ring-1 ring-line">
          No checkpoint on {route.name} reaches Moderate risk.
        </p>
      ) : (
        <ol
          ref={listRef}
          className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line"
        >
          {visible.map((checkpoint) => (
            <CheckpointRow
              key={checkpoint.index}
              routeId={route.id}
              checkpoint={checkpoint}
              departureMs={departureMs}
              focused={sameCheckpoint(focused, { routeId: route.id, index: checkpoint.index })}
              last={checkpoint.index === route.checkpoints.length - 1}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

interface CheckpointRowProps {
  routeId: string
  checkpoint: Checkpoint
  departureMs: number
  focused: boolean
  last: boolean
}

function CheckpointRow({ routeId, checkpoint, departureMs, focused, last }: CheckpointRowProps) {
  const focusCheckpoint = useUiStore((state) => state.focusCheckpoint)
  const hoverCheckpoint = useUiStore((state) => state.hoverCheckpoint)
  const ref = { routeId, index: checkpoint.index }
  const eta = Date.parse(checkpoint.eta)

  return (
    <li data-index={checkpoint.index}>
      <button
        type="button"
        onClick={() => focusCheckpoint(ref)}
        onPointerEnter={() => hoverCheckpoint(ref)}
        onPointerLeave={() => hoverCheckpoint(null)}
        aria-current={focused || undefined}
        className={cx(
          'grid w-full grid-cols-[3.5rem_1fr_auto] items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors duration-150',
          focused ? 'bg-aqua/35' : 'hover:bg-surface-2',
        )}
      >
        <span className="text-xs font-semibold text-fg tabular-nums">
          {checkpoint.index === 0 ? 'Start' : last ? 'End' : `mi ${Math.round(checkpoint.mile)}`}
        </span>
        <span className="text-xs text-fg tabular-nums">
          {formatClock(eta)}
          <span className="ml-1.5 text-fg-subtle">
            +{formatDuration((eta - departureMs) / 1000)}
          </span>
        </span>
        <span className="justify-self-end">
          <RiskBadge level={checkpoint.risk} size="sm" />
        </span>
        <span className="col-span-2 col-start-2">
          <WeatherReadout
            windMph={checkpoint.weather.wind_mph}
            rainInHr={checkpoint.weather.rain_in_hr}
            snowInHr={checkpoint.weather.snow_in_hr}
            drivers={checkpoint.drivers}
            level={checkpoint.risk}
            compact
          />
          {checkpoint.load_rule && (
            <span className="mt-1 block text-2xs text-fg-muted">
              Load rule: {checkpoint.load_rule}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
