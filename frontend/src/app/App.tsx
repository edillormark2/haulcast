import { useCallback, useEffect, useMemo } from 'react'

import { useHeatmap, usePlan } from '../api/queries'
import type { Plan, TripRequest } from '../api/types'
import { useForecastClock } from '../features/forecast/useForecastClock'
import { ForecastBar } from '../features/forecast/ForecastBar'
import { CameraController } from '../features/map/CameraController'
import { HeatmapController } from '../features/map/HeatmapController'
import { RouteLayers } from '../features/map/layers/RouteLayers'
import { MapInteractions } from '../features/map/MapInteractions'
import { MapView } from '../features/map/MapView'
import { RouteLabels } from '../features/map/RouteLabels'
import { TruckMarker } from '../features/map/TruckMarker'
import { type PlanQueryState, PlannerPanel } from '../features/planner/PlannerPanel'
import { useMediaQuery, useViewportHeight } from '../lib/useMediaQuery'
import { useTripParams } from '../state/tripParams'
import { useUiStore } from '../state/uiStore'
import { BottomSheet } from '../ui/BottomSheet'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { formatDuration, formatMiles } from '../lib/format'
import { Logo, LogoMark } from '../ui/Logo'

const PANEL_WIDTH = 392
const GUTTER = 12

export function App() {
  const [trip, setTrip] = useTripParams()
  const planQuery = usePlan(trip)
  const plan = planQuery.data
  const heatmapQuery = useHeatmap(plan?.heatmap_request)
  const desktop = useMediaQuery('(min-width: 768px)')
  const resetForNewPlan = useUiStore((state) => state.resetForNewPlan)
  const selectedRouteId = useUiStore((state) => state.selectedRouteId)
  useForecastClock()

  const sheetSnap = useUiStore((state) => state.sheetSnap)
  const setSheetSnap = useUiStore((state) => state.setSheetSnap)
  useEffect(() => {
    if (plan) resetForNewPlan(plan.recommendation.route_id)
  }, [plan, resetForNewPlan])

  const query: PlanQueryState = {
    plan,
    loading: planQuery.isFetching,
    refreshing: planQuery.isFetching && planQuery.isPlaceholderData,
    error: planQuery.error,
    retry: () => void planQuery.refetch(),
  }
  const submit = useCallback((next: TripRequest) => setTrip(next), [setTrip])

  const departureMs = plan ? Date.parse(plan.trip.departure) : 0
  const selectedRoute = plan?.routes.find((route) => route.id === selectedRouteId)
  const viewportHeight = useViewportHeight()
  const snapPoints = useMemo(
    () => [plan ? 176 : 148, Math.round(viewportHeight * 0.52), Math.round(viewportHeight * 0.9)],
    [plan, viewportHeight],
  )
  const insets = desktop
    ? { top: GUTTER, left: PANEL_WIDTH + GUTTER, right: 56, bottom: plan ? 168 : GUTTER }
    : { top: plan ? 132 : GUTTER, left: GUTTER, right: GUTTER, bottom: snapPoints[0] ?? 0 }

  const forecastBar = plan && (
    <ForecastBar
      plan={plan}
      departureMs={departureMs}
      heatmapStatus={heatmapQuery.status}
      onRetry={() => void heatmapQuery.refetch()}
      compact={!desktop}
    />
  )
  const panel = <PlannerPanel trip={trip} query={query} onSubmit={submit} />

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <ErrorBoundary fallback={<MapUnavailable />}>
        <MapView>
          {plan && (
            <>
              <RouteLayers routes={plan.routes} />
              <HeatmapController data={heatmapQuery.data} />
              {selectedRoute && <TruckMarker route={selectedRoute} departureMs={departureMs} />}
              <RouteLabels routes={plan.routes} />
              <MapInteractions
                routes={plan.routes}
                heatmap={heatmapQuery.data}
                thresholds={plan.thresholds}
                departureMs={departureMs}
              />
              <CameraController routes={plan.routes} insets={insets} />
            </>
          )}
        </MapView>
      </ErrorBoundary>

      {desktop ? (
        <>
          <aside
            className="absolute top-3 bottom-3 left-3 z-10 flex flex-col overflow-hidden rounded-[20px] bg-surface shadow-panel"
            style={{ width: PANEL_WIDTH }}
          >
            <PanelHeader />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{panel}</div>
          </aside>
          {forecastBar && (
            <div
              className="absolute bottom-4 z-10 flex justify-center"
              style={{ left: PANEL_WIDTH + GUTTER * 2, right: 64 }}
            >
              <div className="w-full max-w-[760px]">{forecastBar}</div>
            </div>
          )}
        </>
      ) : (
        <>
          {forecastBar && <div className="absolute inset-x-2 top-2 z-10">{forecastBar}</div>}
          <BottomSheet
            label="Trip planner"
            snapPoints={snapPoints}
            snapIndex={sheetSnap}
            onSnapChange={setSheetSnap}
            header={<SheetHeader plan={plan} />}
          >
            {panel}
          </BottomSheet>
        </>
      )}
    </main>
  )
}

function MapUnavailable() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-canvas p-8 text-center text-sm text-fg-muted">
      <p className="max-w-xs">
        The map hit a problem and stopped. Routes, risks and checkpoints are still in the panel;
        reloading the page brings the map back.
      </p>
    </div>
  )
}

/** Always visible on phones: the decision, even with the sheet collapsed. */
function SheetHeader({ plan }: { plan: Plan | undefined }) {
  const route = plan?.routes.find((r) => r.id === plan.recommendation.route_id)
  return (
    <div className="border-b border-line px-4 pb-3">
      <h1 className="sr-only">Haulcast: weather-aware truck routing</h1>
      {plan && route ? (
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-white">
            {route.id}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">
              Recommended: {route.name} {route.via}
            </p>
            <p className="truncate text-xs text-fg-muted tabular-nums">
              {formatDuration(route.duration_s)}, {formatMiles(route.distance_mi)}
              {plan.recommendation.warning
                ? ', with weather warnings'
                : ', clear of severe weather'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <LogoMark size={26} />
          <p className="text-sm font-semibold text-fg">Plan a weather-safe truck route</p>
        </div>
      )}
    </div>
  )
}

/** The brand band, closing in the gentle wave of the Spotter brief's page edges. */
function PanelHeader() {
  return (
    <header className="relative shrink-0 bg-ink px-5 pt-4 pb-7">
      <h1 className="sr-only">Haulcast: weather-aware truck routing</h1>
      <Logo />
      <svg
        aria-hidden
        className="absolute inset-x-0 -bottom-px h-4 w-full text-surface"
        viewBox="0 0 400 16"
        preserveAspectRatio="none"
      >
        <path d="M0 16 Q200 -6 400 16 Z" fill="currentColor" />
      </svg>
    </header>
  )
}
