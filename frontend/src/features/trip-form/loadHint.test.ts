import type { RiskRules } from '../../api/types'
import { loadHint } from './loadHint'

const rules: RiskRules['load_rules'] = [
  {
    min_wind_mph: 55,
    max_wind_mph: null,
    heavier_than_lb: null,
    level: 'no_travel',
    description: '',
  },
  {
    min_wind_mph: 45,
    max_wind_mph: 55,
    heavier_than_lb: 30_000,
    level: 'no_travel',
    description: '',
  },
  { min_wind_mph: 35, max_wind_mph: 45, heavier_than_lb: 40_000, level: 'severe', description: '' },
]

describe('loadHint', () => {
  it('lists every load rule that applies, mildest wind first', () => {
    expect(loadHint(42_000, rules)).toBe(
      'Over 40,000 lb: 35–44 mph wind counts as Severe, and 45–54 mph wind counts as No Travel.',
    )
  })

  it('names only the 30,000 lb rule between the limits', () => {
    expect(loadHint(30_001, rules)).toBe('Over 30,000 lb: 45–54 mph wind counts as No Travel.')
  })

  it('treats the limits as strict', () => {
    expect(loadHint(30_000, rules)).toBe(
      'At 30,000 lb or less, wind risk follows the standard bands.',
    )
  })
})
