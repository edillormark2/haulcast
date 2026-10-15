import { act, fireEvent, render, screen } from '@testing-library/react'

import { RetryNotice } from './RetryNotice'

describe('RetryNotice', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('counts down to the next try and can try at once', () => {
    const onRetryNow = vi.fn()
    render(
      <RetryNotice retry={{ service: 'Open-Meteo', waitS: 3, attempt: 1 }} onRetryNow={onRetryNow}>
        Open-Meteo is busy right now.
      </RetryNotice>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Open-Meteo is busy right now.')
    expect(screen.getByText('in 3 s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(screen.getByText('in 1 s')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(screen.getByText('now')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try now' }))
    expect(onRetryNow).toHaveBeenCalledOnce()
  })

  it('restarts the countdown when a retry fails again', () => {
    const notice = (attempt: number, waitS: number) => (
      <RetryNotice retry={{ service: 'Open-Meteo', waitS, attempt }} onRetryNow={() => {}}>
        Busy.
      </RetryNotice>
    )
    const { rerender } = render(notice(1, 2))
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(screen.getByText('now')).toBeInTheDocument()

    rerender(notice(2, 20))
    expect(screen.getByText('in 20 s')).toBeInTheDocument()
  })

  it("doesn't announce the ticking seconds to screen readers", () => {
    render(
      <RetryNotice retry={{ service: 'Open-Meteo', waitS: 9, attempt: 1 }} onRetryNow={() => {}}>
        Busy.
      </RetryNotice>,
    )
    expect(screen.getByText('in 9 s')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('shortly')).toHaveClass('sr-only')
  })
})
