import { expect, type Page, test } from '@playwright/test'

import { stubNetwork } from './fixtures/network'

/** Plans the Dallas to Atlanta sample and checks every clock time names the viewer's zone. */
async function expectZoneLabels(page: Page, zone: string) {
  await stubNetwork(page)
  await page.goto('/')
  const name = zone.replace(/[+]/g, '\\+')
  const clock = (prefix: string) => new RegExp(`${prefix}\\w{3} \\d{1,2}:\\d{2} [AP]M ${name}`)

  // The departure picker says whose clock it uses.
  await expect(page.getByLabel(`Departure (${zone})`)).toBeVisible()

  await page.getByRole('button', { name: 'Dallas to Atlanta' }).click()
  await expect(page.getByText(clock('Leaves '))).toBeVisible()
  const recommendation = page.getByRole('region', { name: /^Route B/ })
  await expect(recommendation).toContainText(clock('arrives '))
  const rows = page.getByRole('region', { name: 'Route options' }).getByRole('button', {
    name: /\bvia\b/,
  })
  for (const row of await rows.all()) await expect(row).toContainText(clock('arrives '))

  // The forecast slider's hour.
  const timeline = page.getByRole('region', { name: 'Forecast timeline' })
  await expect(timeline.getByText(new RegExp(`^\\w{3} \\d{1,2} [AP]M ${name}$`))).toBeVisible()

  // Checkpoint rows name the zone once, above the list.
  await page.getByRole('tab', { name: 'Checkpoints' }).click()
  const checkpoints = page.getByRole('region', { name: /^Checkpoints on Route/ })
  await expect(checkpoints).toContainText(`Times are ${zone}, your time zone.`)
  await expect(checkpoints.getByRole('listitem').first()).not.toContainText(zone)
}

test.describe('in Central time', () => {
  test.use({ timezoneId: 'America/Chicago' })
  test('clock times say CDT', async ({ page }) => {
    await expectZoneLabels(page, 'CDT')
  })
})

test.describe('outside North America', () => {
  test.use({ timezoneId: 'Asia/Manila' })
  test('clock times say GMT+8', async ({ page }) => {
    await expectZoneLabels(page, 'GMT+8')
  })
})
