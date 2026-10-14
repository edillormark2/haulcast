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
const clockWithZone = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})
const hourOnly = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric' })

/** "Tue 3:40 PM", in the viewer's time zone. */
export function formatClock(time: Date | number, { zone = false } = {}): string {
  return (zone ? clockWithZone : clock).format(time)
}

/** "Tue 3 PM". */
export function formatHour(time: Date | number): string {
  return hourOnly.format(time)
}

/** "Chicago, Illinois, US" → "Chicago, Illinois". Drops a trailing country code. */
export function shortPlace(label: string): string {
  return label.replace(/,\s*[A-Z]{2}$/, '')
}
