import { useEffect, useRef } from 'react'

import type { Route } from '../../api/types'
import { formatClock, formatMiles } from '../../lib/format'
import { mileAtTime } from '../../lib/geo'
import { RISK } from '../../lib/risk'
import { HOUR_MS } from '../../lib/time'
import { useUiStore } from '../../state/uiStore'

interface RouteStripProps {
  route: Route
  /** Length of the longest option, so strips share one mile scale. */
  scaleMi: number
  departureMs: number
  showTruck: boolean
}

/**
 * The route unrolled into a bar: each stretch coloured by the risk the truck
 * meets there. Hovering a stretch highlights its checkpoint on the map.
 */
export function RouteStrip({ route, scaleMi, departureMs, showTruck }: RouteStripProps) {
  const hoverCheckpoint = useUiStore((state) => state.hoverCheckpoint)
  const truckRef = useRef<HTMLSpanElement>(null)

  // Follow the forecast slider without re-rendering.
  useEffect(() => {
    if (!showTruck) return
    const place = (hour: number) => {
      const mile = mileAtTime(route, departureMs + hour * HOUR_MS)
      truckRef.current?.style.setProperty('left', `${(mile / route.distance_mi) * 100}%`)
    }
    place(useUiStore.getState().displayHour)
    return useUiStore.subscribe((state, previous) => {
      if (state.displayHour !== previous.displayHour) place(state.displayHour)
    })
  }, [route, departureMs, showTruck])

  const checkpointAt = (mile: number) =>
    route.checkpoints.find((cp) => mile >= cp.stretch[0] && mile <= cp.stretch[1])

  return (
    <span
      className="relative block h-2.5"
      style={{ width: `${(route.distance_mi / scaleMi) * 100}%` }}
    >
      <span
        className="flex h-full overflow-hidden rounded-full ring-1 ring-ink/10"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const mile = ((event.clientX - box.left) / box.width) * route.distance_mi
          const checkpoint = checkpointAt(mile)
          hoverCheckpoint(checkpoint ? { routeId: route.id, index: checkpoint.index } : null)
        }}
        onPointerLeave={() => hoverCheckpoint(null)}
        role="img"
        aria-label={stripSummary(route)}
      >
        {route.sections.map((section) => (
          <span
            key={`${section.from_mi}-${section.level}`}
            className={section.level === 'no_travel' ? 'barricade' : ''}
            style={{
              width: `${((section.to_mi - section.from_mi) / route.distance_mi) * 100}%`,
              backgroundColor: RISK[section.level].color,
            }}
            title={`${RISK[section.level].label}: mile ${Math.round(section.from_mi)}–${Math.round(section.to_mi)}`}
          />
        ))}
      </span>
      {showTruck && (
        <span
          ref={truckRef}
          aria-hidden
          className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-ink shadow-[0_0_0_2px_white]"
        />
      )}
    </span>
  )
}

function stripSummary(route: Route): string {
  const risky = route.sections.filter((section) => section.level !== 'low')
  if (risky.length === 0) return `${route.name}: low risk for all ${formatMiles(route.distance_mi)}`
  const parts = risky.map(
    (section) =>
      `${RISK[section.level].label} from mile ${Math.round(section.from_mi)} to ${Math.round(section.to_mi)}`,
  )
  return `${route.name}, arriving ${formatClock(Date.parse(route.arrival))}: ${parts.join('; ')}`
}
