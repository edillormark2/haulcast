import 'maplibre-gl/dist/maplibre-gl.css'

import { MapTrifoldIcon } from '@phosphor-icons/react'
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
// A plain asset URL: the worker is self-contained, and Vite's ?worker transform
// would inject its dev client into it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { BASEMAP_URL, brandBasemap } from './basemap'
import { HOME_BOUNDS } from './CameraController'
import { MapContext } from './mapContext'
import { type Insets, MapStatus } from './MapStatus'

setWorkerUrl(workerUrl)

/** Tile loads quicker than this go unannounced, so panning doesn't flicker a pill. */
const TILE_STATUS_DELAY_MS = 600

const ATTRIBUTION =
  'Weather <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> (CC BY 4.0) · ' +
  'Routing <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noreferrer">Valhalla</a>, ' +
  '<a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a>'

interface MapViewProps {
  /** Where floating UI covers the map, so status pills land in the visible part. */
  insets: Insets
  /** What the app is waiting for, shown over the map (null for nothing). */
  status?: string | null
  children?: ReactNode
}

/**
 * Owns the MapLibre instance; renders layer and overlay children once the
 * style is ready. Says so while the first view loads, and again when later
 * tiles are slow to arrive.
 */
export function MapView({ insets, status = null, children }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tilesSlow, setTilesSlow] = useState(false)
  // MapLibre needs WebGL 2; without it the panel still works on its own.
  const [supported] = useState(canUseWebGL2)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !supported) return
    const instance = new MapLibreMap({
      container,
      bounds: HOME_BOUNDS,
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true, customAttribution: ATTRIBUTION },
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      renderWorldCopies: false,
    })
    instance.touchZoomRotate.disableRotation()
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    instance.setStyle(BASEMAP_URL, { transformStyle: (_previous, next) => brandBasemap(next) })
    instance.once('style.load', () => setMap(instance))
    // Fires once the style and the first view's tiles have loaded and drawn.
    instance.once('load', () => setLoaded(true))
    return () => {
      setMap(null)
      instance.remove()
    }
  }, [supported])

  // After the first view, announce tile loads only when they're slow.
  useEffect(() => {
    if (!map || !loaded) return
    let timer = 0
    const onLoading = () => {
      if (!timer) timer = window.setTimeout(() => setTilesSlow(true), TILE_STATUS_DELAY_MS)
    }
    const settle = () => {
      if (!map.areTilesLoaded()) return
      window.clearTimeout(timer)
      timer = 0
      setTilesSlow(false)
    }
    map.on('dataloading', onLoading)
    map.on('data', settle)
    map.on('idle', settle)
    return () => {
      window.clearTimeout(timer)
      map.off('dataloading', onLoading)
      map.off('data', settle)
      map.off('idle', settle)
    }
  }, [map, loaded])

  return (
    <div className="absolute inset-0 bg-canvas">
      {/* Sized with h-full rather than inset-0: MapLibre's unlayered CSS sets
          position: relative on this element, which beats Tailwind's layers. */}
      <div ref={containerRef} className="h-full w-full" role="region" aria-label="Route map" />
      {supported && (
        <MapStatus message={loaded ? null : 'Loading map…'} insets={insets} placement="center" />
      )}
      <MapStatus
        message={loaded ? (status ?? (tilesSlow ? 'Loading map…' : null)) : null}
        insets={insets}
      />
      {!supported && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center">
          <div className="max-w-xs text-sm text-fg-muted">
            <MapTrifoldIcon size={28} className="mx-auto mb-2 text-fg-subtle" aria-hidden />
            This browser can&apos;t draw the map (it needs WebGL 2). Routes, risks and checkpoints
            are all still in the panel.
          </div>
        </div>
      )}
      {map && <MapContext value={map}>{children}</MapContext>}
    </div>
  )
}

function canUseWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    return false
  }
}
