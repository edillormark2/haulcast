import { expect, test } from '@playwright/test'

import { stubNetwork } from './fixtures/network'

test('the demo opens in a dialog, plays from this site, and closes back to its button', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  const videoRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/demo/')) videoRequests.push(request.url())
  })
  await stubNetwork(page)
  await page.goto('/')

  // Nothing of the video loads until someone asks for it.
  const button = page.getByRole('button', { name: /Watch demo/ })
  await expect(button).toBeVisible()
  expect(videoRequests.filter((url) => url.endsWith('.mp4'))).toEqual([])

  await button.click()
  const dialog = page.getByRole('dialog', { name: 'How Haulcast works' })
  await expect(dialog).toBeVisible()
  const video = dialog.locator('video')
  await expect(video).toHaveAttribute('poster', /\/demo\/.+\.webp$/)
  await expect(dialog.locator('track[kind="captions"]')).toHaveAttribute('src', /\.vtt$/)
  // The browser picks a source it can play; Chromium takes the AV1 file.
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentSrc))
    .toMatch(/\/demo\/haulcast-demo-v\d+\.av1\.mp4$/)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(button).toBeFocused()
  expect(errors).toEqual([])
})
