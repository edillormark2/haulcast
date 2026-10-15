import { playbackRate, playbackSeconds } from './playback'

describe('trip playback pace', () => {
  it('slows a short haul down enough to follow the truck', () => {
    expect(playbackSeconds(3.3)).toBe(10)
    expect(playbackRate(3.3)).toBeCloseTo(0.33)
  })

  it('gives longer trips a little more time, never more than twenty seconds', () => {
    expect(playbackSeconds(12)).toBe(11)
    expect(playbackSeconds(35)).toBeCloseTo(16.75)
    expect(playbackSeconds(48)).toBe(20)
    expect(playbackSeconds(90)).toBe(20)
  })
})
