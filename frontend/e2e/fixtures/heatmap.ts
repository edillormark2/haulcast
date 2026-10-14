import type { HeatmapPayload, HeatmapRequest } from '../../src/api/types'
import { THRESHOLDS } from './rules'

const COLUMNS = 4
const ROWS = 4
/** Departure plus 48 hours. */
const FRAMES = 49
/** Physical value of one byte step, as the API defines them. */
const STEPS = { wind: 0.5, rain: 0.01, snow: 0.02 }

/**
 * POST /api/heatmap/: a 4×4 grid over the corridor with 49 hourly frames of
 * [wind, rain, snow, corridor weight] bytes, in which a band of rain drifts
 * east across the trip over the two days.
 */
export function heatmapFor(request: HeatmapRequest): HeatmapPayload {
  const points = request.corridor.flat()
  const lons = points.map(([lon]) => lon)
  const lats = points.map(([, lat]) => lat)

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
    grid: {
      west: Math.min(...lons),
      south: Math.min(...lats),
      east: Math.max(...lons),
      north: Math.max(...lats),
      columns: COLUMNS,
      rows: ROWS,
    },
    start: request.departure,
    frames: FRAMES,
    steps: STEPS,
    thresholds: THRESHOLDS,
    data: Buffer.from(bytes).toString('base64'),
    meta: { forecast_cells: COLUMNS * ROWS, timings_ms: { forecast: 620, total: 655 } },
  }
}
