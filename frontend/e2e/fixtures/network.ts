import type { Page } from '@playwright/test'

import type { HeatmapRequest, TripRequest } from '../../src/api/types'
import { BASEMAP_STYLE, BASEMAP_URL } from './basemap'
import { heatmapFor, OPEN_METEO_URL, openMeteoFor } from './heatmap'
import { PLACES } from './places'
import { planFor } from './plan'
import { RULES } from './rules'

/**
 * Serves the API, the basemap and the heatmap's Open-Meteo forecasts from fixtures, and blocks
 * everything else that leaves this machine.
 */
export async function stubNetwork(page: Page): Promise<void> {
  // Routes registered later run first, so this one only sees what the stubs below don't answer.
  await page.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.abort('blockedbyclient'),
  )
  await page.route(BASEMAP_URL, (route) =>
    route.fulfill({ json: BASEMAP_STYLE, headers: { 'Access-Control-Allow-Origin': '*' } }),
  )
  // The heatmap's forecasts, which the browser fetches itself.
  await page.route(
    (url) => url.href.startsWith(OPEN_METEO_URL),
    (route) =>
      route.fulfill({
        json: openMeteoFor(new URL(route.request().url())),
        headers: { 'Access-Control-Allow-Origin': '*' },
      }),
  )
  await page.route('**/api/**', (route) => {
    const request = route.request()
    switch (`${request.method()} ${new URL(request.url()).pathname}`) {
      case 'GET /api/rules/':
        return route.fulfill({ json: RULES })
      case 'GET /api/geocode/':
        return route.fulfill({ json: { results: PLACES } })
      case 'POST /api/plans/':
        return route.fulfill({ json: planFor(request.postDataJSON() as TripRequest) })
      case 'POST /api/heatmap/':
        return route.fulfill({ json: heatmapFor(request.postDataJSON() as HeatmapRequest) })
      default:
        return route.abort('blockedbyclient')
    }
  })
}
