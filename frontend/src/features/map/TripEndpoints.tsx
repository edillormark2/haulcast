import type { TripRequest } from '../../api/types'
import { cx } from '../../lib/cx'
import { shortPlace } from '../../lib/format'
import { MapMarker } from './MapMarker'

/** The trip's two ends, pulsing while its routes are being planned. */
export function TripEndpoints({ trip }: { trip: TripRequest }) {
  const { origin, destination } = trip
  return (
    <>
      <MapMarker lngLat={[origin.lon, origin.lat]}>
        <EndpointDot tone="bg-teal" label={`Start: ${shortPlace(origin.label)}`} />
      </MapMarker>
      <MapMarker lngLat={[destination.lon, destination.lat]}>
        <EndpointDot tone="bg-ink" label={`Destination: ${shortPlace(destination.label)}`} />
      </MapMarker>
    </>
  )
}

function EndpointDot({ tone, label }: { tone: string; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="relative grid size-5 place-items-center"
    >
      <span
        aria-hidden
        className={cx('absolute inset-0 animate-ping rounded-full opacity-35', tone)}
      />
      <span
        aria-hidden
        className={cx('relative size-3.5 rounded-full shadow-float ring-[3px] ring-white', tone)}
      />
    </span>
  )
}
