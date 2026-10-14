import type { Factor, RiskRules, Thresholds } from '../../src/api/types'

/** GET /api/rules/: the risk table and load rules, as the API serves them. */
export const RULES: RiskRules = {
  levels: [
    { value: 0, slug: 'low', label: 'Low' },
    { value: 1, slug: 'moderate', label: 'Moderate' },
    { value: 2, slug: 'high', label: 'High' },
    { value: 3, slug: 'severe', label: 'Severe' },
    { value: 4, slug: 'no_travel', label: 'No Travel' },
  ],
  factors: {
    wind: { unit: 'mph', bounds: [25, 35, 45, 55], no_travel_inclusive: true },
    rain: { unit: 'in/hr', bounds: [0.1, 0.25, 0.5, 1], no_travel_inclusive: false },
    snow: { unit: 'in/hr', bounds: [0.5, 1, 2, 3], no_travel_inclusive: false },
  },
  load_rules: [
    {
      min_wind_mph: 55,
      max_wind_mph: null,
      heavier_than_lb: null,
      level: 'no_travel',
      description: '≥55 mph wind, any load',
    },
    {
      min_wind_mph: 45,
      max_wind_mph: 55,
      heavier_than_lb: 30_000,
      level: 'no_travel',
      description: '45–54 mph wind with a load over 30,000 lb',
    },
    {
      min_wind_mph: 35,
      max_wind_mph: 45,
      heavier_than_lb: 40_000,
      level: 'severe',
      description: '35–44 mph wind with a load over 40,000 lb',
    },
  ],
  recommendation_order: [
    'no_travel_miles',
    'severe_miles',
    'high_miles',
    'average_risk',
    'travel_time',
  ],
}

/**
 * The bands for the sample trip's 42,000 lb load, as plans and heatmaps carry
 * them: the load rules make 35 mph wind Severe and 45 mph No Travel.
 */
export const THRESHOLDS: Record<Factor, Thresholds> = {
  wind: { unit: 'mph', bounds: [25, 35, 35, 45], no_travel_inclusive: true },
  rain: RULES.factors.rain,
  snow: RULES.factors.snow,
}
