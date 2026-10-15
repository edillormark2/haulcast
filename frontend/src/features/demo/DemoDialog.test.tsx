import { act, fireEvent, render, screen } from '@testing-library/react'
import type { MockInstance } from 'vitest'

import { useUiStore } from '../../state/uiStore'
import { DemoButton } from './DemoButton'
import { DemoDialog } from './DemoDialog'

// jsdom has no modal dialog or media playback; these stand in for the browser's.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

let play: MockInstance<() => Promise<void>>
let pause: MockInstance<() => void>

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  useUiStore.setState({ demoOpen: false, playing: false })
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderDemo() {
  render(
    <>
      <DemoButton tone="dark" />
      <DemoDialog />
    </>,
  )
  return {
    button: screen.getByRole('button', { name: /Watch demo/ }),
    dialog: () => screen.getByRole('dialog', { hidden: true }),
  }
}

describe('demo video', () => {
  it('opens on request and loads the video only then', () => {
    const { button, dialog } = renderDemo()
    expect(dialog()).not.toHaveAttribute('open')
    expect(document.querySelector('video')).toBeNull()

    fireEvent.click(button)

    expect(dialog()).toHaveAttribute('open')
    expect(dialog()).toHaveAccessibleName('How Haulcast works')
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    expect(
      [...(video?.querySelectorAll('source') ?? [])].map((s) => s.getAttribute('type')),
    ).toEqual([
      'video/mp4; codecs="av01.0.08M.08, mp4a.40.2"',
      'video/mp4; codecs="avc1.640029, mp4a.40.2"',
    ])
    expect(video?.querySelector('track[kind="captions"]')).toHaveAttribute('srclang', 'en')
    expect(play).toHaveBeenCalledOnce()
  })

  it('closes from its button, pauses, and drops the player after the fade', () => {
    const { button, dialog } = renderDemo()
    button.focus()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: 'Close the demo', hidden: true }))

    expect(useUiStore.getState().demoOpen).toBe(false)
    expect(dialog()).not.toHaveAttribute('open')
    expect(pause).toHaveBeenCalled()
    expect(button).toHaveFocus()

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(document.querySelector('video')).toBeNull()
  })

  it('closes on Escape and on a click outside the video', () => {
    const { button, dialog } = renderDemo()
    fireEvent.click(button)
    fireEvent(dialog(), new Event('cancel', { cancelable: true }))
    expect(dialog()).not.toHaveAttribute('open')

    fireEvent.click(button)
    fireEvent.click(dialog())
    expect(dialog()).not.toHaveAttribute('open')
  })

  it('pauses a playing trip so the narration plays alone', () => {
    const { button } = renderDemo()
    useUiStore.setState({ playing: true })
    fireEvent.click(button)
    expect(useUiStore.getState().playing).toBe(false)
  })

  it('invites a first visit with a pulse, and drops it once the demo has been opened', () => {
    const first = render(<DemoButton tone="light" compact />)
    expect(first.container.querySelector('[class*="demo-ping"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Demo/ })).toHaveTextContent(/^Demo$/)
    first.unmount()

    window.localStorage.setItem('haulcast:demo-seen', '1')
    const again = render(<DemoButton tone="light" compact />)
    expect(again.container.querySelector('[class*="demo-ping"]')).toBeNull()
  })
})
