import { PencilSimpleIcon } from '@phosphor-icons/react'

import type { TripRequest } from '../../api/types'
import { formatClock, formatPounds, shortPlace } from '../../lib/format'
import { Button } from '../../ui/Button'

export function TripSummary({ trip, onEdit }: { trip: TripRequest; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-[15px] leading-snug font-semibold text-fg">
          {shortPlace(trip.origin.label)}
          <span className="font-normal text-fg-muted"> to </span>
          {shortPlace(trip.destination.label)}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted tabular-nums">
          Leaves {formatClock(new Date(trip.departure), { zone: true })},{' '}
          {formatPounds(trip.load_lb)}, weather every {trip.interval_mi} mi
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={onEdit} aria-label="Edit trip">
        <PencilSimpleIcon size={13} weight="bold" />
        Edit
      </Button>
    </div>
  )
}
