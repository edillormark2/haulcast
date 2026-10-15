import { CircleNotchIcon } from '@phosphor-icons/react'
import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'

import { busyRetry, useHeatmap, usePlan } from '../api/queries'
import type { Plan, TripRequest } from '../api/types'
import { DemoButton } from '../features/demo/DemoButton'
import { DemoDialog } from '../features/demo/DemoDialog'
import { ForecastBar } from '../features/forecast/ForecastBar'
import { useForecastClock } from '../features/forecast/useForecastClock'
import { type Insets, MapLoading } from '../features/map/MapStatus'
import { type PlanQueryState, PlannerPanel } from '../features/planner/PlannerPanel'
import { formatDuration, formatMiles } from '../lib/format'
import { useMediaQuery, useViewportHeight } from '../lib/useMediaQuery'
import { useTripParams } from '../state/tripParams'
import { useUiStore } from '../state/uiStore'
import { BottomSheet } from '../ui/BottomSheet'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { Logo, LogoMark } from '../ui/Logo'

// MapLibre is most of the app's code. Loading the map on its own lets the
// panel work while it downloads (index.html preloads it alongside).
const TripMap = lazy(() => import('../features/map/TripMap'))

const PANEL_WIDTH = 392
const GUTTER = 12

export function App() {
  const [trip, setTrip] = useTripParams()
  const planQuery = usePlan(trip)
  const plan = planQuery.data
  const heatmapQuery = useHeatmap(plan)
  const desktop = useMediaQuery('(min-width: 768px)')
  const resetForNewPlan = useUiStore((state) => state.resetForNewPlan)
  const clearPlan = useUiStore((state) => state.clearPlan)
  useForecastClock()

  const sheetSnap = useUiStore((state) => state.sheetSnap)
  const setSheetSnap = useUiStore((state) => state.setSheetSnap)
  useEffect(() => {
    if (plan) resetForNewPlan(plan.recommendation.route_id)
  }, [plan, resetForNewPlan])

  // No trip in the URL, after New trip or the browser's back button: start clean.
  const hasTrip = trip !== null
  useEffect(() => {
    if (!hasTrip) clearPlan()
  }, [hasTrip, clearPlan])

  const planning = planQuery.isFetching
  const refreshing = planning && planQuery.isPlaceholderData
  const planRetry = busyRetry(planQuery)
  const query: PlanQueryState = {
    plan,
    loading: planning,
    refreshing,
    error: planQuery.error,
    busy: planRetry,
    retry: () => void planQuery.refetch(),
  }
  const submit = useCallback((next: TripRequest) => setTrip(next), [setTrip])
  const startOver = useCallback(() => setTrip(null), [setTrip])

  const departureMs = plan ? Date.parse(plan.trip.departure) : 0
  const viewportHeight = useViewportHeight()
  const snapPoints = useMemo(
    () => [plan ? 176 : 148, Math.round(viewportHeight * 0.52), Math.round(viewportHeight * 0.9)],
    [plan, viewportHeight],
  )
  const insets: Insets = desktop
    ? { top: GUTTER, left: PANEL_WIDTH + GUTTER, right: 56, bottom: plan ? 168 : GUTTER }
    : { top: plan ? 132 : GUTTER, left: GUTTER, right: GUTTER, bottom: snapPoints[0] ?? 0 }
  // Status pills follow the sheet; route framing assumes its peek height.
  const overlayInsets: Insets = desktop
    ? insets
    : { ...insets, bottom: snapPoints[sheetSnap] ?? insets.bottom }
  const mapStatus = planRetry
    ? `${planRetry.service} is busy, trying again soon…`
    : refreshing
      ? 'Updating the routes…'
      : planning
        ? 'Finding three truck routes…'
        : null

  const forecastBar = plan && (
    <ForecastBar
      plan={plan}
      departureMs={departureMs}
      heatmapStatus={heatmapQuery.status}
      heatmapError={heatmapQuery.error}
      heatmapRetry={busyRetry(heatmapQuery)}
      onRetry={() => void heatmapQuery.refetch()}
      compact={!desktop}
    />
  )
  const panel = <PlannerPanel trip={trip} query={query} onSubmit={submit} onNewTrip={startOver} />

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <ErrorBoundary fallback={<MapUnavailable />}>
        <Suspense fallback={<MapLoading insets={overlayInsets} />}>
          <TripMap
            trip={trip}
            plan={plan}
            heatmap={heatmapQuery.data}
            status={mapStatus}
            insets={insets}
            overlayInsets={overlayInsets}
          />
        </Suspense>
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
            header={<SheetHeader plan={plan} status={mapStatus} />}
          >
            {panel}
          </BottomSheet>
        </>
      )}
      <DemoDialog />
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

/**
 * Always visible on phones: the decision, even with the sheet collapsed, or
 * what planning is waiting for until there is one.
 */
function SheetHeader({ plan, status }: { plan: Plan | undefined; status: string | null }) {
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
      ) : status ? (
        <div className="flex items-center gap-2.5" role="status">
          <CircleNotchIcon size={22} className="animate-spin text-teal" aria-hidden />
          <p className="text-sm font-semibold text-fg">{status}</p>
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <LogoMark size={26} />
          <p className="min-w-0 truncate text-sm font-semibold text-fg">
            Plan a weather-safe truck route
          </p>
          <DemoButton tone="light" compact className="ml-auto" />
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
      <div className="flex items-center justify-between gap-3">
        <div className="shrink-0">
          <Logo />
        </div>
        <DemoButton tone="dark" />
      </div>
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
