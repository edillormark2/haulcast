const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function formatMiles(miles: number): string {
  return `${integer.format(miles)} mi`
}

export function formatPounds(pounds: number): string {
  return `${integer.format(pounds)} lb`
}

/** 56_520 s → "15 h 42 min". */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

const clock = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})
const hourOnly = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric' })
const zoneName = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })

/**
 * "Tue 3:40 PM CDT": in the viewer's time zone, which it names, because a trip
 * often crosses zones and the viewer may be in another one. A list that names
 * the zone once in its heading passes `zone: false`.
 */
export function formatClock(time: Date | number, { zone = true } = {}): string {
  const text = clock.format(time)
  return zone ? `${text} ${timeZoneLabel(time)}` : text
}

/** "Tue 3 PM CDT". */
export function formatHour(time: Date | number): string {
  return `${hourOnly.format(time)} ${timeZoneLabel(time)}`
}

/** The viewer's time zone at that moment: "CDT", "MST", or "GMT+8" outside North America. */
export function timeZoneLabel(time: Date | number): string {
  return zoneName.formatToParts(time).find((part) => part.type === 'timeZoneName')?.value ?? ''
}

/** "Chicago, Illinois, US" → "Chicago, Illinois". Drops a trailing country code. */
export function shortPlace(label: string): string {
  return label.replace(/,\s*[A-Z]{2}$/, '')
}
