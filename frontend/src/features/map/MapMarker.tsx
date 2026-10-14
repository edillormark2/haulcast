import { Marker, type PositionAnchor } from 'maplibre-gl'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useMap } from './mapContext'

interface MapMarkerProps {
  lngLat: [number, number]
  anchor?: PositionAnchor
  offset?: [number, number]
  /** Stacking order among markers (MapLibre positions the element itself). */
  zIndex?: number
  children: ReactNode
}

/** Renders React children into a MapLibre marker that tracks a coordinate. */
export function MapMarker({ lngLat, anchor = 'center', offset, zIndex, children }: MapMarkerProps) {
  const map = useMap()
  // MapLibre needs a position before the marker joins the map.
  const [marker] = useState(() =>
    new Marker({ element: document.createElement('div'), anchor, offset }).setLngLat(lngLat),
  )

  useEffect(() => {
    marker.getElement().style.zIndex = zIndex === undefined ? '' : String(zIndex)
  }, [marker, zIndex])

  useEffect(() => {
    marker.addTo(map)
    return () => {
      marker.remove()
    }
  }, [map, marker])

  useEffect(() => {
    marker.setLngLat(lngLat)
  }, [marker, lngLat])

  return createPortal(children, marker.getElement())
}
