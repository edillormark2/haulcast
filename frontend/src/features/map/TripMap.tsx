import type { Plan, TripRequest } from '../../api/types'
import type { HeatmapData } from '../../lib/heatmap'
import { useUiStore } from '../../state/uiStore'
import { CameraController } from './CameraController'
import { HeatmapController } from './HeatmapController'
import { RouteLayers } from './layers/RouteLayers'
import { MapInteractions } from './MapInteractions'
import type { Insets } from './MapStatus'
import { MapView } from './MapView'
import { RouteLabels } from './RouteLabels'
import { TripEndpoints } from './TripEndpoints'
import { TruckMarker } from './TruckMarker'

interface TripMapProps {
  trip: TripRequest | null
  plan: Plan | undefined
  heatmap: HeatmapData | undefined
  /** What the app is waiting for, shown over the map. */
  status: string | null
  /** Space under the panel and forecast bar, for framing routes. */
  insets: Insets
  /** The same with the phone sheet at its current height, for status pills. */
  overlayInsets: Insets
}

/**
 * The map and everything drawn on it. The app loads this lazily: MapLibre is
 * most of its code, and the panel shouldn't wait for it.
 */
export default function TripMap({
  trip,
  plan,
  heatmap,
  status,
  insets,
  overlayInsets,
}: TripMapProps) {
  const selectedRouteId = useUiStore((state) => state.selectedRouteId)
  const departureMs = plan ? Date.parse(plan.trip.departure) : 0
  const selectedRoute = plan?.routes.find((route) => route.id === selectedRouteId)

  return (
    <MapView insets={overlayInsets} status={status}>
      {trip && !plan && <TripEndpoints trip={trip} />}
      {plan && (
        <>
          <RouteLayers routes={plan.routes} />
          <HeatmapController data={heatmap} />
          {selectedRoute && <TruckMarker route={selectedRoute} departureMs={departureMs} />}
          <RouteLabels routes={plan.routes} />
          <MapInteractions
            routes={plan.routes}
            heatmap={heatmap}
            thresholds={plan.thresholds}
            departureMs={departureMs}
          />
        </>
      )}
      <CameraController routes={plan?.routes} trip={trip} insets={insets} />
    </MapView>
  )
}
