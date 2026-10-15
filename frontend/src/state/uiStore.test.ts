import { useUiStore } from './uiStore'

const state = () => useUiStore.getState()

beforeEach(() => {
  state().resetForNewPlan('A')
})

describe('trip playback', () => {
  it('plays from departure and stops at arrival', () => {
    state().play({ routeId: 'A', endHour: 3.5 })
    expect(state()).toMatchObject({ playing: true, forecastHour: 0 })

    state().advance(2)
    expect(state()).toMatchObject({ playing: true, forecastHour: 2, displayHour: 2 })

    state().advance(4)
    expect(state()).toMatchObject({ playing: false, forecastHour: 3.5, displayHour: 3.5 })
  })

  it('resumes a paused trip where it stopped', () => {
    state().play({ routeId: 'A', endHour: 6 })
    state().advance(2.5)
    state().pause()
    state().play({ routeId: 'A', endHour: 6 })
    expect(state()).toMatchObject({ playing: true, forecastHour: 2.5 })
  })

  it('replays from departure once the truck has arrived', () => {
    state().play({ routeId: 'A', endHour: 3.5 })
    state().advance(3.5)
    state().play({ routeId: 'A', endHour: 3.5 })
    expect(state()).toMatchObject({ playing: true, forecastHour: 0 })
  })

  it('starts from departure when the slider is past the arrival', () => {
    state().scrubTo(30)
    state().play({ routeId: 'A', endHour: 6 })
    expect(state()).toMatchObject({ playing: true, forecastHour: 0 })
  })
})

describe('switching routes', () => {
  it('stops a playing trip and rewinds to departure', () => {
    state().play({ routeId: 'A', endHour: 6 })
    state().advance(2)
    state().selectRoute('B')
    expect(state()).toMatchObject({
      selectedRouteId: 'B',
      playing: false,
      playback: null,
      forecastHour: 0,
    })
  })

  it('rewinds a trip that has already arrived', () => {
    state().play({ routeId: 'A', endHour: 3.5 })
    state().advance(3.5)
    state().selectRoute('C')
    expect(state()).toMatchObject({ selectedRouteId: 'C', forecastHour: 0 })
  })

  it('keeps an hour the user picked on the slider', () => {
    state().scrubTo(20)
    state().selectRoute('B')
    expect(state()).toMatchObject({ selectedRouteId: 'B', forecastHour: 20 })
  })

  it('rewinds when a checkpoint on another route is picked', () => {
    state().play({ routeId: 'A', endHour: 6 })
    state().advance(1)
    state().focusCheckpoint({ routeId: 'C', index: 2 })
    expect(state()).toMatchObject({ selectedRouteId: 'C', playing: false, forecastHour: 0 })
  })

  it('keeps playing when the selection stays on the same route', () => {
    state().play({ routeId: 'A', endHour: 6 })
    state().advance(1)
    state().focusCheckpoint({ routeId: 'A', index: 3 })
    expect(state()).toMatchObject({ selectedRouteId: 'A', playing: true, forecastHour: 1 })
  })
})

describe('starting a new trip', () => {
  it('clears the plan state and raises the phone sheet', () => {
    state().play({ routeId: 'A', endHour: 6 })
    state().setPanelTab('checkpoints')
    state().clearPlan()
    expect(state()).toMatchObject({
      selectedRouteId: null,
      playing: false,
      playback: null,
      forecastHour: 0,
      panelTab: 'routes',
      sheetSnap: 1,
    })
  })
})
