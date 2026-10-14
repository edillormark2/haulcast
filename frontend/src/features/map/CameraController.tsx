import { useEffect, useRef } from 'react'

import type { Route } from '../../api/types'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import { useUiStore } from '../../state/uiStore'
import { routesBounds } from './geojson'
import { useMap } from './mapContext'

/** Strong ease-out: the camera moves quickly, then settles. */
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

interface CameraControllerProps {
  routes: Route[]
  /** Screen space covered by floating UI, so routes are framed in the visible area. */
  insets: Insets
}

export function CameraController({ routes, insets }: CameraControllerProps) {
  const map = useMap()
  const reducedMotion = usePrefersReducedMotion()
  // Read at framing time only: re-framing on every layout change would fight the user.
  const insetsRef = useRef(insets)
  useEffect(() => {
    insetsRef.current = insets
  })

  // Frame all routes whenever a new set arrives.
  useEffect(() => {
    if (routes.length === 0) return
    const { top, right, bottom, left } = insetsRef.current
    map.fitBounds(routesBounds(routes), {
      padding: { top: top + 48, right: right + 48, bottom: bottom + 48, left: left + 48 },
      duration: reducedMotion ? 0 : 1100,
      easing: easeOutQuart,
      maxZoom: 9,
    })
  }, [map, routes, reducedMotion])

  // Fly to a checkpoint the user picked from the list.
  useEffect(() => {
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
        padding: insetsRef.current,
        duration: reducedMotion ? 0 : 650,
        easing: easeOutQuart,
      })
    })
  }, [map, routes, reducedMotion])

  return null
}
