import type { Factor, HeatmapMetric, HeatmapPayload, Thresholds } from '../api/types'
import { HOUR_MS } from './time'

export const HEATMAP_METRICS: readonly HeatmapMetric[] = ['risk', 'wind', 'rain', 'snow']

export interface HeatmapGrid {
  west: number
  south: number
  east: number
  north: number
  columns: number
  rows: number
}

export interface HeatmapData {
  grid: HeatmapGrid
  /** Epoch ms of frame 0 (departure); frame k is k hours later. */
  startMs: number
  frames: number
  steps: Record<Factor, number>
  thresholds: Record<Factor, Thresholds>
  /** frames × rows (south first) × columns × RGBA: wind, rain, snow, corridor weight. */
  texels: Uint8Array
}

export function decodeHeatmap(payload: HeatmapPayload): HeatmapData {
  return {
    grid: payload.grid,
    startMs: Date.parse(payload.start),
    frames: payload.frames,
    steps: payload.steps,
    thresholds: payload.thresholds,
    texels: base64ToBytes(payload.data),
  }
}

/** Fractional frame for a moment, clamped to the data. */
export function frameAt(data: HeatmapData, timeMs: number): number {
  return Math.min(Math.max((timeMs - data.startMs) / HOUR_MS, 0), data.frames - 1)
}

export type WeatherSample = Record<Factor, number>

/**
 * Weather at a point and fractional frame, computed exactly as the WebGL
 * layer draws it: each cell blended between the two surrounding hours, then a
 * Catmull-Rom interpolation across the 4×4 nearest cells, clamped to the four
 * nearest. Null outside the corridor.
 */
export function sampleHeatmap(
  data: HeatmapData,
  lon: number,
  lat: number,
  frame: number,
): WeatherSample | null {
  const { grid } = data
  const x = ((lon - grid.west) / (grid.east - grid.west)) * (grid.columns - 1)
  const y = ((lat - grid.south) / (grid.north - grid.south)) * (grid.rows - 1)
  if (!(x >= 0 && y >= 0 && x <= grid.columns - 1 && y <= grid.rows - 1)) return null

  const f0 = Math.min(Math.floor(frame), data.frames - 1)
  const f1 = Math.min(f0 + 1, data.frames - 1)
  const tf = frame - f0
  const texel = (column: number, row: number, channel: number) => {
    const c = Math.min(Math.max(column, 0), grid.columns - 1)
    const r = Math.min(Math.max(row, 0), grid.rows - 1)
    const at = (f: number) =>
      data.texels[((f * grid.rows + r) * grid.columns + c) * 4 + channel] ?? 0
    return at(f0) + (at(f1) - at(f0)) * tf
  }

  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const wx = catmullRomWeights(x - x0)
  const wy = catmullRomWeights(y - y0)
  const channels = [0, 1, 2, 3].map((channel) => {
    let sum = 0
    let lo = Infinity
    let hi = -Infinity
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const value = texel(x0 + i - 1, y0 + j - 1, channel)
        sum += value * (wx[i] ?? 0) * (wy[j] ?? 0)
        if (i >= 1 && i <= 2 && j >= 1 && j <= 2) {
          lo = Math.min(lo, value)
          hi = Math.max(hi, value)
        }
      }
    }
    return Math.min(Math.max(sum, lo), hi)
  })

  const [wind = 0, rain = 0, snow = 0, corridor = 0] = channels
  if (corridor < 128) return null
  return {
    wind: wind * data.steps.wind,
    rain: rain * data.steps.rain,
    snow: snow * data.steps.snow,
  }
}

function catmullRomWeights(t: number): [number, number, number, number] {
  const t2 = t * t
  const t3 = t2 * t
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2,
  ]
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
