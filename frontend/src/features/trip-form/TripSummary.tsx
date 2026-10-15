import { ArrowLeftIcon, PencilSimpleIcon } from '@phosphor-icons/react'

import type { TripRequest } from '../../api/types'
import { formatClock, formatPounds, shortPlace } from '../../lib/format'
import { Button } from '../../ui/Button'

interface TripSummaryProps {
  trip: TripRequest
  onEdit: () => void
  onNewTrip: () => void
}

/** The planned trip, with the way back to a blank planner and the way to change it. */
export function TripSummary({ trip, onEdit, onNewTrip }: TripSummaryProps) {
  return (
    <div className="space-y-2">
      <div className="-mt-1 flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={onNewTrip} className="-ml-2">
          <ArrowLeftIcon size={13} weight="bold" aria-hidden />
          New trip
        </Button>
        <Button size="sm" onClick={onEdit} aria-label="Edit trip">
          <PencilSimpleIcon size={13} weight="bold" aria-hidden />
          Edit
        </Button>
      </div>
      <div className="min-w-0">
        <p className="text-[15px] leading-snug font-semibold text-balance text-fg">
          {shortPlace(trip.origin.label)}
          <span className="font-normal text-fg-muted"> to </span>
          {shortPlace(trip.destination.label)}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted tabular-nums">
          Leaves {formatClock(new Date(trip.departure), { zone: true })},{' '}
          {formatPounds(trip.load_lb)}, weather every {trip.interval_mi} mi
        </p>
      </div>
    </div>
  )
}
