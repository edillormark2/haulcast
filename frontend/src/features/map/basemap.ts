import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'

/** OpenFreeMap's Positron: keyless vector tiles with a quiet, low-ink style. */
export const BASEMAP_URL = 'https://tiles.openfreemap.org/styles/positron'

/**
 * Positron's greys, retinted toward the brand teal so the basemap sits
 * quietly under the risk colours: pale land and roads, water in the logo's
 * aqua, labels in the ink colour.
 */
const PAINT_OVERRIDES: Record<string, Record<string, string>> = {
  background: { 'background-color': '#eef3f4' },
  park: { 'fill-color': '#e2ebe8' },
  water: { 'fill-color': '#c9e0e2' },
  waterway: { 'line-color': '#bcd8db' },
  landuse_residential: { 'fill-color': '#e8eff0' },
  landcover_wood: { 'fill-color': '#e0e9e6' },
  highway_minor: { 'line-color': '#dbe4e6' },
  highway_major_casing: { 'line-color': '#c9d6d9' },
  highway_motorway_casing: { 'line-color': '#c2d0d3' },
  boundary_2: { 'line-color': '#9fb1b6' },
  boundary_3: { 'line-color': '#b7c5c9' },
  water_name_point_label: { 'text-color': '#3f727c' },
  water_name_line_label: { 'text-color': '#3f727c' },
  label_state: { 'text-color': '#62777e' },
  label_village: { 'text-color': '#2b4a53' },
  label_town: { 'text-color': '#2b4a53' },
  label_city: { 'text-color': '#16343d' },
  label_city_capital: { 'text-color': '#16343d' },
  label_country_1: { 'text-color': '#2b4a53' },
  label_country_2: { 'text-color': '#2b4a53' },
  label_country_3: { 'text-color': '#2b4a53' },
}

/** Detail a truck route planner doesn't need. Interstate shields stay. */
const HIDDEN =
  /^(building|aeroway|airport|railway|highway_path|highway-name-path|highway-name-minor|label_other)/

export function brandBasemap(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    // Positron sets no transition, so every paint change would ease for 300 ms.
    transition: { duration: 0, delay: 0 },
    projection: { type: 'mercator' },
    layers: style.layers
      .filter((layer) => !HIDDEN.test(layer.id))
      .map((layer) => {
        const overrides = PAINT_OVERRIDES[layer.id]
        if (!overrides || !('paint' in layer)) return layer
        return { ...layer, paint: { ...layer.paint, ...overrides } } as LayerSpecification
      }),
  }
}

export interface InsertionPoints {
  /** Under roads and borders, so the road network reads on top of the weather. */
  heatmap: string | undefined
  /** Above roads, under every label and shield. */
  overlays: string | undefined
}

export function insertionPoints(layers: LayerSpecification[]): InsertionPoints {
  let firstTrailingSymbol = layers.length
  while (firstTrailingSymbol > 0 && layers[firstTrailingSymbol - 1]?.type === 'symbol') {
    firstTrailingSymbol--
  }
  const ground = layers.find(
    (layer) =>
      'source-layer' in layer &&
      ['transportation', 'boundary'].includes(layer['source-layer'] ?? ''),
  )
  const overlays = layers[firstTrailingSymbol]?.id
  return { heatmap: ground?.id ?? overlays, overlays }
}
