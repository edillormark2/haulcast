import { create } from 'zustand'

import type { HeatmapMetric } from '../api/types'

export const FORECAST_HOURS = 48
/** Within this many hours of the trip's end counts as arrived (a few seconds). */
export const ARRIVAL_EPSILON_H = 0.001

export interface CheckpointRef {
  routeId: string
  index: number
}

export type PanelTab = 'routes' | 'checkpoints'

/** A trip being played: the truck drives one route from departure to arrival. */
export interface Playback {
  routeId: string
  /** Hours from departure to arrival, where playback stops. */
  endHour: number
}

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
  /**
   * The trip whose playback set the current hour. It outlives a pause and the
   * arrival, so switching routes knows to rewind; scrubbing clears it, since
   * an hour the user picked should stay put.
   */
  playback: Playback | null
  metric: HeatmapMetric
  heatmapVisible: boolean
  panelTab: PanelTab
  /** Bottom sheet position on phones: 0 peek, 1 half, 2 full. */
  sheetSnap: number
  /** The narrated demo video, shown in a dialog over the app. */
  demoOpen: boolean

  selectRoute: (routeId: string | null) => void
  hoverRoute: (routeId: string | null) => void
  hoverCheckpoint: (checkpoint: CheckpointRef | null) => void
  focusCheckpoint: (checkpoint: CheckpointRef | null) => void
  /** Plays a trip from the current hour, or from departure once it has arrived. */
  play: (playback: Playback) => void
  pause: () => void
  /** The user picked an hour on the slider. */
  scrubTo: (hour: number) => void
  /** One playback frame: the slider and the map move together, stopping at arrival. */
  advance: (hour: number) => void
  setDisplayHour: (hour: number) => void
  setMetric: (metric: HeatmapMetric) => void
  toggleHeatmap: () => void
  setPanelTab: (tab: PanelTab) => void
  setSheetSnap: (snap: number) => void
  openDemo: () => void
  closeDemo: () => void
  resetForNewPlan: (recommendedRouteId: string) => void
  /** Back to an empty planner, ready for a new trip. */
  clearPlan: () => void
}

const clampHour = (hour: number) => Math.min(Math.max(hour, 0), FORECAST_HOURS)

const REWOUND = { forecastHour: 0, playing: false, playback: null } as const

/** Selecting another route stops a playing (or played) trip and rewinds to departure. */
function selection(state: UiState, routeId: string | null): Partial<UiState> {
  const rewind = state.playback !== null && state.playback.routeId !== routeId
  return rewind ? { selectedRouteId: routeId, ...REWOUND } : { selectedRouteId: routeId }
}

export const useUiStore = create<UiState>()((set) => ({
  selectedRouteId: null,
  hoveredRouteId: null,
  hoveredCheckpoint: null,
  focusedCheckpoint: null,
  forecastHour: 0,
  displayHour: 0,
  playing: false,
  playback: null,
  metric: 'risk',
  heatmapVisible: true,
  panelTab: 'routes',
  sheetSnap: 1,
  demoOpen: false,

  selectRoute: (routeId) =>
    set((state) => ({ ...selection(state, routeId), focusedCheckpoint: null })),
  hoverRoute: (hoveredRouteId) => set({ hoveredRouteId }),
  hoverCheckpoint: (hoveredCheckpoint) => set({ hoveredCheckpoint }),
  focusCheckpoint: (focusedCheckpoint) =>
    set((state) =>
      focusedCheckpoint
        ? { ...selection(state, focusedCheckpoint.routeId), focusedCheckpoint }
        : { focusedCheckpoint },
    ),
  play: (playback) =>
    set((state) => {
      const endHour = clampHour(playback.endHour)
      const arrived = state.forecastHour >= endHour - ARRIVAL_EPSILON_H
      const hour = arrived ? 0 : state.forecastHour
      return {
        playing: true,
        playback: { ...playback, endHour },
        forecastHour: hour,
        displayHour: hour,
      }
    }),
  pause: () => set({ playing: false }),
  scrubTo: (hour) => set({ forecastHour: clampHour(hour), playing: false, playback: null }),
  advance: (hour) =>
    set((state) => {
      const endHour = state.playback?.endHour ?? FORECAST_HOURS
      const next = Math.min(clampHour(hour), endHour)
      return { forecastHour: next, displayHour: next, playing: state.playing && next < endHour }
    }),
  setDisplayHour: (hour) => set({ displayHour: clampHour(hour) }),
  setMetric: (metric) => set({ metric }),
  toggleHeatmap: () => set((state) => ({ heatmapVisible: !state.heatmapVisible })),
  setPanelTab: (panelTab) => set({ panelTab }),
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),
  // Watching the demo pauses a playing trip, so the two don't run at once.
  openDemo: () => set({ demoOpen: true, playing: false }),
  closeDemo: () => set({ demoOpen: false }),
  resetForNewPlan: (recommendedRouteId) =>
    set({
      selectedRouteId: recommendedRouteId,
      hoveredRouteId: null,
      hoveredCheckpoint: null,
      focusedCheckpoint: null,
      forecastHour: 0,
      displayHour: 0,
      playing: false,
      playback: null,
      // On phones, drop the sheet to its peek so the new routes are visible.
      sheetSnap: 0,
    }),
  clearPlan: () =>
    set({
      selectedRouteId: null,
      hoveredRouteId: null,
      hoveredCheckpoint: null,
      focusedCheckpoint: null,
      forecastHour: 0,
      displayHour: 0,
      playing: false,
      playback: null,
      panelTab: 'routes',
      // On phones, raise the sheet so the form and the sample trips are in reach.
      sheetSnap: 1,
    }),
}))

export function sameCheckpoint(a: CheckpointRef | null, b: CheckpointRef | null): boolean {
  return a !== null && b !== null && a.routeId === b.routeId && a.index === b.index
}
