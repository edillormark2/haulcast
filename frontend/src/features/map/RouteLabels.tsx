import { CheckCircleIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'

import type { Route } from '../../api/types'
import { formatDuration } from '../../lib/format'
import { labelAnchor } from '../../lib/geo'
import { useUiStore } from '../../state/uiStore'
import { MapMarker } from './MapMarker'

/** A clickable summary pill on each route: letter, travel time, recommendation. */
export function RouteLabels({ routes }: { routes: Route[] }) {
  const anchors = useMemo(
    () =>
      routes.map((route) =>
        labelAnchor(
          route,
          routes.filter((other) => other !== route),
        ),
      ),
    [routes],
  )
  const selectedRouteId = useUiStore((state) => state.selectedRouteId)
  const selectRoute = useUiStore((state) => state.selectRoute)
  const hoverRoute = useUiStore((state) => state.hoverRoute)

  return routes.map((route, i) => {
    const selected = route.id === selectedRouteId
    return (
      <MapMarker key={route.id} lngLat={anchors[i] ?? [0, 0]} zIndex={selected ? 2 : 1}>
        <button
          type="button"
          onClick={() => selectRoute(route.id)}
          onPointerEnter={() => hoverRoute(route.id)}
          onPointerLeave={() => hoverRoute(null)}
          aria-pressed={selected}
          aria-label={`${route.name}, ${formatDuration(route.duration_s)}${route.recommended ? ', recommended' : ''}`}
          className={[
            'flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-xs font-semibold tabular-nums shadow-float',
            'transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.96]',
            selected ? 'bg-ink text-white' : 'bg-surface text-fg hover:bg-white',
          ].join(' ')}
        >
          <span
            className={[
              'grid size-5 place-items-center rounded-full text-[11px] font-bold',
              selected ? 'bg-white text-ink' : 'bg-ink text-white',
            ].join(' ')}
          >
            {route.id}
          </span>
          {formatDuration(route.duration_s)}
          {route.recommended && (
            <CheckCircleIcon
              size={15}
              weight="fill"
              className={selected ? 'text-aqua' : 'text-teal'}
              aria-hidden
            />
          )}
        </button>
      </MapMarker>
    )
  })
}
