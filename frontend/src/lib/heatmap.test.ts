import type { Factor, Thresholds } from '../api/types'
import { decodeHeatmap, frameAt, type HeatmapData, sampleHeatmap } from './heatmap'

const thresholds: Record<Factor, Thresholds> = {
  wind: { unit: 'mph', bounds: [25, 35, 45, 55], no_travel_inclusive: true },
  rain: { unit: 'in/hr', bounds: [0.1, 0.25, 0.5, 1], no_travel_inclusive: false },
  snow: { unit: 'in/hr', bounds: [0.5, 1, 2, 3], no_travel_inclusive: false },
}

/** A 4×4 grid over lon 0–3, lat 0–3 with two hourly frames. */
function grid(wind: (column: number, row: number, frame: number) => number, corridor = 255) {
  const columns = 4
  const rows = 4
  const frames = 2
  const texels = new Uint8Array(frames * rows * columns * 4)
  for (let frame = 0; frame < frames; frame++) {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const offset = ((frame * rows + row) * columns + column) * 4
        texels.set([wind(column, row, frame), 10, 0, corridor], offset)
      }
    }
  }
  const data: HeatmapData = {
    grid: { west: 0, south: 0, east: 3, north: 3, columns, rows },
    startMs: 0,
    frames,
    steps: { wind: 0.5, rain: 0.01, snow: 0.02 },
    thresholds,
    texels,
  }
  return data
}

describe('sampleHeatmap', () => {
  it('returns the exact forecast at a cell centre', () => {
    const data = grid((column, row) => 20 + column * 10 + row)
    const sample = sampleHeatmap(data, 2, 1, 0)
    expect(sample?.wind).toBeCloseTo((20 + 2 * 10 + 1) * 0.5)
    expect(sample?.rain).toBeCloseTo(0.1)
  })

  it('blends linearly between hours', () => {
    const data = grid((_, __, frame) => (frame === 0 ? 40 : 80))
    expect(sampleHeatmap(data, 1.5, 1.5, 0.25)?.wind).toBeCloseTo(50 * 0.5)
  })

  it('never overshoots the nearest cells', () => {
    // A sharp step: Catmull-Rom alone would ring past 100 next to the edge.
    const data = grid((column) => (column >= 2 ? 100 : 0))
    const sample = sampleHeatmap(data, 1.9, 1.5, 0)
    expect(sample?.wind).toBeLessThanOrEqual(50)
    expect(sample?.wind).toBeGreaterThanOrEqual(0)
  })

  it('returns null outside the corridor or the grid', () => {
    expect(
      sampleHeatmap(
        grid(() => 50, 0),
        1,
        1,
        0,
      ),
    ).toBeNull()
    expect(
      sampleHeatmap(
        grid(() => 50),
        -1,
        1,
        0,
      ),
    ).toBeNull()
  })
})

describe('decodeHeatmap and frameAt', () => {
  it('decodes the base64 texels and maps time to frames', () => {
    const data = decodeHeatmap({
      grid: { west: 0, south: 0, east: 1, north: 1, columns: 1, rows: 1 },
      start: '2026-10-16T12:00:00Z',
      frames: 3,
      steps: { wind: 0.5, rain: 0.01, snow: 0.02 },
      thresholds,
      data: btoa(String.fromCharCode(1, 2, 3, 4)),
      meta: { forecast_cells: 1, timings_ms: {} },
    })
    expect(Array.from(data.texels)).toEqual([1, 2, 3, 4])
    expect(frameAt(data, Date.parse('2026-10-16T13:30:00Z'))).toBe(1.5)
    expect(frameAt(data, Date.parse('2026-10-17T00:00:00Z'))).toBe(2)
  })
})
