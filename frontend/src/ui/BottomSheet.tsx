import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

import { cx } from '../lib/cx'

interface BottomSheetProps {
  /** Visible heights in px, smallest first. */
  snapPoints: number[]
  snapIndex: number
  onSnapChange: (index: number) => void
  header: ReactNode
  children: ReactNode
  label: string
}

/** How far a flick carries the sheet: velocity (px/ms) × this many ms. */
const FLING_MS = 160
/** A press that moves less than this is a tap, which the handle button handles. */
const DRAG_THRESHOLD_PX = 4

/**
 * A draggable bottom sheet over the map. It moves only with transform, follows
 * the finger 1:1 while dragging, and settles on the nearest snap point after
 * accounting for flick velocity. The handle is a button that steps through
 * the snap points when tapped, clicked or pressed from the keyboard.
 */
export function BottomSheet({
  snapPoints,
  snapIndex,
  onSnapChange,
  header,
  children,
  label,
}: BottomSheetProps) {
  const maxHeight = snapPoints.at(-1) ?? 0
  const height = snapPoints[snapIndex] ?? snapPoints[0] ?? 0
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const drag = useRef<{
    pointerId: number
    startY: number
    lastY: number
    lastTime: number
    velocity: number
    dragging: boolean
  } | null>(null)

  const visible = Math.min(Math.max(height - (dragOffset ?? 0), snapPoints[0] ?? 0), maxHeight)

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      dragging: false,
    }
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    const state = drag.current
    if (!state || event.pointerId !== state.pointerId) return
    if (event.buttons === 0) {
      // Released outside the sheet before the drag started; nothing to finish.
      drag.current = null
      return
    }
    if (!state.dragging) {
      if (Math.abs(event.clientY - state.startY) < DRAG_THRESHOLD_PX) return
      // Capture only once the press becomes a drag. Capturing on press makes
      // Chromium send a mouse click to this wrapper instead of the handle
      // button, so clicking the handle did nothing.
      event.currentTarget.setPointerCapture(event.pointerId)
      state.dragging = true
    }
    const dt = Math.max(event.timeStamp - state.lastTime, 1)
    state.velocity = (event.clientY - state.lastY) / dt
    state.lastY = event.clientY
    state.lastTime = event.timeStamp
    setDragOffset(event.clientY - state.startY)
  }

  const onPointerUp = () => {
    const state = drag.current
    drag.current = null
    if (!state?.dragging) return // a tap; the handle button's click handles it
    setDragOffset(null)
    const projected = height - (state.lastY - state.startY) - state.velocity * FLING_MS
    onSnapChange(nearestIndex(snapPoints, projected))
  }

  // Keep the sheet on a valid snap point if the viewport changes.
  useEffect(() => {
    if (snapIndex >= snapPoints.length) onSnapChange(snapPoints.length - 1)
  }, [snapIndex, snapPoints.length, onSnapChange])

  return (
    <section
      aria-label={label}
      className={cx(
        'fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[20px] bg-surface shadow-panel',
        dragOffset === null &&
          'transition-transform duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
      )}
      style={{ height: maxHeight, transform: `translateY(${maxHeight - visible}px)` }}
    >
      <div
        className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          type="button"
          onClick={() => onSnapChange((snapIndex + 1) % snapPoints.length)}
          aria-label={snapIndex === snapPoints.length - 1 ? 'Collapse panel' : 'Expand panel'}
          aria-expanded={snapIndex > 0}
          className="mx-auto block px-6 pt-2 pb-1.5"
        >
          <span className="block h-1 w-9 rounded-full bg-line-strong" />
        </button>
        {header}
      </div>
      {/* Fills the full-height sheet; below the top snap point its end sits off screen
          until the sheet is expanded, like most map apps. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </section>
  )
}

function nearestIndex(points: number[], target: number): number {
  let best = 0
  points.forEach((point, index) => {
    if (Math.abs(point - target) < Math.abs((points[best] ?? 0) - target)) best = index
  })
  return best
}
