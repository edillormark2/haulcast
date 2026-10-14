export const HOUR_MS = 3_600_000

/** Hours between departure and a moment. */
export function hoursSince(departureMs: number, timeMs: number): number {
  return (timeMs - departureMs) / HOUR_MS
}

/**
 * A `datetime-local` value ("2026-10-16T06:00") for a moment, in the
 * viewer's time zone.
 */
export function toLocalInputValue(time: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}` +
    `T${pad(time.getHours())}:${pad(time.getMinutes())}`
  )
}

/** ISO 8601 with the viewer's UTC offset, e.g. "2026-10-16T06:00:00-05:00". */
export function toOffsetIso(time: Date): string {
  const offset = -time.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const pad = (value: number) => String(Math.floor(Math.abs(value))).padStart(2, '0')
  return `${toLocalInputValue(time)}:00${sign}${pad(offset / 60)}:${pad(offset % 60)}`
}

/** The next top of the hour after `time`. */
export function nextHour(time: Date): Date {
  const next = new Date(time)
  next.setMinutes(0, 0, 0)
  next.setHours(next.getHours() + 1)
  return next
}
