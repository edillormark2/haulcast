/**
 * How long a trip takes to play. Every trip plays in 10 to 20 seconds: a
 * three-hour haul slows down enough to follow the truck along the road, and
 * a two-day run still finishes before attention drifts.
 */
const MIN_SECONDS = 10
const MAX_SECONDS = 20

export function playbackSeconds(tripHours: number): number {
  return Math.min(Math.max(8 + tripHours / 4, MIN_SECONDS), MAX_SECONDS)
}

/** Forecast hours that pass per second of playback. */
export function playbackRate(tripHours: number): number {
  return tripHours / playbackSeconds(tripHours)
}
