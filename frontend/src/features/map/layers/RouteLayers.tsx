import type { FeatureCollection } from 'geojson'
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import { useEffect } from 'react'

import type { Route } from '../../../api/types'
import { RISK, RISK_LEVELS } from '../../../lib/risk'
import { type CheckpointRef, useUiStore } from '../../../state/uiStore'
import { insertionPoints } from '../basemap'
import { checkpointPoints, riskSections, routeLines } from '../geojson'
import { useMap } from '../mapContext'

export const LAYER = {
  casing: 'route-casing',
  sections: 'route-sections',
  noTravel: 'route-no-travel',
  hit: 'route-hit',
  checkpoints: 'route-checkpoints',
} as const

const SOURCE = { lines: 'routes', sections: 'route-sections', checkpoints: 'checkpoints' } as const
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

const riskColor: ExpressionSpecification = [
  'match',
  ['get', 'level'],
  ...RISK_LEVELS.flatMap((level) => [level, RISK[level].color]),
  RISK.low.color,
] as unknown as ExpressionSpecification

const selected: ExpressionSpecification = ['==', ['get', 'selected'], true]
const emphasized: ExpressionSpecification = [
  'any',
  ['==', ['get', 'selected'], true],
  ['==', ['get', 'hovered'], true],
]

/** Width that grows with zoom, wider for the selected route. */
function width(selectedWidth: [number, number], otherWidth: [number, number]) {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    4,
    ['case', selected, selectedWidth[0], otherWidth[0]],
    10,
    ['case', selected, selectedWidth[1], otherWidth[1]],
  ] as unknown as ExpressionSpecification
}

/** All three routes drawn in their risk colours; the selected one on top and bolder. */
export function RouteLayers({ routes }: { routes: Route[] }) {
  const map = useMap()
  const selectedRouteId = useUiStore((state) => state.selectedRouteId)
  const hoveredRouteId = useUiStore((state) => state.hoveredRouteId)

  useEffect(() => {
    const beforeId = insertionPoints(map.getStyle().layers).overlays
    map.addSource(SOURCE.lines, { type: 'geojson', data: EMPTY })
    map.addSource(SOURCE.sections, { type: 'geojson', data: EMPTY })
    map.addSource(SOURCE.checkpoints, { type: 'geojson', data: EMPTY, promoteId: 'key' })

    const lineLayout = { 'line-cap': 'round', 'line-join': 'round' } as const
    const sortKey: ExpressionSpecification = [
      'case',
      selected,
      2,
      ['==', ['get', 'hovered'], true],
      1,
      0,
    ]

    map.addLayer(
      {
        id: LAYER.casing,
        type: 'line',
        source: SOURCE.lines,
        layout: { ...lineLayout, 'line-sort-key': sortKey },
        paint: {
          'line-color': '#043d4c',
          'line-width': width([7.5, 11], [4.5, 7]),
          'line-opacity': ['case', emphasized, 0.85, 0.28],
        },
      },
      beforeId,
    )
    map.addLayer(
      {
        id: LAYER.sections,
        type: 'line',
        source: SOURCE.sections,
        // Butt caps: round caps would bead where translucent sections meet.
        layout: { 'line-cap': 'butt', 'line-join': 'round', 'line-sort-key': sortKey },
        paint: {
          'line-color': riskColor,
          'line-width': width([4.5, 7.5], [2.2, 4]),
          'line-opacity': ['case', emphasized, 1, 0.6],
        },
      },
      beforeId,
    )
    // Road-closed stripes over No Travel stretches, so they read without colour.
    map.addLayer(
      {
        id: LAYER.noTravel,
        type: 'line',
        source: SOURCE.sections,
        filter: ['==', ['get', 'level'], 'no_travel'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': width([2.2, 3.5], [1, 2]),
          'line-dasharray': [1, 1.4],
        },
      },
      beforeId,
    )
    map.addLayer({
      id: LAYER.hit,
      type: 'line',
      source: SOURCE.lines,
      layout: lineLayout,
      paint: { 'line-color': '#000000', 'line-width': 18, 'line-opacity': 0 },
    })
    map.addLayer({
      id: LAYER.checkpoints,
      type: 'circle',
      source: SOURCE.checkpoints,
      layout: { 'circle-sort-key': ['case', selected, 1, 0] },
      paint: {
        'circle-color': riskColor,
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          ['case', ['boolean', ['feature-state', 'active'], false], 7, selected, 3.6, 2],
          10,
          ['case', ['boolean', ['feature-state', 'active'], false], 10, selected, 6, 3.5],
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': ['case', selected, 1.6, 0.8],
        'circle-opacity': ['case', emphasized, 1, 0.55],
        'circle-stroke-opacity': ['case', emphasized, 1, 0.55],
      },
    })

    return () => {
      for (const id of Object.values(LAYER)) if (map.getLayer(id)) map.removeLayer(id)
      for (const id of Object.values(SOURCE)) if (map.getSource(id)) map.removeSource(id)
    }
  }, [map])

  // Enlarge the hovered and the focused checkpoint.
  useEffect(() => {
    const keyOf = (ref: CheckpointRef | null) => (ref ? `${ref.routeId}:${ref.index}` : null)
    const sync = (next: string[], previous: string[]) => {
      for (const id of previous) {
        if (!next.includes(id))
          map.setFeatureState({ source: SOURCE.checkpoints, id }, { active: false })
      }
      for (const id of next)
        map.setFeatureState({ source: SOURCE.checkpoints, id }, { active: true })
    }
    const active = (state: ReturnType<typeof useUiStore.getState>) =>
      [keyOf(state.hoveredCheckpoint), keyOf(state.focusedCheckpoint)].filter((id) => id !== null)
    let current = active(useUiStore.getState())
    sync(current, [])
    return useUiStore.subscribe((state) => {
      const next = active(state)
      if (next.join() !== current.join()) {
        sync(next, current)
        current = next
      }
    })
  }, [map, routes])

  useEffect(() => {
    const state = { selectedRouteId, hoveredRouteId }
    void map.getSource<GeoJSONSource>(SOURCE.lines)?.setData(routeLines(routes, state))
    void map.getSource<GeoJSONSource>(SOURCE.sections)?.setData(riskSections(routes, state))
    void map.getSource<GeoJSONSource>(SOURCE.checkpoints)?.setData(checkpointPoints(routes, state))
  }, [map, routes, selectedRouteId, hoveredRouteId])

  return null
}
