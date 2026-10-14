import { TruckIcon } from '@phosphor-icons/react'
import { Marker } from 'maplibre-gl'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import type { Route } from '../../api/types'
import { mileAtTime, pointAtMile } from '../../lib/geo'
import { HOUR_MS } from '../../lib/time'
import { useUiStore } from '../../state/uiStore'
import { useMap } from './mapContext'

/**
 * Where the truck on the selected route is at the forecast slider's hour.
 * Position updates go straight to the marker, outside React rendering.
 */
export function TruckMarker({ route, departureMs }: { route: Route; departureMs: number }) {
  const map = useMap()
  const [element] = useState(() => document.createElement('div'))
  const [marker] = useState(() => new Marker({ element, anchor: 'center' }))

  useEffect(() => {
    const place = (hour: number) =>
      marker.setLngLat(pointAtMile(route, mileAtTime(route, departureMs + hour * HOUR_MS)))
    place(useUiStore.getState().displayHour)
    marker.addTo(map)
    const unsubscribe = useUiStore.subscribe((state, previous) => {
      if (state.displayHour !== previous.displayHour) place(state.displayHour)
    })
    return () => {
      unsubscribe()
      marker.remove()
    }
  }, [map, marker, route, departureMs])

  return createPortal(
    <div
      className="grid size-8 place-items-center rounded-full bg-ink text-white shadow-float ring-4 ring-white/80"
      role="img"
      aria-label={`Truck on ${route.name} at the selected forecast hour`}
    >
      <TruckIcon size={17} weight="fill" />
    </div>,
    element,
  )
}
