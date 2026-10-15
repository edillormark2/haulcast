import { CloudRainIcon, SnowflakeIcon, WindIcon } from '@phosphor-icons/react'

import type { Factor } from '../api/types'
import { DECIMALS } from '../lib/forecast'
import { RISK, type RiskLevel } from '../lib/risk'

interface WeatherReadoutProps {
  windMph: number
  gustMph?: number
  rainInHr: number
  snowInHr: number
  /** Factors that set the risk level; shown in their risk colour. */
  drivers?: Factor[]
  level?: RiskLevel
  compact?: boolean
}

const ICONS = { wind: WindIcon, rain: CloudRainIcon, snow: SnowflakeIcon } as const
const NAMES = { wind: 'Wind', rain: 'Rain', snow: 'Snow' } as const

/**
 * Wind, rain and snow at a point, with the factors that drive risk
 * emphasised. Built from spans so it can sit inside buttons.
 */
export function WeatherReadout({
  windMph,
  gustMph,
  rainInHr,
  snowInHr,
  drivers = [],
  level,
  compact = false,
}: WeatherReadoutProps) {
  const items: { factor: Factor; value: string; note?: string | undefined }[] = [
    {
      factor: 'wind',
      value: `${windMph.toFixed(DECIMALS.wind)} mph`,
      note: gustMph === undefined || compact ? undefined : `gusts ${gustMph.toFixed(0)}`,
    },
    { factor: 'rain', value: `${rainInHr.toFixed(DECIMALS.rain)} in/hr` },
    { factor: 'snow', value: `${snowInHr.toFixed(DECIMALS.snow)} in/hr` },
  ]
  return (
    <span className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-fg-muted tabular-nums">
      {items.map(({ factor, value, note }) => {
        const Icon = ICONS[factor]
        const drives = level !== undefined && drivers.includes(factor)
        return (
          <span
            key={factor}
            className={drives ? 'flex items-center gap-1 font-semibold' : 'flex items-center gap-1'}
            style={drives ? { color: RISK[level].text } : undefined}
          >
            <Icon size={14} weight={drives ? 'bold' : 'regular'} aria-hidden />
            <span className="sr-only">{NAMES[factor]}</span>
            {value}
            {note && <span className="font-normal text-fg-subtle">({note})</span>}
          </span>
        )
      })}
    </span>
  )
}
