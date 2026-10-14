import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { RISK, RISK_LEVELS } from './risk'

// Vitest runs from the frontend root; CSS imports are stubbed in tests.
const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8')

describe('risk palette', () => {
  it.each(RISK_LEVELS)('keeps the %s colours in sync with the CSS tokens', (level) => {
    const name = level.replace('_', '-')
    expect(css).toContain(`--color-risk-${name}: ${RISK[level].color};`)
    expect(css).toContain(`--color-risk-${name}-text: ${RISK[level].text};`)
  })

  it('orders levels by score', () => {
    expect(RISK_LEVELS.map((level) => RISK[level].score)).toEqual([0, 1, 2, 3, 4])
  })
})
