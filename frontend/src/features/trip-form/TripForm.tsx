import { ArrowsDownUpIcon, CircleNotchIcon, ScalesIcon } from '@phosphor-icons/react'
import { type SyntheticEvent, useId, useState } from 'react'

import { useRiskRules } from '../../api/queries'
import type { CheckpointInterval, Place, TripRequest } from '../../api/types'
import { cx } from '../../lib/cx'
import { nextHour, toLocalInputValue, toOffsetIso } from '../../lib/time'
import { INTERVALS } from '../../state/tripParams'
import { Button } from '../../ui/Button'
import { Segmented } from '../../ui/Segmented'
import { loadHint } from './loadHint'
import { PlaceField } from './PlaceField'

const MAX_LOAD_LB = 80_000
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

interface Draft {
  origin: Place | null
  destination: Place | null
  departure: string
  load: string
  interval: CheckpointInterval
}

type Errors = Partial<Record<keyof Draft, string>>

interface TripFormProps {
  initial: TripRequest | null
  busy: boolean
  onSubmit: (trip: TripRequest) => void
}

export function TripForm({ initial, busy, onSubmit }: TripFormProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial))
  const [errors, setErrors] = useState<Errors>({})
  const rulesQuery = useRiskRules()
  const rules = rulesQuery.data
  const ids = { departure: useId(), load: useId() }

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = validate(draft)
    setErrors(found)
    if (Object.keys(found).length > 0 || !draft.origin || !draft.destination) return
    onSubmit({
      origin: draft.origin,
      destination: draft.destination,
      departure: toOffsetIso(new Date(draft.departure)),
      load_lb: parseLoad(draft.load) ?? 0,
      interval_mi: draft.interval,
    })
  }

  const loadLb = parseLoad(draft.load)
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="relative space-y-3">
        <PlaceField
          label="From"
          placeholder="City, address or warehouse"
          role="origin"
          value={draft.origin}
          onChange={(place) => update('origin', place)}
          error={errors.origin}
        />
        <PlaceField
          label="To"
          placeholder="Where is the load going?"
          role="destination"
          value={draft.destination}
          onChange={(place) => update('destination', place)}
          error={errors.destination}
        />
        <button
          type="button"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              origin: current.destination,
              destination: current.origin,
            }))
          }
          aria-label="Swap origin and destination"
          className="absolute top-[52px] right-10 z-10 grid size-7 place-items-center rounded-full bg-surface text-fg-muted shadow-float ring-1 ring-line transition-[color,scale] duration-150 ease-out hover:text-fg active:scale-[0.94]"
        >
          <ArrowsDownUpIcon size={14} weight="bold" />
        </button>
      </div>

      <div>
        <label htmlFor={ids.departure} className="mb-1 block text-xs font-medium text-fg-muted">
          Departure
        </label>
        <input
          id={ids.departure}
          type="datetime-local"
          value={draft.departure}
          onChange={(event) => update('departure', event.target.value)}
          aria-invalid={errors.departure ? true : undefined}
          aria-describedby={errors.departure ? `${ids.departure}-error` : undefined}
          className={cx(
            'h-10 w-full min-w-0 rounded-lg bg-surface px-2.5 text-sm text-fg tabular-nums ring-1 transition-shadow outline-none focus:ring-2 focus:ring-teal',
            errors.departure ? 'ring-risk-severe-text' : 'ring-line-strong',
          )}
        />
        <div
          className="mt-1.5 flex flex-wrap gap-1.5"
          role="group"
          aria-label="Quick departure times"
        >
          {quickDepartures().map(({ label, time }) => (
            <button
              key={label}
              type="button"
              onClick={() => update('departure', toLocalInputValue(time))}
              className="rounded-full bg-surface-2 px-2.5 py-1 text-2xs font-semibold text-fg-muted ring-1 ring-line transition-[color,background-color,scale] duration-150 ease-out hover:bg-surface hover:text-fg active:scale-[0.96]"
            >
              {label}
            </button>
          ))}
        </div>
        {errors.departure && (
          <p id={`${ids.departure}-error`} className="mt-1 text-xs text-risk-severe-text">
            {errors.departure}
          </p>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-3">
        <div>
          <label htmlFor={ids.load} className="mb-1 block text-xs font-medium text-fg-muted">
            Load weight
          </label>
          <div
            className={cx(
              'flex h-10 items-center rounded-lg bg-surface ring-1 transition-shadow focus-within:ring-2 focus-within:ring-teal',
              errors.load ? 'ring-risk-severe-text' : 'ring-line-strong',
            )}
          >
            <input
              id={ids.load}
              inputMode="numeric"
              autoComplete="off"
              value={draft.load}
              onChange={(event) => update('load', event.target.value)}
              onBlur={() => {
                const value = parseLoad(draft.load)
                if (value !== null) update('load', value.toLocaleString('en-US'))
              }}
              aria-invalid={errors.load ? true : undefined}
              aria-describedby={`${ids.load}-hint`}
              className="h-full w-full min-w-0 bg-transparent pl-2.5 text-sm text-fg tabular-nums outline-none"
            />
            <span className="pr-2.5 text-xs text-fg-subtle">lb</span>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-fg-muted" aria-hidden>
            Weather every
          </p>
          <Segmented
            legend="Check the weather every"
            value={draft.interval}
            options={INTERVALS.map((miles) => ({ value: miles, label: `${miles} mi` }))}
            onChange={(interval) => update('interval', interval)}
          />
        </div>
      </div>

      <p
        id={`${ids.load}-hint`}
        className={cx(
          '-mt-1.5 flex gap-1.5 text-xs leading-snug',
          errors.load ? 'text-risk-severe-text' : 'text-fg-muted',
        )}
      >
        <ScalesIcon size={14} className="mt-px shrink-0 opacity-70" aria-hidden />
        {errors.load ??
          (loadLb === null ? (
            'Enter the cargo weight in pounds.'
          ) : rulesQuery.isPending ? (
            <span
              role="status"
              aria-label="Loading the load rules"
              className="shimmer mt-0.5 inline-block h-3 w-56 rounded"
            />
          ) : (
            loadHint(loadLb, rules?.load_rules)
          ))}
      </p>

      <Button type="submit" variant="primary" size="lg" disabled={busy} className="w-full">
        {busy && <CircleNotchIcon size={18} className="animate-spin" aria-hidden />}
        {busy ? 'Planning routes…' : 'Find the safest route'}
      </Button>
    </form>
  )
}

function draftFrom(trip: TripRequest | null): Draft {
  const departure = trip ? new Date(trip.departure) : nextHour(new Date())
  return {
    origin: trip?.origin ?? null,
    destination: trip?.destination ?? null,
    departure: toLocalInputValue(
      departure.getTime() < Date.now() ? nextHour(new Date()) : departure,
    ),
    load: (trip?.load_lb ?? 40_000).toLocaleString('en-US'),
    interval: trip?.interval_mi ?? 25,
  }
}

function parseLoad(text: string): number | null {
  const digits = text.replace(/[,\s]/g, '')
  if (!/^\d+$/.test(digits)) return null
  return Number(digits)
}

function validate(draft: Draft): Errors {
  const errors: Errors = {}
  if (!draft.origin) errors.origin = 'Pick a starting point from the list.'
  if (!draft.destination) errors.destination = 'Pick a destination from the list.'
  if (
    draft.origin &&
    draft.destination &&
    draft.origin.lat === draft.destination.lat &&
    draft.origin.lon === draft.destination.lon
  ) {
    errors.destination = 'Destination must differ from the starting point.'
  }
  const departure = new Date(draft.departure).getTime()
  if (Number.isNaN(departure)) errors.departure = 'Enter a departure date and time.'
  else if (departure < Date.now() - HOUR_MS) errors.departure = "Departure can't be in the past."
  else if (departure > Date.now() + 7 * DAY_MS)
    errors.departure = 'Forecasts reach 7 days ahead; pick an earlier departure.'
  const load = parseLoad(draft.load)
  if (load === null || load > MAX_LOAD_LB) {
    errors.load = `Load must be a whole number of pounds, up to ${MAX_LOAD_LB.toLocaleString('en-US')}.`
  }
  return errors
}

function quickDepartures(): { label: string; time: Date }[] {
  const now = new Date()
  const tomorrowMorning = new Date(now)
  tomorrowMorning.setDate(now.getDate() + 1)
  tomorrowMorning.setHours(6, 0, 0, 0)
  return [
    { label: 'Now', time: now },
    { label: 'In 3 hours', time: nextHour(new Date(now.getTime() + 2 * HOUR_MS)) },
    { label: 'Tomorrow 6 AM', time: tomorrowMorning },
  ]
}
