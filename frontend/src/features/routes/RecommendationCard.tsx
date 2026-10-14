import { CheckCircleIcon, InfoIcon, WarningIcon } from '@phosphor-icons/react'

import type { Plan } from '../../api/types'
import { formatClock, formatDuration, formatMiles } from '../../lib/format'

/** The decision first: which route, and the plain-language reason. */
export function RecommendationCard({ plan }: { plan: Plan }) {
  const { recommendation } = plan
  const route = plan.routes.find((r) => r.id === recommendation.route_id)
  if (!route) return null
  const blocked = route.exposure.miles.no_travel > 0

  return (
    <section aria-labelledby="recommendation-title" className="space-y-2.5">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-teal">
          <CheckCircleIcon size={15} weight="fill" aria-hidden />
          Recommended
        </p>
        <h2 id="recommendation-title" className="mt-1 text-xl leading-tight font-bold text-fg">
          {route.name} <span className="font-semibold text-fg-muted">{route.via}</span>
        </h2>
        <p className="mt-1 text-sm text-fg-muted tabular-nums">
          {formatDuration(route.duration_s)}, {formatMiles(route.distance_mi)}, arrives{' '}
          {formatClock(Date.parse(route.arrival))}
        </p>
      </div>

      <p className="text-sm leading-relaxed text-fg">{recommendation.reason}</p>

      {recommendation.warning && (
        <p
          role="alert"
          className={[
            'flex gap-2 rounded-lg px-3 py-2.5 text-sm leading-snug',
            blocked ? 'bg-risk-no-travel text-white' : 'bg-risk-severe/12 text-risk-severe-text',
          ].join(' ')}
        >
          <WarningIcon size={17} weight="fill" className="mt-px shrink-0" aria-hidden />
          {recommendation.warning}
        </p>
      )}

      {plan.notes.map((note) => (
        <p key={note} className="flex gap-2 text-xs leading-snug text-fg-muted">
          <InfoIcon size={15} className="shrink-0" aria-hidden />
          {note}
        </p>
      ))}
    </section>
  )
}
