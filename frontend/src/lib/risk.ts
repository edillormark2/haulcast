export const RISK_LEVELS = ['low', 'moderate', 'high', 'severe', 'no_travel'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

interface RiskStyle {
  label: string
  /** Score used for averages: 0 (Low) to 4 (No Travel). */
  score: number
  /** Fill colour for map lines, dots and bars. Mirrors --color-risk-* in index.css. */
  color: string
  /** Text colour for labels on a tinted background. */
  text: string
}

export const RISK: Record<RiskLevel, RiskStyle> = {
  low: { label: 'Low', score: 0, color: '#045d69', text: '#045d69' },
  moderate: { label: 'Moderate', score: 1, color: '#f6d653', text: '#6b5200' },
  high: { label: 'High', score: 2, color: '#f8962d', text: '#8c4300' },
  severe: { label: 'Severe', score: 3, color: '#ea3c3f', text: '#b01e24' },
  no_travel: { label: 'No Travel', score: 4, color: '#581e5c', text: '#581e5c' },
}

export function riskAtLeast(level: RiskLevel, floor: RiskLevel): boolean {
  return RISK[level].score >= RISK[floor].score
}
