import type { Route } from '../api/types'

type LonLat = [number, number]

const etaCache = new WeakMap<Route, Float64Array>()

/** Checkpoint ETAs as epoch ms, parsed once per route. */
function checkpointTimes(route: Route): Float64Array {
  let times = etaCache.get(route)
  if (!times) {
    times = Float64Array.from(route.checkpoints, (checkpoint) => Date.parse(checkpoint.eta))
    etaCache.set(route, times)
  }
  return times
}

/** Largest index i with values[i] <= target (0 when target is below the first value). */
function floorIndex(values: ArrayLike<number>, target: number): number {
  let low = 0
  let high = values.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if ((values[mid] ?? Infinity) <= target) low = mid
    else high = mid - 1
  }
  return low
}

/** The truck's mile marker at a moment, interpolated between checkpoint ETAs. */
export function mileAtTime(route: Route, timeMs: number): number {
  const times = checkpointTimes(route)
  const first = route.checkpoints[0]
  const last = route.checkpoints.at(-1)
  if (!first || !last) return 0
  if (timeMs <= (times[0] ?? 0)) return first.mile
  if (timeMs >= (times[times.length - 1] ?? 0)) return last.mile
  const i = floorIndex(times, timeMs)
  const a = route.checkpoints[i]
  const b = route.checkpoints[i + 1]
  const t0 = times[i] ?? 0
  const t1 = times[i + 1] ?? t0
  if (!a || !b || t1 === t0) return a?.mile ?? 0
  return a.mile + ((b.mile - a.mile) * (timeMs - t0)) / (t1 - t0)
}

/** The point `mile` miles along the route, interpolated along its geometry. */
export function pointAtMile(route: Route, mile: number): LonLat {
  const miles = route.geometry_miles
  const i = floorIndex(miles, mile)
  const a = route.geometry[i]
  const b = route.geometry[Math.min(i + 1, route.geometry.length - 1)]
  if (!a || !b) return route.geometry[0] ?? [0, 0]
  const m0 = miles[i] ?? 0
  const m1 = miles[i + 1] ?? m0
  const t = m1 > m0 ? Math.min(Math.max((mile - m0) / (m1 - m0), 0), 1) : 0
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/**
 * Where to pin a route's label: the point in the middle stretch of the route
 * farthest from the other routes, so labels don't stack on shared roads.
 */
export function labelAnchor(route: Route, others: Route[]): LonLat {
  const candidates = [0.35, 0.45, 0.55, 0.65].map((share) =>
    pointAtMile(route, route.distance_mi * share),
  )
  const neighbours = others.flatMap((other) => other.geometry.filter((_, i) => i % 8 === 0))
  let best = candidates[1] ?? route.geometry[0] ?? [0, 0]
  let bestClearance = -1
  for (const candidate of candidates) {
    const clearance = Math.min(
      ...neighbours.map(([lon, lat]) => (lon - candidate[0]) ** 2 + (lat - candidate[1]) ** 2),
      Infinity,
    )
    if (clearance > bestClearance) {
      best = candidate
      bestClearance = clearance
    }
  }
  return best
}
