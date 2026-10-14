import { Slider } from '@base-ui/react/slider'
import {
  CircleNotchIcon,
  EyeIcon,
  EyeSlashIcon,
  PauseIcon,
  PlayIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useMemo } from 'react'

import type { HeatmapMetric, Plan } from '../../api/types'
import { cx } from '../../lib/cx'
import { formatClock, formatHour } from '../../lib/format'
import { HOUR_MS } from '../../lib/time'
import { FORECAST_HOURS, useUiStore } from '../../state/uiStore'
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
  onRetry: () => void
  compact?: boolean
}

/** The 0–48 hour forecast timeline that drives the heatmap and the truck marker. */
export function ForecastBar({
  plan,
  departureMs,
  heatmapStatus,
  onRetry,
  compact = false,
}: ForecastBarProps) {
  const metric = useUiStore((state) => state.metric)
  const setMetric = useUiStore((state) => state.setMetric)
  const heatmapVisible = useUiStore((state) => state.heatmapVisible)
  const toggleHeatmap = useUiStore((state) => state.toggleHeatmap)
  const selectedRouteId = useUiStore((state) => state.selectedRouteId)
  const route = plan.routes.find((r) => r.id === selectedRouteId)
  const tripHours = route ? Math.min(route.duration_s / 3600, FORECAST_HOURS) : 0

  const status =
    heatmapStatus === 'pending' ? (
      <p className="flex items-center gap-1.5 text-2xs text-fg-muted">
        <CircleNotchIcon size={13} className="animate-spin" aria-hidden />
        Loading the 48-hour forecast along the corridor…
      </p>
    ) : heatmapStatus === 'error' ? (
      <p className="flex items-center gap-1.5 text-2xs text-risk-severe-text">
        <WarningCircleIcon size={14} aria-hidden />
        Couldn&apos;t load the forecast map.
        <button
          type="button"
          onClick={onRetry}
          className="font-semibold underline underline-offset-2"
        >
          Retry
        </button>
      </p>
    ) : (
      <Legend metric={metric} thresholds={plan.thresholds} />
    )

  return (
    <section
      aria-label="Forecast timeline"
      className="space-y-2.5 rounded-2xl bg-surface/97 p-3 shadow-panel backdrop-blur-md sm:p-3.5"
    >
      <TimeScrubber departureMs={departureMs} tripHours={tripHours} />
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

function TimeScrubber({ departureMs, tripHours }: { departureMs: number; tripHours: number }) {
  const hour = useUiStore((state) => state.forecastHour)
  const playing = useUiStore((state) => state.playing)
  const setForecastHour = useUiStore((state) => state.setForecastHour)
  const setPlaying = useUiStore((state) => state.setPlaying)
  const ticks = useMemo(() => dayTicks(departureMs), [departureMs])
  const shownHour = Math.round(hour)

  const togglePlay = () => {
    if (!playing && hour >= FORECAST_HOURS) setForecastHour(0)
    setPlaying(!playing)
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Pause forecast playback' : 'Play the 48-hour forecast'}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-white transition-[background-color,scale] duration-150 ease-out hover:bg-ink-soft active:scale-[0.94]"
      >
        <span
          key={playing ? 'pause' : 'play'}
          className="grid animate-[icon-in_140ms_var(--ease-out)]"
        >
          {playing ? (
            <PauseIcon size={15} weight="fill" />
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
          onValueChange={(value) => {
            setPlaying(false)
            setForecastHour(value)
          }}
        >
          <Slider.Control className="relative flex h-6 cursor-pointer touch-none items-center select-none">
            <Slider.Track className="relative h-1.5 w-full rounded-full bg-line">
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-full bg-aqua"
                style={{ width: `${(tripHours / FORECAST_HOURS) * 100}%` }}
                title="Truck on the road"
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
          {formatHour(departureMs + shownHour * HOUR_MS)}
        </span>
        <span className={cx('text-2xs', shownHour === 0 ? 'text-teal' : 'text-fg-muted')}>
          {shownHour === 0 ? 'Departure' : `+${shownHour} h`}
        </span>
      </p>
    </div>
  )
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
