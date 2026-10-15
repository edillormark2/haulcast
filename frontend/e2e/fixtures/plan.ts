import type {
  Checkpoint,
  Comparison,
  Plan,
  RiskSection,
  Route,
  TripRequest,
} from '../../src/api/types'
import type { RiskLevel } from '../../src/lib/risk'
import { layoutFor } from './heatmap'
import { THRESHOLDS } from './rules'

type LonLat = [number, number]

/** The weather a checkpoint reads at the truck's arrival, and the API's verdict on it. */
type Reading = Pick<Checkpoint, 'risk' | 'factors' | 'drivers' | 'load_rule' | 'reason' | 'weather'>

const CALM: Reading = {
  risk: 'low',
  factors: { wind: 'low', rain: 'low', snow: 'low' },
  drivers: [],
  load_rule: null,
  reason: 'Calm: all conditions below risk thresholds',
  weather: { wind_mph: 9.8, gust_mph: 17.2, rain_in_hr: 0, snow_in_hr: 0 },
}
const GUSTS: Reading = {
  risk: 'moderate',
  factors: { wind: 'moderate', rain: 'low', snow: 'low' },
  drivers: ['wind'],
  load_rule: null,
  reason: 'Moderate: Wind 27.5 mph',
  weather: { wind_mph: 27.5, gust_mph: 38.9, rain_in_hr: 0.02, snow_in_hr: 0 },
}
const SHOWERS: Reading = {
  risk: 'moderate',
  factors: { wind: 'low', rain: 'moderate', snow: 'low' },
  drivers: ['rain'],
  load_rule: null,
  reason: 'Moderate: Rain 0.14 in/hr',
  weather: { wind_mph: 14.1, gust_mph: 23.5, rain_in_hr: 0.14, snow_in_hr: 0 },
}
const DOWNPOUR: Reading = {
  risk: 'high',
  factors: { wind: 'low', rain: 'high', snow: 'low' },
  drivers: ['rain'],
  load_rule: null,
  reason: 'High: Rain 0.32 in/hr',
  weather: { wind_mph: 16.4, gust_mph: 27.1, rain_in_hr: 0.32, snow_in_hr: 0 },
}
const CROSSWIND: Reading = {
  risk: 'severe',
  factors: { wind: 'severe', rain: 'moderate', snow: 'low' },
  drivers: ['wind'],
  load_rule: '35–44 mph wind with a load over 40,000 lb',
  reason: 'Severe: Wind 38.5 mph (35–44 mph wind with a load over 40,000 lb)',
  weather: { wind_mph: 38.5, gust_mph: 51.8, rain_in_hr: 0.12, snow_in_hr: 0 },
}

interface Stop {
  at: LonLat
  /** Set on checkpoints. The stops between them are where one checkpoint's stretch ends. */
  reading?: Reading
}

interface RouteSpec {
  id: string
  via: string
  rank: number
  /** Average speed: sets the duration and every ETA. */
  mph: number
  stops: Stop[]
}

const DALLAS: LonLat = [-96.797, 32.7767]
const TEXARKANA: LonLat = [-94.0477, 33.4251]
const TUSCALOOSA: LonLat = [-87.5692, 33.2098]
const BIRMINGHAM: LonLat = [-86.8025, 33.5207]
const ATLANTA: LonLat = [-84.388, 33.749]

/** The fastest option, but a squall line crosses I-20 twice: it ranks last. */
const ROUTE_A: RouteSpec = {
  id: 'A',
  via: 'via I-20',
  rank: 3,
  mph: 60,
  stops: [
    { at: DALLAS, reading: CALM },
    { at: [-95.3011, 32.3513] }, // Tyler
    { at: [-93.7502, 32.5252], reading: GUSTS }, // Shreveport
    { at: [-92.1193, 32.5093] }, // Monroe
    { at: [-90.8779, 32.3526], reading: CROSSWIND }, // Vicksburg
    { at: [-90.1848, 32.2988] }, // Jackson
    { at: [-88.7037, 32.3643], reading: DOWNPOUR }, // Meridian
    { at: TUSCALOOSA },
    { at: BIRMINGHAM, reading: CROSSWIND },
    { at: [-85.8316, 33.6598] }, // Anniston
    { at: ATLANTA, reading: CALM },
  ],
}

/** An hour slower, with only a shower near Little Rock: the recommendation. */
const ROUTE_B: RouteSpec = {
  id: 'B',
  via: 'via I-30 & I-22',
  rank: 1,
  mph: 58,
  stops: [
    { at: DALLAS, reading: CALM },
    { at: [-94.9686, 33.1568] }, // Mount Pleasant
    { at: TEXARKANA, reading: CALM },
    { at: [-93.0538, 34.1209] }, // Arkadelphia
    { at: [-92.2896, 34.7465], reading: SHOWERS }, // Little Rock
    { at: [-90.7898, 35.0081] }, // Forrest City
    { at: [-90.049, 35.1495], reading: CALM }, // Memphis
    { at: [-88.7034, 34.2576] }, // Tupelo
    { at: [-87.2775, 33.8312], reading: CALM }, // Jasper
    { at: BIRMINGHAM },
    { at: ATLANTA, reading: CALM },
  ],
}

/** Two-lane and slowest, through a band of heavy rain in the Delta. */
const ROUTE_C: RouteSpec = {
  id: 'C',
  via: 'via US-82',
  rank: 2,
  mph: 52,
  stops: [
    { at: DALLAS, reading: CALM },
    { at: [-95.5555, 33.6609] }, // Paris
    { at: TEXARKANA, reading: SHOWERS },
    { at: [-93.2393, 33.2671] }, // Magnolia
    { at: [-92.6663, 33.2076], reading: DOWNPOUR }, // El Dorado
    { at: [-91.0618, 33.4101] }, // Greenville
    { at: [-90.1798, 33.5162], reading: DOWNPOUR }, // Greenwood
    { at: [-88.4273, 33.4957] }, // Columbus
    { at: TUSCALOOSA, reading: SHOWERS },
    { at: BIRMINGHAM },
    { at: ATLANTA, reading: CALM },
  ],
}

/**
 * POST /api/plans/: three routes for the trip, timed from its departure.
 * Route B wins on weather even though Route A is faster.
 */
export function planFor(trip: TripRequest): Plan {
  const departureMs = Date.parse(trip.departure)
  const departure = isoUtc(departureMs)
  const a = buildRoute(ROUTE_A, departureMs)
  const b = buildRoute(ROUTE_B, departureMs)
  const c = buildRoute(ROUTE_C, departureMs)
  const highOnC = formatMiles(c.exposure.miles.high)
  const severeOnA = formatMiles(a.exposure.miles.severe)
  const comparisons: Comparison[] = [
    {
      route_id: 'C',
      criterion: 'high_miles',
      text: `avoids the ${highOnC} of High-risk weather on Route C`,
      verdict: `${highOnC} of High-risk weather`,
    },
    {
      route_id: 'A',
      criterion: 'severe_miles',
      text: `avoids the ${severeOnA} of Severe weather on Route A`,
      verdict: `${severeOnA} of Severe weather`,
    },
  ]

  return {
    trip: { ...trip, departure },
    thresholds: THRESHOLDS,
    routes: [a, b, c],
    recommendation: {
      route_id: 'B',
      ranking: ['B', 'C', 'A'],
      reason: `Route B ${comparisons.map((comparison) => comparison.text).join(' and ')}.`,
      comparisons,
      warning: null,
    },
    heatmap_request: {
      corridor: [a, b, c].map((route) => route.geometry),
      anchors: [],
      departure,
      load_lb: trip.load_lb,
    },
    heatmap_layout: layoutFor(
      [a, b, c].map((route) => route.geometry),
      departure,
    ),
    notes: [],
    meta: {
      forecast_cells: 412,
      fetched_cells: 412,
      stale_since: null,
      timings_ms: { routing: 1830, forecast: 2410, total: 4390 },
    },
  }
}

const HOUR_MS = 3_600_000
const SCORE: Record<RiskLevel, number> = { low: 0, moderate: 1, high: 2, severe: 3, no_travel: 4 }

function buildRoute(spec: RouteSpec, departureMs: number): Route {
  const geometry = spec.stops.map((stop) => stop.at)
  const geometryMiles = cumulativeMiles(geometry)
  const distance = geometryMiles.at(-1) ?? 0
  const etaAt = (mile: number) => isoUtc(departureMs + (mile / spec.mph) * HOUR_MS)

  const checkpoints: Checkpoint[] = []
  const sections: RiskSection[] = []
  spec.stops.forEach(({ at: [lon, lat], reading }, i) => {
    if (!reading) return
    const mile = geometryMiles[i] ?? 0
    // Each checkpoint covers the road out to the stops on either side of it.
    const start = Math.max(i - 1, 0)
    const end = Math.min(i + 1, geometry.length - 1)
    const from = geometryMiles[start] ?? 0
    const to = geometryMiles[end] ?? 0
    checkpoints.push({
      index: checkpoints.length,
      mile: round(mile, 1),
      lat,
      lon,
      eta: etaAt(mile),
      stretch: [round(from, 1), round(to, 1)],
      ...reading,
    })
    const previous = sections.at(-1)
    if (previous?.level === reading.risk) {
      previous.to_mi = round(to, 2)
      previous.end = end
    } else {
      sections.push({
        level: reading.risk,
        from_mi: round(from, 2),
        to_mi: round(to, 2),
        start,
        end,
      })
    }
  })

  const miles: Record<RiskLevel, number> = { low: 0, moderate: 0, high: 0, severe: 0, no_travel: 0 }
  for (const section of sections) miles[section.level] += section.to_mi - section.from_mi
  let weightedMiles = 0
  for (const level of Object.keys(miles) as RiskLevel[]) {
    weightedMiles += SCORE[level] * miles[level]
    miles[level] = round(miles[level], 1)
  }

  return {
    id: spec.id,
    name: `Route ${spec.id}`,
    via: spec.via,
    router: 'Valhalla truck routing',
    rank: spec.rank,
    recommended: spec.rank === 1,
    distance_mi: round(distance, 1),
    duration_s: Math.round((distance / spec.mph) * 3600),
    arrival: etaAt(distance),
    exposure: { miles, average_risk: round(weightedMiles / distance, 2) },
    geometry,
    geometry_miles: geometryMiles,
    sections,
    checkpoints,
  }
}

/** Miles along the line at each vertex. */
function cumulativeMiles(points: LonLat[]): number[] {
  let total = 0
  return points.map((point, i) => {
    const previous = points[i - 1]
    if (previous) total += haversineMi(previous, point)
    return round(total, 3)
  })
}

function haversineMi([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const rad = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(a))
}

const round = (value: number, digits: number) => Number(value.toFixed(digits))

const formatMiles = (miles: number) => `${Math.round(miles)} mi`

/** "2026-10-16T13:00:00Z": UTC to the second, the way the API writes times. */
function isoUtc(ms: number): string {
  return new Date(Math.round(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}
