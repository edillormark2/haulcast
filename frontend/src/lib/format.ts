const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

export function formatMiles(miles: number): string {
  return `${integer.format(miles)} mi`
}

export function formatPounds(pounds: number): string {
  return `${integer.format(pounds)} lb`
}

export function formatNumber(value: number, digits = 0): string {
  return digits === 0 ? integer.format(value) : value.toFixed(digits)
}

export function formatDecimal(value: number): string {
  return oneDecimal.format(value)
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
const dayDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

/** "Tue 3:40 PM", in the viewer's time zone. */
export function formatClock(time: Date | number, { zone = false } = {}): string {
  return (zone ? clockWithZone : clock).format(time)
}

/** "Tue 3 PM". */
export function formatHour(time: Date | number): string {
  return hourOnly.format(time)
}

/** "Tue, Oct 15". */
export function formatDay(time: Date | number): string {
  return dayDate.format(time)
}

export function formatRelativeHours(hours: number): string {
  return `+${Math.round(hours)} h`
}

/** "Chicago, Illinois, US" → "Chicago, Illinois". Drops a trailing country code. */
export function shortPlace(label: string): string {
  return label.replace(/,\s*[A-Z]{2}$/, '')
}
