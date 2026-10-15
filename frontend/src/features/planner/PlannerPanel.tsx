import { Tabs } from '@base-ui/react/tabs'
import { ArrowLeftIcon, CircleNotchIcon } from '@phosphor-icons/react'
import { useState } from 'react'

import type { BusyRetry } from '../../api/queries'
import type { Plan, TripRequest } from '../../api/types'
import { cx } from '../../lib/cx'
import { type PanelTab, useUiStore } from '../../state/uiStore'
import { Button } from '../../ui/Button'
import { RetryNotice } from '../../ui/RetryNotice'
import { CheckpointList } from '../checkpoints/CheckpointList'
import { RecommendationCard } from '../routes/RecommendationCard'
import { RouteList } from '../routes/RouteList'
import { TripForm } from '../trip-form/TripForm'
import { TripSummary } from '../trip-form/TripSummary'
import { EmptyState, ErrorState, LoadingState } from './PlanStates'

const TABS: readonly { value: PanelTab; label: string }[] = [
  { value: 'routes', label: 'Routes' },
  { value: 'checkpoints', label: 'Checkpoints' },
]

export interface PlanQueryState {
  plan: Plan | undefined
  loading: boolean
  /** Fetching a new plan while the previous one stays on screen. */
  refreshing: boolean
  error: Error | null
  /** Set while a busy service makes the plan wait for an automatic retry. */
  busy: BusyRetry | null
  retry: () => void
}

interface PlannerPanelProps {
  trip: TripRequest | null
  query: PlanQueryState
  onSubmit: (trip: TripRequest) => void
  /** Leaves the current trip for a blank planner. */
  onNewTrip: () => void
}

/** Everything left of the map: the trip, the decision, the evidence. */
export function PlannerPanel({ trip, query, onSubmit, onNewTrip }: PlannerPanelProps) {
  const [editing, setEditing] = useState(false)

  const submit = (next: TripRequest) => {
    setEditing(false)
    onSubmit(next)
  }

  if (trip && editing) {
    return (
      <div className="space-y-4 px-4 pt-4 pb-8">
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="-mt-1 -ml-2">
          <ArrowLeftIcon size={13} weight="bold" aria-hidden />
          Back to routes
        </Button>
        <TripForm initial={trip} busy={query.loading} onSubmit={submit} />
      </div>
    )
  }

  return (
    <div className="space-y-5 px-4 pt-4 pb-8">
      {trip ? (
        <TripSummary
          trip={trip}
          onEdit={() => setEditing(true)}
          onNewTrip={() => {
            setEditing(false)
            onNewTrip()
          }}
        />
      ) : (
        <TripForm initial={null} busy={query.loading} onSubmit={submit} />
      )}
      <Results trip={trip} query={query} onTry={submit} />
    </div>
  )
}

function Results({
  trip,
  query,
  onTry,
}: {
  trip: TripRequest | null
  query: PlanQueryState
  onTry: (trip: TripRequest) => void
}) {
  const panelTab = useUiStore((state) => state.panelTab)
  const setPanelTab = useUiStore((state) => state.setPanelTab)

  if (!trip) return <EmptyState onTry={onTry} />
  if (query.error && !query.plan) return <ErrorState error={query.error} onRetry={query.retry} />
  if (!query.plan) {
    return <LoadingState interval={trip.interval_mi} retry={query.busy} onRetryNow={query.retry} />
  }

  const { plan } = query
  const departureMs = Date.parse(plan.trip.departure)
  return (
    <Tabs.Root value={panelTab} onValueChange={(tab: PanelTab) => setPanelTab(tab)}>
      <Tabs.List className="relative mb-4 flex gap-5 border-b border-line">
        {TABS.map(({ value, label }) => (
          <Tabs.Tab
            key={value}
            value={value}
            className="-mb-px pb-2 text-sm font-semibold text-fg-muted transition-colors duration-150 outline-none hover:text-fg focus-visible:text-fg data-active:text-fg"
          >
            {label}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator className="absolute bottom-[-1px] left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-full bg-ink transition-[translate,width] duration-200 ease-out" />
        {query.refreshing && (
          <span
            className="ml-auto flex items-center gap-1.5 pb-2 text-xs text-fg-muted"
            role="status"
          >
            <CircleNotchIcon size={13} className="animate-spin" aria-hidden />
            Updating
          </span>
        )}
      </Tabs.List>
      {query.refreshing && query.busy && (
        <RetryNotice
          compact
          retry={query.busy}
          onRetryNow={query.retry}
          className="mb-4 text-xs leading-snug text-fg-muted"
        >
          {query.busy.service} is busy right now, so the update has to wait.
        </RetryNotice>
      )}
      <div className={cx('transition-opacity duration-200', query.refreshing && 'opacity-60')}>
        <Tabs.Panel
          value="routes"
          keepMounted
          className="space-y-5 outline-none data-hidden:hidden"
        >
          <RecommendationCard plan={plan} />
          <RouteList plan={plan} departureMs={departureMs} />
          {query.error && <ErrorState error={query.error} onRetry={query.retry} />}
        </Tabs.Panel>
        <Tabs.Panel value="checkpoints" keepMounted className="outline-none data-hidden:hidden">
          <CheckpointList plan={plan} departureMs={departureMs} />
        </Tabs.Panel>
      </div>
    </Tabs.Root>
  )
}
