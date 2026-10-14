import type { Map } from 'maplibre-gl'
import { createContext, use } from 'react'

export const MapContext = createContext<Map | null>(null)

/** The map instance. Only available to children rendered by MapView. */
export function useMap(): Map {
  const map = use(MapContext)
  if (!map) throw new Error('useMap must be used inside <MapView>')
  return map
}
