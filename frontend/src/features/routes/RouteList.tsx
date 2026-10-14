import { CaretRightIcon } from '@phosphor-icons/react'

import type { Plan, Route } from '../../api/types'
import { cx } from '../../lib/cx'
import { formatClock, formatDuration, formatMiles } from '../../lib/format'
import { useUiStore } from '../../state/uiStore'
import { ExposureList } from './ExposureList'
import { RouteStrip } from './RouteStrip'

/** All options, best first. Selecting a row highlights the route on the map. */
export function RouteList({ plan, departureMs }: { plan: Plan; departureMs: number }) {
  // Rows remount (and replay their entrance) only when a new plan arrives.
  const planKey = `${plan.trip.departure}|${plan.trip.origin.label}|${plan.trip.destination.label}|${plan.trip.interval_mi}`
  const selectedRouteId = useUiStore((state) => state.selectedRouteId)
  const ranked = plan.recommendation.ranking
    .map((id) => plan.routes.find((route) => route.id === id))
    .filter((route): route is Route => route !== undefined)
  const scaleMi = Math.max(...plan.routes.map((route) => route.distance_mi))
  const verdicts = new Map(plan.recommendation.comparisons.map((c) => [c.route_id, c.verdict]))

  return (
    <section aria-label="Route options">
      <h3 className="mb-2 text-xs font-semibold text-fg-muted">
        {ranked.length} route options, safest first
      </h3>
      <ol className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
        {ranked.map((route, index) => (
          <RouteRow
            key={`${planKey}:${route.id}`}
            route={route}
            selected={route.id === selectedRouteId}
            verdict={verdicts.get(route.id)}
            scaleMi={scaleMi}
            departureMs={departureMs}
            order={index}
          />
        ))}
      </ol>
      <p className="mt-2 text-2xs text-fg-subtle">
        Planned with {plan.routes[0]?.router ?? 'the routing service'}. Times assume continuous
        driving.
      </p>
    </section>
  )
}

interface RouteRowProps {
  route: Route
  selected: boolean
  verdict: string | undefined
  scaleMi: number
  departureMs: number
  order: number
}

function RouteRow({ route, selected, verdict, scaleMi, departureMs, order }: RouteRowProps) {
  const selectRoute = useUiStore((state) => state.selectRoute)
  const hoverRoute = useUiStore((state) => state.hoverRoute)
  const setPanelTab = useUiStore((state) => state.setPanelTab)

  return (
    <li
      className="relative animate-[route-in_260ms_var(--ease-out)_both]"
      style={{ animationDelay: `${order * 45}ms` }}
      onPointerEnter={() => hoverRoute(route.id)}
      onPointerLeave={() => hoverRoute(null)}
    >
      <span
        aria-hidden
        className={cx(
          'absolute inset-y-0 left-0 w-[3px] origin-center bg-ink transition-[scale,opacity] duration-200 ease-out',
          selected ? 'scale-y-100 opacity-100' : 'scale-y-50 opacity-0',
        )}
      />
      <button
        type="button"
        onClick={() => selectRoute(route.id)}
        aria-pressed={selected}
        className={cx(
          'block w-full px-4 pt-3 pb-3.5 text-left transition-colors duration-150',
          selected ? 'bg-surface-2' : 'hover:bg-surface-2/60',
        )}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className={cx(
                'grid size-5 shrink-0 translate-y-0.5 place-items-center rounded-full text-[11px] font-bold',
                selected ? 'bg-ink text-white' : 'bg-surface-2 text-fg ring-1 ring-line-strong',
              )}
            >
              {route.id}
            </span>
            <span className="truncate text-sm font-semibold text-fg">{route.via}</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-fg tabular-nums">
            {formatDuration(route.duration_s)}
          </span>
        </span>
        <span className="mt-0.5 ml-7 block text-xs text-fg-muted tabular-nums">
          {formatMiles(route.distance_mi)}, arrives {formatClock(Date.parse(route.arrival))}
        </span>
        <span className="mt-2.5 ml-7 block">
          <RouteStrip
            route={route}
            scaleMi={scaleMi}
            departureMs={departureMs}
            showTruck={selected}
          />
        </span>
        <span className="mt-2 ml-7 block">
          <ExposureList route={route} />
        </span>
        {verdict && (
          <span className="mt-1.5 ml-7 block text-xs text-fg-muted">
            <span className="font-semibold text-fg">Not chosen:</span> {verdict}
          </span>
        )}
      </button>
      {selected && (
        <button
          type="button"
          onClick={() => setPanelTab('checkpoints')}
          className="flex w-full items-center justify-between border-t border-line bg-surface-2 px-4 py-2 pl-11 text-xs font-semibold text-teal transition-colors hover:text-ink"
        >
          See all {route.checkpoints.length} checkpoints
          <CaretRightIcon size={13} weight="bold" aria-hidden />
        </button>
      )}
    </li>
  )
}
