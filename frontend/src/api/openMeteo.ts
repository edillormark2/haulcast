import type { HourlySeries } from '../lib/forecast'
import { HOUR_MS } from '../lib/time'
import type { ForecastSource } from './types'

/**
 * Open-Meteo's forecasts, fetched by the browser for the heatmap, so they
 * come out of the viewer's free quota (600 calls a minute, 5,000 an hour and
 * 10,000 a day per IP; one call per location) rather than the server's. The
 * requests and checks follow backend/planner/integrations/open_meteo.py.
 */

/** Gusts aren't drawn, so unlike the server the browser doesn't ask for them. */
const HOURLY = ['wind_speed_10m', 'rain', 'showers', 'snowfall'] as const
/** About a 3.5 KB URL; Open-Meteo rejects URLs past ~8 KB. */
const MAX_LOCATIONS_PER_REQUEST = 150
/**
 * Open-Meteo runs one request per IP at a time and queues the rest (refusing
 * past five), so a second request only overlaps the transfer.
 */
const PARALLEL_REQUESTS = 2
const TIMEOUT_MS = 20_000
/** Forecast models update hourly; half an hour keeps forecasts reasonably fresh. */
const FRESH_MS = 30 * 60_000
const CACHE_LIMIT = 2_000
const HOUR_S = HOUR_MS / 1000

export class OpenMeteoError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OpenMeteoError'
    this.status = status
  }
}

/**
 * Forecasts already fetched, by window and point: the same trip at a later
 * departure in the same 6-hour block, or another trip through the same cells,
 * packs them again without new calls.
 */
const cache = new Map<string, { fetchedAt: number; series: HourlySeries }>()

type LonLat = readonly [number, number]

/** Hourly series over `source`'s window for each [lon, lat] point, in order. */
export async function fetchForecasts(
  source: ForecastSource,
  points: readonly LonLat[],
): Promise<HourlySeries[]> {
  const now = Date.now()
  const keyOf = ([lon, lat]: LonLat) => `${source.url}|${source.start}|${source.end}|${lon},${lat}`
  const found = new Map<string, HourlySeries>()
  const missing = new Map<string, LonLat>()
  for (const point of points) {
    const key = keyOf(point)
    const entry = cache.get(key)
    if (entry && now - entry.fetchedAt < FRESH_MS) found.set(key, entry.series)
    else missing.set(key, point)
  }
  const pending = [...missing]
  const batches: (typeof pending)[] = []
  for (let i = 0; i < pending.length; i += MAX_LOCATIONS_PER_REQUEST) {
    batches.push(pending.slice(i, i + MAX_LOCATIONS_PER_REQUEST))
  }

  // Batches run two at a time. After a failure the ones not yet sent are
  // dropped, since a refusal would refuse them too; the ones that arrived stay cached.
  let failed = false
  const worker = async () => {
    for (let batch = batches.shift(); batch && !failed; batch = batches.shift()) {
      try {
        const series = await fetchBatch(
          source,
          batch.map(([, point]) => point),
        )
        batch.forEach(([key], i) => {
          const one = series[i]
          if (!one) return
          found.set(key, one)
          remember(key, one, now)
        })
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL_REQUESTS }, worker))

  return points.map((point) => {
    const series = found.get(keyOf(point))
    if (!series) throw new OpenMeteoError('Open-Meteo sent no forecast for a point')
    return series
  })
}

/** Forgets every cached forecast (for tests). */
export function clearForecastCache(): void {
  cache.clear()
}

function remember(key: string, series: HourlySeries, fetchedAt: number) {
  cache.delete(key)
  cache.set(key, { fetchedAt, series })
  // Maps keep insertion order, so the first keys are the oldest.
  for (const old of cache.keys()) {
    if (cache.size <= CACHE_LIMIT) break
    cache.delete(old)
  }
}

async function fetchBatch(
  source: ForecastSource,
  points: readonly LonLat[],
): Promise<HourlySeries[]> {
  const params = new URLSearchParams({
    latitude: points.map(([, lat]) => lat.toFixed(4)).join(','),
    longitude: points.map(([lon]) => lon.toFixed(4)).join(','),
    hourly: HOURLY.join(','),
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch', // also switches snowfall to inches
    timeformat: 'unixtime',
    timezone: 'GMT',
    start_hour: isoHour(source.start),
    end_hour: isoHour(source.end),
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await fetch(`${source.url}?${params}`, { signal: controller.signal })
    } catch {
      throw new OpenMeteoError("Can't reach Open-Meteo")
    }
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      // Open-Meteo says which limit ran out, e.g. "Minutely API request limit exceeded."
      const reason = isRecord(body) && typeof body.reason === 'string' ? body.reason : undefined
      throw new OpenMeteoError(reason ?? `HTTP ${response.status}`, response.status)
    }
    const answers = Array.isArray(body) ? body : [body]
    if (answers.length !== points.length) {
      throw new OpenMeteoError(
        `Open-Meteo returned ${answers.length} locations for ${points.length}`,
      )
    }
    return answers.map((answer) => parseForecast(answer, source.start))
  } finally {
    clearTimeout(timer)
  }
}

/** One location of an Open-Meteo answer, checked like the server checks it. */
export function parseForecast(answer: unknown, start: number): HourlySeries {
  const hourly = isRecord(answer) ? answer.hourly : undefined
  if (!isRecord(hourly)) throw new OpenMeteoError('Open-Meteo sent no hourly forecast')
  const times = numbers(hourly.time)
  if (times?.[0] !== start) {
    throw new OpenMeteoError("Open-Meteo's forecast window doesn't match the request")
  }
  if (times.some((time, i) => i > 0 && time - (times[i - 1] ?? 0) !== HOUR_S)) {
    throw new OpenMeteoError("Open-Meteo's forecast hours aren't contiguous")
  }
  const column = (name: (typeof HOURLY)[number]) => {
    const values = numbers(hourly[name])
    if (values?.length !== times.length) {
      throw new OpenMeteoError(`Open-Meteo's forecast is missing ${name} values`)
    }
    return values
  }
  const rain = column('rain')
  const showers = column('showers')
  return {
    start,
    windMph: column('wind_speed_10m'),
    // Large-scale rain and convective showers are both liquid precipitation.
    rainIn: rain.map((value, i) => value + (showers[i] ?? 0)),
    snowIn: column('snowfall'),
  }
}

function numbers(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'number') ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** "2026-10-16T06:00": an hour in UTC, as Open-Meteo's start_hour wants it. */
function isoHour(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 16)
}
