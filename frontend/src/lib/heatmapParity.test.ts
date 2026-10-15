import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parseForecast } from '../api/openMeteo'
import type { Factor, HeatmapLayout, Thresholds } from '../api/types'
import { heatmapFromForecasts, packFrames, samplesToFetch } from './heatmap'

/**
 * The server writes this fixture (backend/planner/tests/test_heatmap_parity.py):
 * a plan's heatmap layout, Open-Meteo's answers for every sample and the
 * texture the server packs from them. The browser must pack the same bytes.
 */
interface ParityCase {
  departure: string
  layout: HeatmapLayout
  open_meteo: unknown[]
  /** base64 RGBA: what POST /api/heatmap/ sends for the same forecasts. */
  texture: string
}

const FIXTURE = '../../../backend/planner/tests/fixtures/heatmap_parity.json'
const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, FIXTURE), 'utf8')) as {
  cases: ParityCase[]
}

const thresholds: Record<Factor, Thresholds> = {
  wind: { unit: 'mph', bounds: [25, 35, 45, 55], no_travel_inclusive: true },
  rain: { unit: 'in/hr', bounds: [0.1, 0.25, 0.5, 1], no_travel_inclusive: false },
  snow: { unit: 'in/hr', bounds: [0.5, 1, 2, 3], no_travel_inclusive: false },
}

const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

describe.each(fixture.cases)('the heatmap for a departure at $departure', (parity) => {
  const { layout } = parity
  const series = parity.open_meteo.map((answer) => parseForecast(answer, layout.forecast.start))
  const anchored = layout.samples.length - samplesToFetch(layout).length

  it('packs the same bytes as the server, from the same forecasts', () => {
    const startS = Date.parse(layout.start) / 1000
    const browser = packFrames(series, startS, layout.frames, layout.steps, thresholds)
    // The plan's frames for its anchors came from the server's packer.
    expect(anchored).toBeGreaterThan(0)
    expect(browser.subarray(0, bytes(layout.anchor_frames).length)).toEqual(
      bytes(layout.anchor_frames),
    )
    const heatmap = heatmapFromForecasts(layout, series.slice(anchored), thresholds)
    expect(heatmap.texels).toEqual(bytes(parity.texture))
  })

  it('fetches only the samples the plan has not packed', () => {
    expect(samplesToFetch(layout)).toEqual(layout.samples.slice(anchored))
  })
})
