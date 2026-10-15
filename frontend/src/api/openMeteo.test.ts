import { clearForecastCache, fetchForecasts, OpenMeteoError, parseForecast } from './openMeteo'

const start = Date.parse('2026-10-16T06:00:00Z') / 1000
const source = {
  url: 'https://api.open-meteo.com/v1/forecast',
  start,
  end: start + 2 * 3600,
}

/** Open-Meteo's hourly answer for one place: a list for several, an object for one. */
function answer(lat: number, lon: number, hourly: Record<string, unknown> = {}) {
  return {
    latitude: lat + 0.01,
    longitude: lon - 0.02,
    hourly: {
      time: [start, start + 3600, start + 7200],
      wind_speed_10m: [10, 12.5, 15],
      rain: [0, 0.1, 0.2],
      showers: [0, 0.2, 0],
      snowfall: [0, 0, 0.01],
      ...hourly,
    },
  }
}

function forecasts(url: URL): Response {
  const lats = url.searchParams.get('latitude')?.split(',') ?? []
  const lons = url.searchParams.get('longitude')?.split(',') ?? []
  const answers = lats.map((lat, i) => answer(Number(lat), Number(lons[i])))
  return Response.json(answers.length === 1 ? answers[0] : answers)
}

let requests: URL[] = []

function serve(reply: (url: URL) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input)
      requests.push(url)
      return Promise.resolve(reply(url))
    }),
  )
}

const locations = (url: URL) => url.searchParams.get('latitude')?.split(',').length ?? 0
const points = (count: number) =>
  Array.from({ length: count }, (_, i) => [-100 + i * 0.05, 35] as [number, number])

beforeEach(() => {
  clearForecastCache()
  requests = []
})
afterEach(() => vi.unstubAllGlobals())

describe('fetchForecasts', () => {
  it('asks like the server does, for the variables the heatmap draws', async () => {
    serve(forecasts)
    const [series] = await fetchForecasts(source, [[-96.8, 32.75]])
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      latitude: '32.7500',
      longitude: '-96.8000',
      hourly: 'wind_speed_10m,rain,showers,snowfall',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
      timeformat: 'unixtime',
      timezone: 'GMT',
      start_hour: '2026-10-16T06:00',
      end_hour: '2026-10-16T08:00',
    })
    // Rain is rain plus showers, added as the server adds them.
    expect(series).toEqual({
      start,
      windMph: [10, 12.5, 15],
      rainIn: [0, 0.1 + 0.2, 0.2],
      snowIn: [0, 0, 0.01],
    })
  })

  it('sends 150 places per request, two requests at a time', async () => {
    let inFlight = 0
    let most = 0
    serve(async (url) => {
      most = Math.max(most, ++inFlight)
      await new Promise((settle) => setTimeout(settle, 5))
      inFlight--
      return forecasts(url)
    })
    const series = await fetchForecasts(source, points(400))
    expect(requests.map(locations)).toEqual([150, 150, 100])
    expect(most).toBe(2)
    expect(series).toHaveLength(400)
  })

  it('reuses forecasts it has, and fetches only the new places', async () => {
    serve(forecasts)
    await fetchForecasts(source, points(3))
    await fetchForecasts(source, points(5))
    expect(requests.map(locations)).toEqual([3, 2])
    await fetchForecasts(source, points(5))
    expect(requests).toHaveLength(2)
    // Another window is another forecast.
    await fetchForecasts({ ...source, end: source.end + 3600 }, points(1))
    expect(requests).toHaveLength(3)
  })

  it("passes on a refusal with Open-Meteo's reason, and sends nothing more", async () => {
    serve(() =>
      Response.json(
        {
          error: true,
          reason: 'Minutely API request limit exceeded. Please try again in one minute.',
        },
        { status: 429 },
      ),
    )
    const refusal = fetchForecasts(source, points(400))
    await expect(refusal).rejects.toThrow(/^Minutely API request limit exceeded/)
    await expect(refusal).rejects.toMatchObject({ status: 429 })
    expect(requests).toHaveLength(2)
  })

  it('says when Open-Meteo is out of reach', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    await expect(fetchForecasts(source, points(1))).rejects.toThrow(OpenMeteoError)
  })
})

describe('parseForecast', () => {
  it('rejects a forecast for other hours, or with gaps', () => {
    expect(() => parseForecast(answer(35, -100), start + 3600)).toThrow(/window/)
    const gap = answer(35, -100, { time: [start, start + 3600, start + 3 * 3600] })
    expect(() => parseForecast(gap, start)).toThrow(/contiguous/)
  })

  it('rejects missing values', () => {
    const missing = answer(35, -100, { snowfall: [0, null, 0.01] })
    expect(() => parseForecast(missing, start)).toThrow(/snowfall/)
    expect(() => parseForecast({ error: true }, start)).toThrow(OpenMeteoError)
  })
})
