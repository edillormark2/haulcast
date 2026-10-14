import type { RiskLevel } from '../lib/risk'

export type Factor = 'wind' | 'rain' | 'snow'
export type HeatmapMetric = 'risk' | Factor
export type CheckpointInterval = 10 | 25 | 50
export type Criterion =
  'no_travel_miles' | 'severe_miles' | 'high_miles' | 'average_risk' | 'travel_time'

export interface Place {
  label: string
  lat: number
  lon: number
}

export interface PlaceSuggestion extends Place {
  name: string
  detail: string
  kind: string
}

export interface TripRequest {
  origin: Place
  destination: Place
  /** ISO 8601 with offset. */
  departure: string
  load_lb: number
  interval_mi: CheckpointInterval
}

export interface Checkpoint {
  index: number
  mile: number
  lat: number
  lon: number
  eta: string
  /** [from, to] miles of road this checkpoint represents. */
  stretch: [number, number]
  risk: RiskLevel
  factors: Record<Factor, RiskLevel>
  drivers: Factor[]
  load_rule: string | null
  reason: string
  weather: {
    wind_mph: number
    gust_mph: number
    rain_in_hr: number
    snow_in_hr: number
  }
}

export interface RiskSection {
  level: RiskLevel
  from_mi: number
  to_mi: number
  /** Index range into the route's geometry, inclusive. */
  start: number
  end: number
}

export interface Route {
  id: string
  name: string
  via: string
  router: string
  rank: number
  recommended: boolean
  distance_mi: number
  duration_s: number
  arrival: string
  exposure: {
    miles: Record<RiskLevel, number>
    average_risk: number
  }
  /** [lon, lat] pairs. */
  geometry: [number, number][]
  /** Mile marker of each geometry point. */
  geometry_miles: number[]
  sections: RiskSection[]
  checkpoints: Checkpoint[]
}

export interface Comparison {
  route_id: string
  criterion: Criterion | null
  /** Completes "<recommended route> …". */
  text: string
  /** Why this route lost, from its own point of view. */
  verdict: string
}

/** Lower bounds of Moderate, High, Severe and No Travel for one factor. */
export interface Thresholds {
  unit: string
  bounds: [number, number, number, number]
  /** Whether a value equal to the No Travel bound is No Travel (≥) or Severe (>). */
  no_travel_inclusive: boolean
}

export interface HeatmapRequest {
  corridor: [number, number][][]
  departure: string
  load_lb: number
}

export interface Plan {
  trip: TripRequest
  /** Bands for this trip's load: wind already includes the load rules. */
  thresholds: Record<Factor, Thresholds>
  routes: Route[]
  recommendation: {
    route_id: string
    ranking: string[]
    reason: string
    comparisons: Comparison[]
    warning: string | null
  }
  heatmap_request: HeatmapRequest
  notes: string[]
  meta: {
    forecast_cells: number
    timings_ms: Record<string, number>
  }
}

export interface HeatmapPayload {
  grid: {
    west: number
    south: number
    east: number
    north: number
    columns: number
    rows: number
  }
  /** Time of frame 0 (the departure); frame k is k hours later. */
  start: string
  frames: number
  /** Physical value of one byte step per channel. */
  steps: Record<Factor, number>
  thresholds: Record<Factor, Thresholds>
  /** base64 RGBA bytes: frames × rows × columns × [wind, rain, snow, corridor weight]. */
  data: string
  meta: { forecast_cells: number; timings_ms: Record<string, number> }
}

export interface RiskRules {
  levels: { value: number; slug: RiskLevel; label: string }[]
  factors: Record<Factor, Thresholds>
  load_rules: {
    min_wind_mph: number
    max_wind_mph: number | null
    heavier_than_lb: number | null
    level: RiskLevel
    description: string
  }[]
  recommendation_order: Criterion[]
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    fields?: Record<string, unknown>
    retry_after?: number
  }
}
