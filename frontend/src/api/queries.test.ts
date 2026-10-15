import { ApiError } from './client'
import { busyRetry, retryDelay, shouldRetry } from './queries'

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
