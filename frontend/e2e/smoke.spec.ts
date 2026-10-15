import { expect, type Page, type Route, test } from '@playwright/test'

import type { HeatmapRequest, TripRequest } from '../src/api/types'
import { BASEMAP_STYLE, BASEMAP_URL } from './fixtures/basemap'
import { heatmapFor } from './fixtures/heatmap'
import { PLACES } from './fixtures/places'
import { planFor } from './fixtures/plan'
import { RULES } from './fixtures/rules'

test('plans a sample trip, compares routes, plays the trip and starts over', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  const api = await stubNetwork(page)

  // One click on a sample trip plans it, and the trip lands in the URL.
  await page.goto('/')
  await page.getByRole('button', { name: 'Dallas to Atlanta' }).click()
  await expect(page).toHaveURL(/[?&]from=.+&to=/)
  const params = new URL(page.url()).searchParams
  expect(params.get('from')).toBe('32.77670,-96.79700,Dallas, Texas, US')
  expect(params.get('to')).toBe('33.74900,-84.38800,Atlanta, Georgia, US')

  // The decision first, then the three options, safest first.
  const recommendation = page.getByRole('region', { name: 'Route B via I-30 & I-22' })
  await expect(recommendation).toContainText('Recommended')
  expect(api.plans).toMatchObject([
    { origin: { label: 'Dallas, Texas, US' }, destination: { label: 'Atlanta, Georgia, US' } },
  ])
  const routeOptions = page.getByRole('region', { name: 'Route options' })
  const rows = routeOptions.getByRole('button', { name: /\bvia\b/ })
  await expect(rows).toHaveCount(3)
  await expect(rows).toContainText(['via I-30 & I-22', 'via US-82', 'via I-20'])

  // The map draws the routes when WebGL 2 is available, and says why not otherwise.
  const webgl2 = await page.evaluate(
    () => document.createElement('canvas').getContext('webgl2') !== null,
  )
  test.info().annotations.push({ type: 'map', description: webgl2 ? 'WebGL 2' : 'no WebGL 2' })
  const map = page.getByRole('region', { name: 'Route map' })
  await expect(
    webgl2
      ? map.getByRole('button', { name: /^Route B, .+, recommended$/ })
      : page.getByText("This browser can't draw the map"),
  ).toBeVisible()

  // Selecting another route moves the selection, and its checkpoints follow.
  const routeB = rows.filter({ hasText: 'via I-30 & I-22' })
  const routeC = rows.filter({ hasText: 'via US-82' })
  await expect(routeB).toHaveAttribute('aria-pressed', 'true')
  await routeC.click()
  await expect(routeC).toHaveAttribute('aria-pressed', 'true')
  await expect(routeB).toHaveAttribute('aria-pressed', 'false')

  await page.getByRole('tab', { name: 'Checkpoints' }).click()
  const checkpoints = page.getByRole('region', { name: 'Checkpoints on Route C' })
  await expect(checkpoints.getByRole('listitem')).toHaveCount(6)
  await expect(checkpoints.getByRole('listitem').first()).toContainText('Start')
  await expect(checkpoints.getByRole('listitem').last()).toContainText('End')

  // The forecast slider steps an hour at a time, and playback runs the clock.
  const timeline = page.getByRole('region', { name: 'Forecast timeline' })
  await expect(timeline.getByText('Departure', { exact: true })).toBeVisible()
  await timeline.getByRole('slider', { name: 'Forecast hour' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(timeline.getByText('+1 h', { exact: true })).toBeVisible()
  await expect(timeline.getByText('Departure', { exact: true })).toBeHidden()

  // Play drives the selected route's trip from where the slider is.
  await timeline.getByRole('button', { name: 'Play the trip on Route C' }).click()
  await expect(timeline.getByRole('button', { name: 'Pause the trip on Route C' })).toBeVisible()
  await expect(timeline.getByText('+1 h', { exact: true })).toBeHidden()

  // Switching routes stops the trip and rewinds the truck to departure.
  await page.getByRole('tab', { name: 'Routes' }).click()
  await routeB.click()
  await expect(timeline.getByRole('button', { name: 'Play the trip on Route B' })).toBeVisible()
  await expect(timeline.getByText('Departure', { exact: true })).toBeVisible()

  // New trip goes back to a blank planner and the sample trips.
  await page.getByRole('button', { name: 'New trip' }).click()
  await expect(page).not.toHaveURL(/[?&]from=/)
  await expect(page.getByRole('button', { name: 'Dallas to Atlanta' })).toBeVisible()
  await expect(timeline).toBeHidden()

  expect(api.unstubbed).toEqual([])
  expect(errors).toEqual([])
})

interface FakeApi {
  /** Trips the app asked to plan. */
  plans: TripRequest[]
  /** Requests no stub answered. They are blocked, so a run never reaches a real service. */
  unstubbed: string[]
}

async function stubNetwork(page: Page): Promise<FakeApi> {
  const api: FakeApi = { plans: [], unstubbed: [] }
  const block = (route: Route) => {
    api.unstubbed.push(`${route.request().method()} ${route.request().url()}`)
    return route.abort('blockedbyclient')
  }

  // Anything off this machine. Routes registered later run first, so this one
  // only sees requests the stubs below don't answer.
  await page.route((url) => url.hostname !== 'localhost', block)

  await page.route(BASEMAP_URL, (route) =>
    route.fulfill({ json: BASEMAP_STYLE, headers: { 'Access-Control-Allow-Origin': '*' } }),
  )

  await page.route('**/api/**', (route) => {
    const request = route.request()
    switch (`${request.method()} ${new URL(request.url()).pathname}`) {
      case 'GET /api/rules/':
        return route.fulfill({ json: RULES })
      case 'GET /api/geocode/':
        return route.fulfill({ json: { results: PLACES } })
      case 'POST /api/plans/': {
        const trip = request.postDataJSON() as TripRequest
        api.plans.push(trip)
        return route.fulfill({ json: planFor(trip) })
      }
      case 'POST /api/heatmap/':
        return route.fulfill({ json: heatmapFor(request.postDataJSON() as HeatmapRequest) })
      default:
        return block(route)
    }
  })

  return api
}
