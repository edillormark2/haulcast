import { XIcon } from '@phosphor-icons/react'
import type { MapGeoJSONFeature, MapMouseEvent, PointLike } from 'maplibre-gl'
import { useEffect, useState } from 'react'

import type { Checkpoint, Factor, Route, Thresholds } from '../../api/types'
import { formatClock, formatDuration, formatHour, formatMiles } from '../../lib/format'
import { type HeatmapData, sampleHeatmap, type WeatherSample } from '../../lib/heatmap'
import { overallLevel } from '../../lib/thresholds'
import { HOUR_MS } from '../../lib/time'
import { type CheckpointRef, sameCheckpoint, useUiStore } from '../../state/uiStore'
import { RiskBadge } from '../../ui/RiskBadge'
import { WeatherReadout } from '../../ui/WeatherReadout'
import { LAYER } from './layers/RouteLayers'
import { useMap } from './mapContext'
import { MapMarker } from './MapMarker'

type Hover =
  | { kind: 'checkpoint'; route: Route; checkpoint: Checkpoint }
  | { kind: 'route'; route: Route }
  | { kind: 'weather'; sample: WeatherSample; hour: number }

interface Pointer {
  x: number
  y: number
}

interface MapInteractionsProps {
  routes: Route[]
  heatmap: HeatmapData | undefined
  thresholds: Record<Factor, Thresholds>
  departureMs: number
}

/**
 * One pointer handler for the whole map: checkpoints win over routes, routes
 * over the heatmap underneath. Hovering shows a card; clicking selects.
 */
export function MapInteractions({
  routes,
  heatmap,
  thresholds,
  departureMs,
}: MapInteractionsProps) {
  const map = useMap()
  const [hover, setHover] = useState<(Hover & Pointer) | null>(null)
  const focused = useUiStore((state) => state.focusedCheckpoint)

  useEffect(() => {
    const store = useUiStore.getState
    const canvas = map.getCanvas()
    let frame = 0

    const pick = (point: PointLike) => {
      const features = map.queryRenderedFeatures(point, {
        layers: [LAYER.checkpoints, LAYER.hit],
      })
      const checkpoint = features.find((f) => f.layer.id === LAYER.checkpoints)
      const route = features.find((f) => f.layer.id === LAYER.hit)
      return { checkpoint: checkpoint && toRef(checkpoint), routeId: routeIdOf(route) }
    }

    const update = (event: MapMouseEvent) => {
      const { checkpoint, routeId } = pick(event.point)
      const pointer = { x: event.point.x, y: event.point.y }
      store().hoverCheckpoint(checkpoint ?? null)
      store().hoverRoute(checkpoint?.routeId ?? routeId ?? null)
      canvas.style.cursor = checkpoint || routeId ? 'pointer' : ''

      if (checkpoint) {
        const route = routes.find((r) => r.id === checkpoint.routeId)
        const point = route?.checkpoints[checkpoint.index]
        setHover(
          route && point ? { kind: 'checkpoint', route, checkpoint: point, ...pointer } : null,
        )
        return
      }
      const route = routes.find((r) => r.id === routeId)
      if (route) {
        setHover({ kind: 'route', route, ...pointer })
        return
      }
      const state = store()
      if (heatmap && state.heatmapVisible) {
        const hour = state.displayHour
        const sample = sampleHeatmap(heatmap, event.lngLat.lng, event.lngLat.lat, hour)
        setHover(sample ? { kind: 'weather', sample, hour, ...pointer } : null)
        return
      }
      setHover(null)
    }

    // Route pills, the truck and the pinned card are DOM markers inside the
    // map, so their pointer events reach the map too. They handle their own.
    const overMarker = (event: MapMouseEvent) =>
      event.originalEvent.target instanceof Element &&
      event.originalEvent.target.closest('.maplibregl-marker') !== null

    const onMove = (event: MapMouseEvent) => {
      cancelAnimationFrame(frame)
      if (overMarker(event)) {
        setHover(null)
        return
      }
      frame = requestAnimationFrame(() => update(event))
    }
    const onLeave = () => {
      cancelAnimationFrame(frame)
      setHover(null)
      store().hoverRoute(null)
      store().hoverCheckpoint(null)
      canvas.style.cursor = ''
    }
    const onClick = (event: MapMouseEvent) => {
      if (overMarker(event)) return
      const { checkpoint, routeId } = pick(event.point)
      if (checkpoint) store().focusCheckpoint(checkpoint)
      else if (routeId) store().selectRoute(routeId)
      else store().focusCheckpoint(null)
    }

    map.on('mousemove', onMove)
    map.on('mouseout', onLeave)
    map.on('click', onClick)
    return () => {
      cancelAnimationFrame(frame)
      map.off('mousemove', onMove)
      map.off('mouseout', onLeave)
      map.off('click', onClick)
    }
  }, [map, routes, heatmap])

  const focusedRoute = focused ? routes.find((route) => route.id === focused.routeId) : undefined
  const focusedPoint = focused ? focusedRoute?.checkpoints[focused.index] : undefined
  const showHover =
    hover && !(hover.kind === 'checkpoint' && sameCheckpoint(focused, toRefOf(hover)))

  return (
    <>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {showHover && (
          <div
            key={hover.kind}
            className="absolute top-0 left-0 w-max max-w-72 origin-top-left rounded-xl bg-surface p-3 shadow-float ring-1 ring-ink/5 transition-[opacity,scale] duration-150 ease-out starting:scale-[0.97] starting:opacity-0"
            style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 14}px)` }}
          >
            <HoverContent hover={hover} departureMs={departureMs} thresholds={thresholds} />
          </div>
        )}
      </div>
      {focusedRoute && focusedPoint && (
        <MapMarker
          lngLat={[focusedPoint.lon, focusedPoint.lat]}
          anchor="bottom"
          offset={[0, -12]}
          zIndex={3}
        >
          <div className="w-72 rounded-xl bg-surface p-3.5 shadow-float ring-1 ring-ink/5">
            <div className="mb-2 flex items-start justify-between gap-2">
              <CheckpointTitle route={focusedRoute} checkpoint={focusedPoint} />
              <button
                type="button"
                onClick={() => useUiStore.getState().focusCheckpoint(null)}
                className="-m-1 rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                aria-label="Close checkpoint details"
              >
                <XIcon size={14} />
              </button>
            </div>
            <CheckpointDetails checkpoint={focusedPoint} departureMs={departureMs} />
          </div>
        </MapMarker>
      )}
    </>
  )
}

function HoverContent({
  hover,
  departureMs,
  thresholds,
}: {
  hover: Hover
  departureMs: number
  thresholds: Record<Factor, Thresholds>
}) {
  switch (hover.kind) {
    case 'checkpoint':
      return (
        <>
          <CheckpointTitle route={hover.route} checkpoint={hover.checkpoint} />
          <div className="mt-2">
            <CheckpointDetails checkpoint={hover.checkpoint} departureMs={departureMs} />
          </div>
        </>
      )
    case 'route':
      return (
        <div className="text-xs">
          <p className="text-sm font-semibold">
            {hover.route.name} <span className="font-normal text-fg-muted">{hover.route.via}</span>
          </p>
          <p className="mt-0.5 text-fg-muted tabular-nums">
            {formatDuration(hover.route.duration_s)}, {formatMiles(hover.route.distance_mi)}
          </p>
        </div>
      )
    case 'weather': {
      const level = overallLevel(hover.sample, thresholds)
      return (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold tabular-nums">
              Weather {formatHour(departureMs + hover.hour * HOUR_MS)}
              <span className="ml-1.5 font-normal text-fg-muted">+{Math.round(hover.hour)} h</span>
            </p>
            <RiskBadge level={level} size="sm" />
          </div>
          <WeatherReadout
            windMph={hover.sample.wind}
            rainInHr={hover.sample.rain}
            snowInHr={hover.sample.snow}
            compact
          />
        </div>
      )
    }
  }
}

function CheckpointTitle({ route, checkpoint }: { route: Route; checkpoint: Checkpoint }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <RiskBadge level={checkpoint.risk} size="sm" />
      <p className="text-xs font-semibold tabular-nums">
        {route.name}, mile {Math.round(checkpoint.mile)}
      </p>
    </div>
  )
}

function CheckpointDetails({
  checkpoint,
  departureMs,
}: {
  checkpoint: Checkpoint
  departureMs: number
}) {
  const eta = Date.parse(checkpoint.eta)
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-muted tabular-nums">
        Arrives {formatClock(eta)}
        <span className="text-fg-subtle">
          {' '}
          ({formatDuration((eta - departureMs) / 1000)} after departure)
        </span>
      </p>
      <WeatherReadout
        windMph={checkpoint.weather.wind_mph}
        gustMph={checkpoint.weather.gust_mph}
        rainInHr={checkpoint.weather.rain_in_hr}
        snowInHr={checkpoint.weather.snow_in_hr}
        drivers={checkpoint.drivers}
        level={checkpoint.risk}
      />
      {checkpoint.risk !== 'low' && (
        <p className="text-xs leading-snug text-fg">{checkpoint.reason}</p>
      )}
    </div>
  )
}

function toRef(feature: MapGeoJSONFeature): CheckpointRef | undefined {
  const { routeId, index } = feature.properties as { routeId?: string; index?: number }
  return routeId === undefined || index === undefined ? undefined : { routeId, index }
}

function toRefOf(hover: Hover & { kind: 'checkpoint' }): CheckpointRef {
  return { routeId: hover.route.id, index: hover.checkpoint.index }
}

function routeIdOf(feature: MapGeoJSONFeature | undefined): string | undefined {
  return (feature?.properties as { routeId?: string } | undefined)?.routeId
}
