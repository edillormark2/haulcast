import { CircleNotchIcon } from '@phosphor-icons/react'
import { useState } from 'react'

import { cx } from '../../lib/cx'

/** Screen space covered by floating UI, so the map frames content in the visible area. */
export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

interface MapStatusProps {
  /** What the map is waiting for; null fades the pill out. */
  message: string | null
  insets: Insets
  /** Centred while the map has nothing to show yet, otherwise along the top. */
  placement?: 'center' | 'top'
}

/**
 * A small "working on it" pill over the visible part of the map. It has no
 * MapLibre dependency, so it also stands in while the map's code downloads.
 */
export function MapStatus({ message, insets, placement = 'top' }: MapStatusProps) {
  // Keep the last message while the pill fades out.
  const [shown, setShown] = useState(message)
  if (message !== null && message !== shown) setShown(message)
  if (shown === null) return null

  return (
    <div
      className={cx(
        'pointer-events-none absolute z-[5] flex justify-center',
        placement === 'center' ? 'items-center' : 'items-start',
      )}
      style={{
        top: insets.top + (placement === 'top' ? 12 : 0),
        bottom: placement === 'center' ? insets.bottom : undefined,
        left: insets.left,
        right: insets.right,
      }}
    >
      <p
        role="status"
        aria-hidden={message === null || undefined}
        className={cx(
          'flex items-center gap-2 rounded-full bg-surface/95 py-2 pr-3.5 pl-3 text-xs font-semibold text-fg shadow-float ring-1 ring-ink/5 backdrop-blur-sm',
          'transition-[opacity,translate] duration-200 ease-out',
          message === null && '-translate-y-1 opacity-0',
        )}
      >
        <CircleNotchIcon size={14} className="animate-spin text-teal" aria-hidden />
        {shown}
      </p>
    </div>
  )
}

/** Stands in for the map while its code loads; matches MapView's own first frame. */
export function MapLoading({ insets }: { insets: Insets }) {
  return (
    <div className="absolute inset-0 bg-canvas">
      <MapStatus message="Loading map…" insets={insets} placement="center" />
    </div>
  )
}
