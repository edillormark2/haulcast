import type { HeatmapLayout, HeatmapPayload, HeatmapRequest } from '../../src/api/types'
import type { HourlySeries } from '../../src/lib/forecast'
import { packFrames } from '../../src/lib/heatmap'
import { THRESHOLDS } from './rules'

type LonLat = [number, number]

const COLUMNS = 4
const ROWS = 4
/** Departure plus 48 hours. */
const FRAMES = 49
/** Physical value of one byte step, as the API defines them. */
const STEPS = { wind: 0.5, rain: 0.01, snow: 0.02 }
const HOUR_S = 3600
/** Forecast windows start on 6-hour UTC blocks and run 60 hours, as the API's do. */
const BLOCK_S = 6 * HOUR_S
const WINDOW_HOURS = 60
/** Samples the plan packs itself: the grid's southern row. */
const ANCHORED = COLUMNS

/** Open-Meteo's forecast endpoint, as plans name it. */
export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

/**
 * POST /api/heatmap/, the server fallback: a 4×4 grid over the corridor with
 * 49 hourly frames of [wind, rain, snow, corridor weight] bytes, in which a
 * band of rain drifts east across the trip over the two days.
 */
export function heatmapFor(request: HeatmapRequest): HeatmapPayload {
  const bytes = new Uint8Array(FRAMES * ROWS * COLUMNS * 4)
  for (let frame = 0; frame < FRAMES; frame++) {
    const front = (frame / (FRAMES - 1)) * (COLUMNS - 1)
    for (let row = 0; row < ROWS; row++) {
      for (let column = 0; column < COLUMNS; column++) {
        const rain = Math.max(0, 0.3 - 0.2 * Math.abs(column - front))
        const wind = 10 + 40 * rain
        const offset = ((frame * ROWS + row) * COLUMNS + column) * 4
        bytes.set([Math.round(wind / STEPS.wind), Math.round(rain / STEPS.rain), 0, 255], offset)
      }
    }
  }

  return {
    grid: gridOver(request.corridor),
    start: request.departure,
    frames: FRAMES,
    steps: STEPS,
    thresholds: THRESHOLDS,
    data: Buffer.from(bytes).toString('base64'),
    meta: {
      forecast_cells: COLUMNS * ROWS,
      fetched_cells: COLUMNS * ROWS,
      stale_since: null,
      timings_ms: { forecast: 620, total: 655 },
    },
  }
}

/**
 * A plan's heatmap_layout: the same 4×4 grid, every cell in the corridor
 * and read at its centre. The plan has packed the southern row from its own
 * checkpoints; the browser fetches the other 12 cells from Open-Meteo.
 */
export function layoutFor(corridor: LonLat[][], departure: string): HeatmapLayout {
  const grid = gridOver(corridor)
  const samples: LonLat[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      samples.push([
        round4(grid.west + (column * (grid.east - grid.west)) / (COLUMNS - 1)),
        round4(grid.south + (row * (grid.north - grid.south)) / (ROWS - 1)),
      ])
    }
  }
  const startS = Date.parse(departure) / 1000
  const windowStart = Math.floor(startS / BLOCK_S) * BLOCK_S
  const window = { start: windowStart, end: windowStart + WINDOW_HOURS * HOUR_S }
  const planned = samples.slice(0, ANCHORED).map(([lon]) => weatherAt(lon, window))

  return {
    grid,
    start: departure,
    frames: FRAMES,
    steps: STEPS,
    alpha: Buffer.from(new Uint8Array(COLUMNS * ROWS).fill(255)).toString('base64'),
    sources: samples.map((_, i) => i),
    samples,
    anchor_frames: Buffer.from(packFrames(planned, startS, FRAMES, STEPS)).toString('base64'),
    forecast: { url: OPEN_METEO_URL, ...window },
  }
}

/** GET Open-Meteo's forecast: the hourly weather at every point the URL asks for. */
export function openMeteoFor(url: URL): unknown[] {
  const lats = url.searchParams.get('latitude')?.split(',') ?? []
  const lons = url.searchParams.get('longitude')?.split(',') ?? []
  const hour = (name: string) => Date.parse(`${url.searchParams.get(name) ?? ''}Z`) / 1000
  const window = { start: hour('start_hour'), end: hour('end_hour') }
  return lons.map((lon, i) => {
    const weather = weatherAt(Number(lon), window)
    const hours = weather.windMph.length
    return {
      latitude: Number(lats[i]),
      longitude: Number(lon),
      hourly: {
        time: Array.from({ length: hours }, (_, h) => window.start + h * HOUR_S),
        wind_speed_10m: weather.windMph,
        rain: weather.rainIn,
        showers: new Array<number>(hours).fill(0),
        snowfall: weather.snowIn,
      },
    }
  })
}

/** A band of rain drifting east, from Dallas to Atlanta, over the window's two days. */
function weatherAt(lon: number, window: { start: number; end: number }): HourlySeries {
  const hours = (window.end - window.start) / HOUR_S + 1
  const rain = Array.from({ length: hours }, (_, h) => {
    const front = -97 + (h / (FRAMES - 1)) * 12.6
    return Math.round(Math.max(0, 0.3 - 0.05 * Math.abs(lon - front)) * 1000) / 1000
  })
  return {
    start: window.start,
    windMph: rain.map((value) => Math.round((10 + 40 * value) * 10) / 10),
    rainIn: rain,
    snowIn: new Array<number>(hours).fill(0),
  }
}

function gridOver(corridor: LonLat[][]): HeatmapPayload['grid'] {
  const points = corridor.flat()
  const lons = points.map(([lon]) => lon)
  const lats = points.map(([, lat]) => lat)
  return {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
    columns: COLUMNS,
    rows: ROWS,
  }
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000
