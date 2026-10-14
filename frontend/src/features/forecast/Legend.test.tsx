import { render, screen } from '@testing-library/react'

import type { Factor, Thresholds } from '../../api/types'
import { Legend } from './Legend'

const thresholds: Record<Factor, Thresholds> = {
  wind: { unit: 'mph', bounds: [25, 35, 35, 45], no_travel_inclusive: true },
  rain: { unit: 'in/hr', bounds: [0.1, 0.25, 0.5, 1], no_travel_inclusive: false },
  snow: { unit: 'in/hr', bounds: [0.5, 1, 2, 3], no_travel_inclusive: false },
}

describe('Legend', () => {
  it('lists every risk level', () => {
    render(<Legend metric="risk" thresholds={thresholds} />)
    for (const label of ['Low', 'Moderate', 'High', 'Severe', 'No Travel']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('skips a band the load rules empty and shows where the others start', () => {
    render(<Legend metric="wind" thresholds={thresholds} />)
    expect(screen.getByText('Below 25 mph')).toBeInTheDocument()
    expect(screen.getByText('Severe from 35')).toBeInTheDocument()
    expect(screen.queryByText(/High/)).not.toBeInTheDocument()
  })

  it('marks an exclusive No Travel bound', () => {
    render(<Legend metric="rain" thresholds={thresholds} />)
    expect(screen.getByText('No Travel above 1')).toBeInTheDocument()
  })
})
