import { useEffect } from 'react'

import { prefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import { FORECAST_HOURS, useUiStore } from '../../state/uiStore'

/** Playback speed: two days of forecast in twelve seconds. */
const PLAYBACK_HOURS_PER_SECOND = 4
/** Time constant of the scrub easing: the map settles ~200 ms after the thumb. */
const SMOOTHING_MS = 70
const REDUCED_MOTION_STEP_MS = 250

/**
 * Drives the displayed forecast hour with requestAnimationFrame. While playing
 * it advances steadily; while scrubbing it eases toward the slider so the
 * heatmap glides instead of jumping. It only runs while there is motion.
 */
export function useForecastClock() {
  useEffect(() => {
    let frame = 0
    let last = 0
    let stepAccumulator = 0

    const tick = (now: number) => {
      const elapsed = last ? Math.min(now - last, 100) : 16
      last = now
      const state = useUiStore.getState()
      const reduced = prefersReducedMotion()

      if (state.playing) {
        let next = state.forecastHour
        if (reduced) {
          stepAccumulator += elapsed
          if (stepAccumulator >= REDUCED_MOTION_STEP_MS) {
            stepAccumulator = 0
            next = Math.floor(next) + 1
          }
        } else {
          next += (elapsed / 1000) * PLAYBACK_HOURS_PER_SECOND
        }
        if (next >= FORECAST_HOURS) {
          state.setPlaying(false)
          next = FORECAST_HOURS
        }
        state.setForecastHour(next)
        state.setDisplayHour(next)
      } else {
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
