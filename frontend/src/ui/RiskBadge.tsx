import { RISK, type RiskLevel } from '../lib/risk'

interface RiskBadgeProps {
  level: RiskLevel
  size?: 'sm' | 'md'
}

/** A risk level as text on a tint of its colour. No Travel is solid, like a closure sign. */
export function RiskBadge({ level, size = 'md' }: RiskBadgeProps) {
  const style = RISK[level]
  const noTravel = level === 'no_travel'
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1.5 rounded-md font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-px text-2xs' : 'px-2 py-0.5 text-xs',
        noTravel ? 'text-white' : '',
      ].join(' ')}
      style={
        noTravel
          ? { backgroundColor: style.color }
          : { backgroundColor: `${style.color}24`, color: style.text }
      }
    >
      <span
        aria-hidden
        className={['size-1.5 rounded-full', noTravel ? 'bg-white' : ''].join(' ')}
        style={noTravel ? undefined : { backgroundColor: style.color }}
      />
      {style.label}
    </span>
  )
}
