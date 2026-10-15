import type { LngLatBoundsLike } from 'maplibre-gl'
import { useEffect, useRef } from 'react'

import type { Route, TripRequest } from '../../api/types'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import { useUiStore } from '../../state/uiStore'
import { routesBounds } from './geojson'
import { useMap } from './mapContext'
import type { Insets } from './MapStatus'

/** The opening view, and where the camera returns when the trip is cleared. */
export const HOME_BOUNDS: [[number, number], [number, number]] = [
  [-124.8, 24.4],
  [-66.9, 49.4],
]

/** Strong ease-out: the camera moves quickly, then settles. */
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4

interface CameraControllerProps {
  routes: Route[] | undefined
  /** Framed by its two ends while its routes are being planned. */
  trip: TripRequest | null
  /** Screen space covered by floating UI, so routes are framed in the visible area. */
  insets: Insets
}

export function CameraController({ routes, trip, insets }: CameraControllerProps) {
  const map = useMap()
  const reducedMotion = usePrefersReducedMotion()
  // Read at framing time only: re-framing on every layout change would fight the user.
  const latest = useRef({ insets, trip })
  useEffect(() => {
    latest.current = { insets, trip }
  })
  // Whether the camera has left the opening view for a trip.
  const away = useRef(false)

  // Frame the routes when a new set arrives. Before they do, frame the trip's
  // two ends; once the trip is cleared, go back to the whole country.
  const ends = trip && endpointsKey(trip)
  useEffect(() => {
    const { insets: inset, trip: current } = latest.current
    let bounds: LngLatBoundsLike
    if (routes) bounds = routesBounds(routes)
    else if (current) bounds = endpointsBounds(current)
    else if (away.current) bounds = HOME_BOUNDS
    else return
    away.current = bounds !== HOME_BOUNDS
    map.fitBounds(bounds, {
      padding: {
        top: inset.top + 48,
        right: inset.right + 48,
        bottom: inset.bottom + 48,
        left: inset.left + 48,
      },
      duration: reducedMotion ? 0 : 1100,
      easing: easeOutQuart,
      maxZoom: 9,
    })
  }, [map, routes, ends, reducedMotion])

  // Fly to a checkpoint the user picked from the list.
  useEffect(() => {
    if (!routes) return
    return useUiStore.subscribe((state, previous) => {
      const target = state.focusedCheckpoint
      if (!target || target === previous.focusedCheckpoint) return
      const checkpoint = routes.find((route) => route.id === target.routeId)?.checkpoints[
        target.index
      ]
      if (!checkpoint) return
      map.easeTo({
        center: [checkpoint.lon, checkpoint.lat],
        zoom: Math.max(map.getZoom(), 7),
        padding: latest.current.insets,
        duration: reducedMotion ? 0 : 650,
        easing: easeOutQuart,
      })
    })
  }, [map, routes, reducedMotion])

  return null
}

/** Changes only when the trip's ends move, not when its departure or load does. */
function endpointsKey(trip: TripRequest): string {
  const { origin, destination } = trip
  return `${origin.lat},${origin.lon};${destination.lat},${destination.lon}`
}

function endpointsBounds({ origin, destination }: TripRequest): LngLatBoundsLike {
  return [
    [Math.min(origin.lon, destination.lon), Math.min(origin.lat, destination.lat)],
    [Math.max(origin.lon, destination.lon), Math.max(origin.lat, destination.lat)],
  ]
}
