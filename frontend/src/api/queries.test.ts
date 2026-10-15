import { ApiError } from './client'
import { clearForecastCache } from './openMeteo'
import { busyRetry, loadHeatmap, retryDelay, shouldRetry } from './queries'
import type { HeatmapPayload, Plan } from './types'

function busy(retryAfter: number | null, code = 'upstream_busy') {
  return new ApiError(code === 'rate_limited' ? 429 : 503, {
    code,
    message: 'Open-Meteo is busy right now. Try again in a minute.',
    service: code === 'rate_limited' ? undefined : 'Open-Meteo',
    retry_after: retryAfter,
  })
}

describe('retry policy', () => {
  it('retries a busy service three times, each after the wait it asks for', () => {
    expect([0, 1, 2, 3].map((failures) => shouldRetry(failures, busy(20)))).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(retryDelay(1, busy(20))).toBe(20_000)
  })

  it('assumes a short wait when a busy service gives none', () => {
    expect(shouldRetry(0, busy(null))).toBe(true)
    expect(retryDelay(0, busy(null))).toBe(20_000)
  })

  it('leaves a used-up quota to the user', () => {
    expect(shouldRetry(0, busy(25 * 60))).toBe(false)
  })

  it("waits out the server's own rate limit too", () => {
    expect(shouldRetry(0, busy(7, 'rate_limited'))).toBe(true)
    expect(retryDelay(0, busy(7, 'rate_limited'))).toBe(7_000)
  })

  it('retries network and gateway errors once, straight away', () => {
    const gateway = new ApiError(502, { code: 'upstream_error', message: 'OSRM failed.' })
    expect([0, 1].map((failures) => shouldRetry(failures, gateway))).toEqual([true, false])
    expect(retryDelay(0, gateway)).toBe(1_000)
  })

  it('never retries a request the server rejected', () => {
    const invalid = new ApiError(400, { code: 'invalid_request', message: 'Fix the trip.' })
    expect(shouldRetry(0, invalid)).toBe(false)
    expect(shouldRetry(0, new Error('Boom'))).toBe(false)
  })
})

describe('busyRetry', () => {
  it('describes the retry a busy query is waiting for', () => {
    expect(busyRetry({ failureReason: busy(20), failureCount: 2, isFetching: true })).toEqual({
      service: 'Open-Meteo',
      waitS: 20,
      attempt: 2,
    })
    expect(
      busyRetry({ failureReason: busy(7, 'rate_limited'), failureCount: 1, isFetching: true }),
    ).toMatchObject({ service: 'Haulcast', waitS: 7 })
  })

  it('is null once the query gives up, and for other failures', () => {
    expect(busyRetry({ failureReason: busy(20), failureCount: 4, isFetching: false })).toBeNull()
    const gateway = new ApiError(502, { code: 'upstream_error', message: 'OSRM failed.' })
    expect(busyRetry({ failureReason: gateway, failureCount: 1, isFetching: true })).toBeNull()
  })
})

describe('loadHeatmap', () => {
  const start = Date.parse('2026-10-16T06:00:00Z') / 1000
  const grid = { west: -97, south: 32, east: -96, north: 33, columns: 1, rows: 1 }
  const steps = { wind: 0.5, rain: 0.01, snow: 0.02 }
  const thresholds = {
    wind: { unit: 'mph', bounds: [25, 35, 45, 55], no_travel_inclusive: true },
    rain: { unit: 'in/hr', bounds: [0.1, 0.25, 0.5, 1], no_travel_inclusive: false },
    snow: { unit: 'in/hr', bounds: [0.5, 1, 2, 3], no_travel_inclusive: false },
  } satisfies Plan['thresholds']
  /** One cell, read at one place the plan didn't pack, over two hourly frames. */
  const plan = {
    thresholds,
    heatmap_request: { corridor: [], anchors: [], departure: '2026-10-16T06:00:00Z', load_lb: 0 },
    heatmap_layout: {
      grid,
      start: '2026-10-16T06:00:00Z',
      frames: 2,
      steps,
      alpha: btoa(String.fromCharCode(255)),
      sources: [0],
      samples: [[-96.5, 32.5]],
      anchor_frames: '',
      forecast: { url: 'https://api.open-meteo.com/v1/forecast', start, end: start + 2 * 3600 },
    },
  } as unknown as Plan
  const fromOpenMeteo = {
    hourly: {
      time: [start, start + 3600, start + 7200],
      wind_speed_10m: [20, 30, 40],
      rain: [0, 0.12, 0.3],
      showers: [0, 0, 0],
      snowfall: [0, 0, 0],
    },
  }
  const fromServer: HeatmapPayload = {
    grid,
    start: '2026-10-16T06:00:00Z',
    frames: 2,
    steps,
    thresholds,
    data: btoa(String.fromCharCode(1, 2, 3, 255, 4, 5, 6, 255)),
    meta: { forecast_cells: 1, fetched_cells: 1, stale_since: null, timings_ms: {} },
  }

  let calls: string[] = []
  function serve(
    openMeteo: () => Response,
    server: () => Response = () => Response.json(fromServer),
  ) {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        calls.push(input.startsWith('/api/') ? input : new URL(input).origin)
        return Promise.resolve(input.startsWith('/api/') ? server() : openMeteo())
      }),
    )
  }

  beforeEach(() => {
    clearForecastCache()
    calls = []
  })
  afterEach(() => vi.unstubAllGlobals())

  it('builds the heatmap in the browser, without the server', async () => {
    serve(() => Response.json(fromOpenMeteo))
    const heatmap = await loadHeatmap(plan)
    // 20 then 30 mph in 0.5 mph steps; 0.12 then 0.30 in/hr in 0.01 steps.
    expect(Array.from(heatmap.texels)).toEqual([40, 12, 0, 255, 60, 30, 0, 255])
    expect(calls).toEqual(['https://api.open-meteo.com'])
  })

  it("asks the server when the browser can't get the forecasts", async () => {
    serve(() =>
      Response.json({ error: true, reason: 'Daily API request limit exceeded.' }, { status: 429 }),
    )
    const heatmap = await loadHeatmap(plan)
    expect(Array.from(heatmap.texels)).toEqual([1, 2, 3, 255, 4, 5, 6, 255])
    expect(calls).toEqual(['https://api.open-meteo.com', '/api/heatmap/'])
  })

  it('passes on a busy server, so the query waits it out and tries again', async () => {
    serve(
      () => Response.json({}, { status: 500 }),
      () =>
        Response.json(
          {
            error: {
              code: 'upstream_busy',
              message: 'Open-Meteo is busy right now. Try again in a minute.',
              service: 'Open-Meteo',
              retry_after: 20,
            },
          },
          { status: 503 },
        ),
    )
    const failure = loadHeatmap(plan)
    await expect(failure).rejects.toBeInstanceOf(ApiError)
    await expect(failure).rejects.toMatchObject({ busy: true, retryAfter: 20 })
  })
})
