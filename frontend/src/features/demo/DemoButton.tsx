import { PlayIcon } from '@phosphor-icons/react'
import { useState } from 'react'

import { cx } from '../../lib/cx'
import { useUiStore } from '../../state/uiStore'
import { DEMO, hasSeenDemo, warmDemoPoster } from './demo'

interface DemoButtonProps {
  /** `dark` sits on the brand header, `light` on the phone sheet. */
  tone: 'dark' | 'light'
  /** Just "Demo", for the phone sheet header where space is tight. */
  compact?: boolean
  className?: string
}

/**
 * Opens the narrated tour. The coral play mark makes it easy to spot; a first
 * visit adds three soft pulses after a pause, and nothing more once the demo
 * has been opened. It never opens by itself.
 */
export function DemoButton({ tone, compact = false, className }: DemoButtonProps) {
  const openDemo = useUiStore((state) => state.openDemo)
  const [firstVisit] = useState(() => !hasSeenDemo())

  return (
    <button
      type="button"
      onClick={openDemo}
      onPointerEnter={warmDemoPoster}
      onFocus={warmDemoPoster}
      aria-haspopup="dialog"
      className={cx(
        'group inline-flex h-8 shrink-0 items-center gap-2 rounded-full pr-3 pl-1 text-xs font-semibold whitespace-nowrap select-none',
        'transition-[background-color,box-shadow,scale] duration-150 ease-out active:scale-[0.97]',
        tone === 'dark'
          ? 'bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/16 hover:ring-white/25'
          : 'bg-surface-2 text-fg ring-1 ring-line-strong hover:bg-surface',
        className,
      )}
    >
      <span className="relative grid size-6 place-items-center rounded-full bg-coral text-white shadow-[0_2px_8px_rgb(248_73_96/0.45)]">
        {firstVisit && (
          <span
            aria-hidden
            className="absolute inset-0 animate-[demo-ping_2.2s_var(--ease-out)_1.2s_3_both] rounded-full bg-coral"
          />
        )}
        <PlayIcon
          size={11}
          weight="fill"
          className="relative translate-x-px transition-[scale] duration-150 ease-out group-hover:scale-110"
          aria-hidden
        />
      </span>
      {compact ? 'Demo' : 'Watch demo'}
      {!compact && <span className="font-medium tabular-nums opacity-70">{DEMO.duration}</span>}
    </button>
  )
}
