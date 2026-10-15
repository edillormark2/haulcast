import type { Feature, FeatureCollection, LineString, Point } from 'geojson'

import type { Route } from '../../api/types'

/**
 * Feature ids, unique per source, so hover can be drawn with feature state
 * instead of re-uploading the routes.
 */
export const sectionKey = (routeId: string, index: number) => `${routeId}:${index}`
export const checkpointKey = (routeId: string, index: number) => `${routeId}:${index}`

/** One line per route, used for casings and hit-testing. */
export function routeLines(
  routes: Route[],
  selectedRouteId: string | null,
): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: routes.map((route) => ({
      type: 'Feature',
      properties: { routeId: route.id, selected: route.id === selectedRouteId },
      geometry: { type: 'LineString', coordinates: route.geometry },
    })),
  }
}

/** Each route split into runs of equal risk, for the coloured line. */
export function riskSections(
  routes: Route[],
  selectedRouteId: string | null,
): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const route of routes) {
    route.sections.forEach((section, index) => {
      features.push({
        type: 'Feature',
        properties: {
          key: sectionKey(route.id, index),
          routeId: route.id,
          level: section.level,
          selected: route.id === selectedRouteId,
        },
        geometry: {
          type: 'LineString',
          coordinates: route.geometry.slice(section.start, section.end + 1),
        },
      })
    })
  }
  return { type: 'FeatureCollection', features }
}

export function checkpointPoints(
  routes: Route[],
  selectedRouteId: string | null,
): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap((route) =>
      route.checkpoints.map((checkpoint) => ({
        type: 'Feature' as const,
        properties: {
          key: checkpointKey(route.id, checkpoint.index),
          routeId: route.id,
          index: checkpoint.index,
          level: checkpoint.risk,
          selected: route.id === selectedRouteId,
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
