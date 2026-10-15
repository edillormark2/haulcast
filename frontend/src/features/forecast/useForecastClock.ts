import { useEffect } from 'react'

import { prefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import { FORECAST_HOURS, useUiStore } from '../../state/uiStore'
import { playbackRate } from './playback'

/** Time constant of the scrub easing: the map settles ~200 ms after the thumb. */
const SMOOTHING_MS = 70

/**
 * Drives the displayed forecast hour with requestAnimationFrame. While a trip
 * plays, the hour advances at that trip's pace and stops at its arrival (in
 * whole-hour steps under reduced motion); while scrubbing, the map eases toward
 * the slider so the heatmap glides instead of jumping. It runs only while
 * something is moving.
 */
export function useForecastClock() {
  useEffect(() => {
    let frame = 0
    let last = 0
    // The unrounded playback position, so whole-hour steps keep the trip's pace.
    let playhead: number | null = null

    const tick = (now: number) => {
      const elapsed = last ? Math.min(now - last, 100) : 16
      last = now
      const state = useUiStore.getState()
      const reduced = prefersReducedMotion()

      if (state.playing) {
        const endHour = state.playback?.endHour ?? FORECAST_HOURS
        playhead = (playhead ?? state.forecastHour) + (elapsed / 1000) * playbackRate(endHour)
        const next =
          reduced && playhead < endHour
            ? Math.max(Math.floor(playhead), state.forecastHour)
            : playhead
        if (next !== state.forecastHour) state.advance(next)
      } else {
        playhead = null
        const gap = state.forecastHour - state.displayHour
        if (Math.abs(gap) < 0.002 || reduced) {
          if (gap !== 0) state.setDisplayHour(state.forecastHour)
          last = 0
          frame = 0
          return
        }
        state.setDisplayHour(state.displayHour + gap * (1 - Math.exp(-elapsed / SMOOTHING_MS)))
      }
      frame = requestAnimationFrame(tick)
    }

    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const unsubscribe = useUiStore.subscribe((state, previous) => {
      if (state.playing !== previous.playing || state.forecastHour !== state.displayHour) wake()
    })
    return () => {
      unsubscribe()
      cancelAnimationFrame(frame)
    }
  }, [])
}
