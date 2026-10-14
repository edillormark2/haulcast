import type { Feature, FeatureCollection, LineString, Point } from 'geojson'

import type { Route } from '../../api/types'

export interface RouteState {
  selectedRouteId: string | null
  hoveredRouteId: string | null
}

function flags(routeId: string, state: RouteState) {
  return {
    selected: routeId === state.selectedRouteId,
    hovered: routeId === state.hoveredRouteId,
  }
}

/** One line per route, used for casings and hit-testing. */
export function routeLines(routes: Route[], state: RouteState): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: routes.map((route) => ({
      type: 'Feature',
      properties: { routeId: route.id, ...flags(route.id, state) },
      geometry: { type: 'LineString', coordinates: route.geometry },
    })),
  }
}

/** Each route split into runs of equal risk, for the coloured line. */
export function riskSections(routes: Route[], state: RouteState): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const route of routes) {
    const routeFlags = flags(route.id, state)
    for (const section of route.sections) {
      features.push({
        type: 'Feature',
        properties: { routeId: route.id, level: section.level, ...routeFlags },
        geometry: {
          type: 'LineString',
          coordinates: route.geometry.slice(section.start, section.end + 1),
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

export function checkpointPoints(routes: Route[], state: RouteState): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap((route) =>
      route.checkpoints.map((checkpoint) => ({
        type: 'Feature' as const,
        properties: {
          key: `${route.id}:${checkpoint.index}`,
          routeId: route.id,
          index: checkpoint.index,
          level: checkpoint.risk,
          ...flags(route.id, state),
        },
        geometry: { type: 'Point' as const, coordinates: [checkpoint.lon, checkpoint.lat] },
      })),
    ),
  }
}

export function routesBounds(routes: Route[]): [[number, number], [number, number]] {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const route of routes) {
    for (const [lon, lat] of route.geometry) {
      west = Math.min(west, lon)
      east = Math.max(east, lon)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  }
  return [
    [west, south],
    [east, north],
  ]
}
