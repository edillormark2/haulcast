import {
  ArrowClockwiseIcon,
  CloudSunIcon,
  PathIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

import type { ApiError } from '../../api/client'
import type { TripRequest } from '../../api/types'
import { Button } from '../../ui/Button'
import { SAMPLE_TRIPS, withNextDeparture } from './sampleTrips'

/** Before the first plan: what the tool does, and trips to try. */
export function EmptyState({ onTry }: { onTry: (trip: TripRequest) => void }) {
  return (
    <section aria-labelledby="empty-title" className="space-y-4">
      <div className="space-y-2 text-sm leading-relaxed text-fg-muted">
        <h2 id="empty-title" className="text-[15px] font-semibold text-fg">
          Compare three routes before the truck rolls
        </h2>
        <p>
          Haulcast reads the forecast at every checkpoint for the moment your truck will reach it,
          scores wind, rain and snow against your load, and recommends the route with the least
          severe weather.
        </p>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold text-fg-muted">Try a sample trip</h3>
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
          {SAMPLE_TRIPS.map((sample) => (
            <li key={sample.title}>
              <button
                type="button"
                onClick={() => onTry(withNextDeparture(sample.trip))}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2"
              >
                <PathIcon size={18} className="shrink-0 text-teal" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg">{sample.title}</span>
                  <span className="block text-xs text-fg-muted">{sample.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Planning takes a few seconds: say what the server is doing and how long it has been. */
export function LoadingState({ interval }: { interval: number }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section aria-busy="true" aria-live="polite" className="space-y-4">
      <p className="flex gap-2 text-sm leading-snug text-fg-muted">
        <CloudSunIcon size={18} className="mt-px shrink-0 animate-pulse text-teal" aria-hidden />
        <span>
          Finding three truck routes and reading the forecast every {interval} mi at the
          truck&apos;s arrival time. This usually takes about five seconds
          {seconds > 1 && <span className="text-fg-subtle tabular-nums"> ({seconds} s)</span>}.
        </span>
      </p>
      <div className="space-y-2" aria-hidden>
        <div className="shimmer h-3 w-24 rounded" />
        <div className="shimmer h-6 w-56 rounded" />
        <div className="shimmer h-3 w-full rounded" />
      </div>
      <div
        className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line"
        aria-hidden
      >
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2.5 px-4 py-3.5">
            <div className="flex justify-between">
              <div className="shimmer h-4 w-36 rounded" />
              <div className="shimmer h-4 w-16 rounded" />
            </div>
            <div className="shimmer h-2.5 rounded-full" style={{ width: `${92 - i * 9}%` }} />
          </div>
        ))}
      </div>
    </section>
  )
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error; onRetry: () => void }) {
  return (
    <section role="alert" className="space-y-3 rounded-xl bg-surface px-4 py-4 ring-1 ring-line">
      <p className="flex gap-2 text-sm font-semibold text-fg">
        <WarningCircleIcon size={18} className="mt-px shrink-0 text-risk-severe-text" aria-hidden />
        Couldn&apos;t plan this trip
      </p>
      <p className="text-sm leading-relaxed text-fg-muted">{error.message}</p>
      <Button size="sm" onClick={onRetry}>
        <ArrowClockwiseIcon size={14} weight="bold" aria-hidden />
        Try again
      </Button>
    </section>
  )
}
