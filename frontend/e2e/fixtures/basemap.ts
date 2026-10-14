import type { StyleSpecification } from 'maplibre-gl'

/** OpenFreeMap's Positron style, as the app requests it. */
export const BASEMAP_URL = 'https://tiles.openfreemap.org/styles/positron'

/** A valid style with no sources, so the map loads without fetching a single tile. */
export const BASEMAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef3f4' } }],
}
