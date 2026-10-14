import { useEffect, useState } from 'react'

import type { HeatmapData } from '../../lib/heatmap'
import { useUiStore } from '../../state/uiStore'
import { insertionPoints } from './basemap'
import { HeatmapLayer } from './heatmap/HeatmapLayer'
import { useMap } from './mapContext'

/**
 * Bridges app state to the WebGL heatmap layer. The displayed hour reaches
 * the GPU through a store subscription, so scrubbing never re-renders React.
 */
export function HeatmapController({ data }: { data: HeatmapData | undefined }) {
  const map = useMap()
  const [layer] = useState(() => new HeatmapLayer('weather-heatmap'))

  useEffect(() => {
    map.addLayer(layer, insertionPoints(map.getStyle().layers).heatmap)
    return () => {
      if (map.getLayer(layer.id)) map.removeLayer(layer.id)
    }
  }, [map, layer])

  useEffect(() => {
    layer.setData(data ?? null)
  }, [layer, data])

  useEffect(() => {
    const sync = (state: ReturnType<typeof useUiStore.getState>) => {
      layer.setMetric(state.metric)
      layer.setVisible(state.heatmapVisible)
      layer.setFrame(state.displayHour)
    }
    sync(useUiStore.getState())
    return useUiStore.subscribe(sync)
  }, [layer])

  return null
}
