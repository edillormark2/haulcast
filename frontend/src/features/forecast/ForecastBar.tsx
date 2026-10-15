import { Slider } from '@base-ui/react/slider'
import {
  ArrowCounterClockwiseIcon,
  CircleNotchIcon,
  EyeIcon,
  EyeSlashIcon,
  PauseIcon,
  PlayIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useMemo } from 'react'

import { ApiError } from '../../api/client'
import type { BusyRetry } from '../../api/queries'
import type { HeatmapMetric, Plan, Route } from '../../api/types'
import { cx } from '../../lib/cx'
import { formatClock, formatDuration, formatHour } from '../../lib/format'
import { HOUR_MS } from '../../lib/time'
import { ARRIVAL_EPSILON_H, FORECAST_HOURS, useUiStore } from '../../state/uiStore'
import { RetryNotice } from '../../ui/RetryNotice'
import { Segmented } from '../../ui/Segmented'
import { Legend } from './Legend'

const METRICS: readonly { value: HeatmapMetric; label: string }[] = [
  { value: 'risk', label: 'Risk' },
  { value: 'wind', label: 'Wind' },
  { value: 'rain', label: 'Rain' },
  { value: 'snow', label: 'Snow' },
]

interface ForecastBarProps {
  plan: Plan
  departureMs: number
  heatmapStatus: 'pending' | 'error' | 'success'
  heatmapError: Error | null
  /** Set while a busy service makes the heatmap wait for an automatic retry. */
  heatmapRetry: BusyRetry | null
  onRetry: () => void
  compact?: boolean
}

/** The 0–48 hour forecast timeline that drives the heatmap and the truck marker. */
export function ForecastBar({
  plan,
  departureMs,
  heatmapStatus,
  heatmapError,
  heatmapRetry,
  onRetry,
  compact = false,
}: ForecastBarProps) {
  const metric = useUiStore((state) => state.metric)
  const setMetric = useUiStore((state) => state.setMetric)
  const heatmapVisible = useUiStore((state) => state.heatmapVisible)
  const toggleHeatmap = useUiStore((state) => state.toggleHeatmap)
  const selectedRouteId = useUiStore((state) => state.selectedRouteId)
  const route = plan.routes.find((r) => r.id === selectedRouteId)

  const status = heatmapRetry ? (
    <RetryNotice
      compact
      retry={heatmapRetry}
      onRetryNow={onRetry}
      className="text-2xs leading-snug text-fg-muted"
    >
      {heatmapRetry.service} is busy, so the forecast map has to wait.
    </RetryNotice>
  ) : heatmapStatus === 'pending' ? (
    <p className="flex items-center gap-1.5 text-2xs text-fg-muted">
      <CircleNotchIcon size={13} className="animate-spin" aria-hidden />
      Loading the 48-hour forecast along the corridor…
    </p>
  ) : heatmapStatus === 'error' ? (
    <p className="flex items-center gap-1.5 text-2xs text-risk-severe-text">
      <WarningCircleIcon size={14} className="shrink-0" aria-hidden />
      <span>
        Couldn&apos;t load the forecast map.
        {heatmapError instanceof ApiError && heatmapError.busy && ` ${heatmapError.message}`}{' '}
        <button
          type="button"
          onClick={onRetry}
          className="font-semibold underline underline-offset-2"
        >
          Retry
        </button>
      </span>
    </p>
  ) : (
    <Legend metric={metric} thresholds={plan.thresholds} />
  )

  return (
    <section
      aria-label="Forecast timeline"
      className="space-y-2.5 rounded-2xl bg-surface/97 p-3 shadow-panel backdrop-blur-md sm:p-3.5"
    >
      <TimeScrubber departureMs={departureMs} route={route} />
      <div className="flex items-center gap-x-3">
        <Segmented
          legend="Heatmap shows"
          size="sm"
          value={metric}
          options={METRICS}
          onChange={setMetric}
        />
        {!compact && <div className="min-w-0 flex-1">{status}</div>}
        <button
          type="button"
          onClick={toggleHeatmap}
          aria-pressed={heatmapVisible}
          aria-label={heatmapVisible ? 'Hide weather shading' : 'Show weather shading'}
          className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-fg-muted transition-[color,background-color,scale] duration-150 ease-out hover:bg-surface-2 hover:text-fg active:scale-[0.94]"
        >
          {heatmapVisible ? <EyeIcon size={16} /> : <EyeSlashIcon size={16} />}
        </button>
      </div>
      {compact && status}
      {!compact && (
        <p className="text-2xs leading-snug text-fg-subtle">
          Shading shows the weather at the selected hour. Route colours show the weather each
          stretch gets as the truck passes.
        </p>
      )}
    </section>
  )
}

/**
 * The 0–48 h slider for the forecast, and Play for the trip: the truck drives
 * the selected route from departure to arrival while the weather moves with it.
 */
function TimeScrubber({ departureMs, route }: { departureMs: number; route: Route | undefined }) {
  const hour = useUiStore((state) => state.forecastHour)
  const playing = useUiStore((state) => state.playing)
  const play = useUiStore((state) => state.play)
  const pause = useUiStore((state) => state.pause)
  const scrubTo = useUiStore((state) => state.scrubTo)
  const ticks = useMemo(() => dayTicks(departureMs), [departureMs])
  const tripHours = route ? Math.min(route.duration_s / 3600, FORECAST_HOURS) : 0
  const arrived = route !== undefined && hour >= tripHours - ARRIVAL_EPSILON_H
  const moment = timelineMoment(hour, route)
  const clockMs = departureMs + hour * HOUR_MS

  const button = !route
    ? { label: 'Play the trip', icon: 'play' as const }
    : playing
      ? { label: `Pause the trip on ${route.name}`, icon: 'pause' as const }
      : arrived
        ? { label: `Replay the trip on ${route.name}`, icon: 'replay' as const }
        : { label: `Play the trip on ${route.name}`, icon: 'play' as const }

  const togglePlay = () => {
    if (playing) pause()
    else if (route) play({ routeId: route.id, endHour: tripHours })
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={togglePlay}
        disabled={!route}
        aria-label={button.label}
        title={button.label}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-white transition-[background-color,scale] duration-150 ease-out hover:bg-ink-soft active:scale-[0.94] disabled:bg-ink/45"
      >
        <span key={button.icon} className="grid animate-[icon-in_140ms_var(--ease-out)]">
          {button.icon === 'pause' ? (
            <PauseIcon size={15} weight="fill" />
          ) : button.icon === 'replay' ? (
            <ArrowCounterClockwiseIcon size={15} weight="bold" />
          ) : (
            <PlayIcon size={15} weight="fill" className="translate-x-px" />
          )}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <Slider.Root
          value={hour}
          min={0}
          max={FORECAST_HOURS}
          step={1}
          largeStep={6}
          onValueChange={scrubTo}
        >
          <Slider.Control className="relative flex h-6 cursor-pointer touch-none items-center select-none">
            <Slider.Track className="relative h-1.5 w-full rounded-full bg-line">
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-full bg-aqua"
                style={{ width: `${(tripHours / FORECAST_HOURS) * 100}%` }}
                title="The trip: Play drives the truck from departure to arrival"
              />
              <Slider.Indicator className="rounded-full bg-teal/55" />
              <Slider.Thumb
                aria-label="Forecast hour"
                getAriaValueText={(_formatted, value) =>
                  `${formatClock(departureMs + value * HOUR_MS)}, ${Math.round(value)} hours after departure`
                }
                className="size-4.5 rounded-full bg-surface shadow-[0_1px_3px_rgb(4_61_76/0.35)] ring-2 ring-ink transition-[scale] duration-150 ease-out outline-none focus-visible:ring-teal active:scale-110"
              />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
        <div className="relative mt-0.5 h-3.5 text-2xs text-fg-subtle tabular-nums" aria-hidden>
          {ticks.map((tick) => (
            <span
              key={tick.hour}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${(tick.hour / FORECAST_HOURS) * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>

      <p className="w-[6.75rem] shrink-0 text-right leading-tight tabular-nums" aria-live="off">
        <span className="block text-xs font-semibold text-fg">
          {Number.isInteger(hour) ? formatHour(clockMs) : formatClock(clockMs)}
        </span>
        <span className={cx('text-2xs', moment.landmark ? 'text-teal' : 'text-fg-muted')}>
          {moment.label}
        </span>
      </p>
    </div>
  )
}

/** The timeline's position in words: departure, arrival, or time on the road. */
function timelineMoment(
  hour: number,
  route: Route | undefined,
): { label: string; landmark: boolean } {
  if (hour < ARRIVAL_EPSILON_H) return { label: 'Departure', landmark: true }
  if (route && Math.abs(hour - route.duration_s / 3600) < ARRIVAL_EPSILON_H) {
    return { label: 'Arrival', landmark: true }
  }
  return { label: `+${formatDuration(hour * 3600)}`, landmark: false }
}

/** Local midnights within the 48-hour window, labelled with the weekday. */
function dayTicks(departureMs: number): { hour: number; label: string }[] {
  const ticks: { hour: number; label: string }[] = []
  const midnight = new Date(departureMs)
  midnight.setHours(24, 0, 0, 0)
  while (midnight.getTime() < departureMs + FORECAST_HOURS * HOUR_MS) {
    const hour = (midnight.getTime() - departureMs) / HOUR_MS
    if (hour > 2 && hour < FORECAST_HOURS - 2) {
      ticks.push({ hour, label: midnight.toLocaleDateString('en-US', { weekday: 'short' }) })
    }
    midnight.setDate(midnight.getDate() + 1)
  }
  return ticks
}
