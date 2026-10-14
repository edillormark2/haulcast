import { create } from 'zustand'

import type { HeatmapMetric } from '../api/types'

export const FORECAST_HOURS = 48

export interface CheckpointRef {
  routeId: string
  index: number
}

export type PanelTab = 'routes' | 'checkpoints'

interface UiState {
  selectedRouteId: string | null
  hoveredRouteId: string | null
  hoveredCheckpoint: CheckpointRef | null
  /** A checkpoint the user clicked; the map flies to it and shows its details. */
  focusedCheckpoint: CheckpointRef | null
  /** The forecast slider's value: hours since departure, 0–48. */
  forecastHour: number
  /** The hour the map draws: eases toward `forecastHour` while scrubbing. */
  displayHour: number
  playing: boolean
  metric: HeatmapMetric
  heatmapVisible: boolean
  panelTab: PanelTab
  /** Bottom sheet position on phones: 0 peek, 1 half, 2 full. */
  sheetSnap: number

  selectRoute: (routeId: string | null) => void
  hoverRoute: (routeId: string | null) => void
  hoverCheckpoint: (checkpoint: CheckpointRef | null) => void
  focusCheckpoint: (checkpoint: CheckpointRef | null) => void
  setForecastHour: (hour: number) => void
  setDisplayHour: (hour: number) => void
  setPlaying: (playing: boolean) => void
  setMetric: (metric: HeatmapMetric) => void
  toggleHeatmap: () => void
  setPanelTab: (tab: PanelTab) => void
  setSheetSnap: (snap: number) => void
  resetForNewPlan: (recommendedRouteId: string) => void
}

const clampHour = (hour: number) => Math.min(Math.max(hour, 0), FORECAST_HOURS)

export const useUiStore = create<UiState>()((set) => ({
  selectedRouteId: null,
  hoveredRouteId: null,
  hoveredCheckpoint: null,
  focusedCheckpoint: null,
  forecastHour: 0,
  displayHour: 0,
  playing: false,
  metric: 'risk',
  heatmapVisible: true,
  panelTab: 'routes',
  sheetSnap: 1,

  selectRoute: (selectedRouteId) => set({ selectedRouteId, focusedCheckpoint: null }),
  hoverRoute: (hoveredRouteId) => set({ hoveredRouteId }),
  hoverCheckpoint: (hoveredCheckpoint) => set({ hoveredCheckpoint }),
  focusCheckpoint: (focusedCheckpoint) =>
    set(
      focusedCheckpoint
        ? { focusedCheckpoint, selectedRouteId: focusedCheckpoint.routeId }
        : { focusedCheckpoint },
    ),
  setForecastHour: (hour) => set({ forecastHour: clampHour(hour) }),
  setDisplayHour: (hour) => set({ displayHour: clampHour(hour) }),
  setPlaying: (playing) => set({ playing }),
  setMetric: (metric) => set({ metric }),
  toggleHeatmap: () => set((state) => ({ heatmapVisible: !state.heatmapVisible })),
  setPanelTab: (panelTab) => set({ panelTab }),
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),
  resetForNewPlan: (recommendedRouteId) =>
    set({
      selectedRouteId: recommendedRouteId,
      hoveredRouteId: null,
      hoveredCheckpoint: null,
      focusedCheckpoint: null,
      forecastHour: 0,
      displayHour: 0,
      playing: false,
      // On phones, drop the sheet to its peek so the new routes are visible.
      sheetSnap: 0,
    }),
}))

export function sameCheckpoint(a: CheckpointRef | null, b: CheckpointRef | null): boolean {
  return a !== null && b !== null && a.routeId === b.routeId && a.index === b.index
}
