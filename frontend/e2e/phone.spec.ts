import { devices, expect, test } from '@playwright/test'

import { stubNetwork } from './fixtures/network'

// A phone: the planner lives in a bottom sheet over the map.
test.use({ ...devices['Pixel 7'] })

test('a tap or a click on the sheet handle steps through the snap points', async ({ page }) => {
  await stubNetwork(page)
  await page.goto('/')
  const sheet = page.getByRole('region', { name: 'Trip planner' })
  const handle = sheet.getByRole('button', { name: /^(Expand|Collapse) panel$/ })

  // An empty planner opens half way, with the form in view.
  await expect(handle).toHaveAttribute('aria-label', 'Expand panel')
  await expect(handle).toHaveAttribute('aria-expanded', 'true')

  // A finger tap and a mouse click (a narrow desktop window, a tablet with a
  // trackpad) both work.
  await handle.tap()
  await expect(handle).toHaveAttribute('aria-label', 'Collapse panel')
  await handle.click()
  await expect(handle).toHaveAttribute('aria-label', 'Expand panel')
  await expect(handle).toHaveAttribute('aria-expanded', 'false')
  await handle.click()
  await expect(handle).toHaveAttribute('aria-expanded', 'true')
})

test('dragging the handle still moves the sheet', async ({ page }) => {
  await stubNetwork(page)
  await page.goto('/')
  const sheet = page.getByRole('region', { name: 'Trip planner' })
  const handle = sheet.getByRole('button', { name: /^(Expand|Collapse) panel$/ })
  await expect(handle).toHaveAttribute('aria-label', 'Expand panel')

  // Drag the sheet from half way to the top.
  const box = await handle.boundingBox()
  if (!box) throw new Error('The sheet handle has no box')
  const x = box.x + box.width / 2
  await page.mouse.move(x, box.y + box.height / 2)
  await page.mouse.down()
  for (let y = box.y; y > 80; y -= 40) await page.mouse.move(x, y)
  await page.mouse.up()
  await expect(handle).toHaveAttribute('aria-label', 'Collapse panel')
})

test('the sheet header offers the demo before a trip is planned', async ({ page }) => {
  await stubNetwork(page)
  await page.goto('/')
  const sheet = page.getByRole('region', { name: 'Trip planner' })
  await sheet.getByRole('button', { name: /^Demo/ }).click()
  const dialog = page.getByRole('dialog', { name: 'How Haulcast works' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Close the demo' }).click()
  await expect(dialog).toBeHidden()
})
