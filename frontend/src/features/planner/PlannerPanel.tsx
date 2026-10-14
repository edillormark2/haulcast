import { Tabs } from '@base-ui/react/tabs'
import { CircleNotchIcon } from '@phosphor-icons/react'
import { useState } from 'react'

import type { Plan, TripRequest } from '../../api/types'
import { cx } from '../../lib/cx'
import { type PanelTab, useUiStore } from '../../state/uiStore'
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
  retry: () => void
}

interface PlannerPanelProps {
  trip: TripRequest | null
  query: PlanQueryState
  onSubmit: (trip: TripRequest) => void
}

/** Everything left of the map: the trip, the decision, the evidence. */
export function PlannerPanel({ trip, query, onSubmit }: PlannerPanelProps) {
  const [editing, setEditing] = useState(false)
  const showForm = trip === null || editing

  const submit = (next: TripRequest) => {
    setEditing(false)
    onSubmit(next)
  }

  return (
    <div className="space-y-5 px-4 pt-4 pb-8">
      {showForm ? (
        <TripForm initial={trip} busy={query.loading} onSubmit={submit} />
      ) : (
        <TripSummary trip={trip} onEdit={() => setEditing(true)} />
      )}
      {!editing && <Results trip={trip} query={query} onTry={submit} />}
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
  if (!query.plan) return <LoadingState interval={trip.interval_mi} />

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
