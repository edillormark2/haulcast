import {
  formatClock,
  formatDuration,
  formatHour,
  formatMiles,
  shortPlace,
  timeZoneLabel,
} from './format'
import { toOffsetIso } from './time'

describe('clock times', () => {
  // Local wall times, so the tests hold in whatever zone they run.
  const morning = new Date(2026, 9, 16, 6, 30)
  const afternoon = new Date(2026, 9, 16, 15)

  it("name the viewer's time zone", () => {
    const zone = timeZoneLabel(morning)
    expect(zone).toMatch(/^([A-Z]{2,5}|GMT[+-]\d{1,2}(:\d{2})?)$/)
    expect(formatClock(morning)).toBe(`Fri 6:30 AM ${zone}`)
    expect(formatHour(afternoon)).toBe(`Fri 3 PM ${timeZoneLabel(afternoon)}`)
  })

  it('leave the zone out for a list that names it once', () => {
    expect(formatClock(morning, { zone: false })).toBe('Fri 6:30 AM')
  })
})

describe('formatDuration', () => {
  it.each([
    [45 * 60, '45 min'],
    [2 * 3600, '2 h'],
    [15 * 3600 + 42 * 60, '15 h 42 min'],
  ])('formats %i seconds as %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text)
  })
})

describe('formatMiles', () => {
  it('rounds and groups thousands', () => {
    expect(formatMiles(1015.4)).toBe('1,015 mi')
  })
})

describe('shortPlace', () => {
  it('drops a trailing country code', () => {
    expect(shortPlace('Denver, Colorado, US')).toBe('Denver, Colorado')
    expect(shortPlace('Denver')).toBe('Denver')
  })
})

describe('toOffsetIso', () => {
  it('keeps the local wall time and states the offset', () => {
    const iso = toOffsetIso(new Date(2026, 9, 16, 6, 30))
    expect(iso.startsWith('2026-10-16T06:30:00')).toBe(true)
    expect(Date.parse(iso)).toBe(new Date(2026, 9, 16, 6, 30).getTime())
  })
})
