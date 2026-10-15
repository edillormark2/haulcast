import { ClockCountdownIcon } from '@phosphor-icons/react'
import { type ReactNode, useEffect, useState } from 'react'

import type { BusyRetry } from '../api/queries'
import { cx } from '../lib/cx'

interface RetryNoticeProps {
  retry: BusyRetry
  onRetryNow: () => void
  /** The lead sentence: what is busy and what waits on it. */
  children: ReactNode
  compact?: boolean
  className?: string
}

/**
 * A busy service and the automatic retry it set going: what is waiting, a
 * countdown to the next try, and a way to try at once. The countdown is
 * hidden from screen readers so it isn't announced every second.
 */
export function RetryNotice({
  retry,
  onRetryNow,
  children,
  compact = false,
  className,
}: RetryNoticeProps) {
  return (
    <p role="status" className={cx('flex', compact ? 'gap-1.5' : 'gap-2', className)}>
      <ClockCountdownIcon
        size={compact ? 14 : 18}
        className={cx('shrink-0 text-teal', !compact && 'mt-px')}
        aria-hidden
      />
      <span>
        {children} Trying again <span className="sr-only">shortly</span>
        {/* Each failed try restarts the countdown with its own wait. */}
        <Countdown key={retry.attempt} seconds={retry.waitS} />.{' '}
        <button
          type="button"
          onClick={onRetryNow}
          className="font-semibold text-fg underline underline-offset-2"
        >
          Try now
        </button>
      </span>
    </p>
  )
}

function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    const timer = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <span aria-hidden className="tabular-nums">
      {left > 0 ? `in ${left} s` : 'now'}
    </span>
  )
}
