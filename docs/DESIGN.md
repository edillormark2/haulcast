# Design record

How each requirement and evaluation criterion in the Spotter brief is met, and why the
main decisions went the way they did.

## Requirements traceability

| Brief | Where it's met |
| --- | --- |
| User enters origin and destination | Place search with suggestions ([`PlaceField.tsx`](../frontend/src/features/trip-form/PlaceField.tsx), Photon via [`geocoding.py`](../backend/planner/services/geocoding.py)) |
| …departure date/time | `datetime-local` input with quick picks; sent as ISO 8601 with the viewer's offset; validated to now−1 h … now+7 days |
| …load weight | Pounds, 0–80,000, with a live hint naming the load rules that apply at that weight |
| Generate 3 route options using a routing API | [`routing.py`](../backend/planner/services/routing.py): Valhalla truck costing (weight-aware), OSRM beyond Valhalla's distance limit, quality-checked via-point detours when the router returns fewer than three |
| Sample weather every 10 / 25 / 50 miles | Interval picker; [`geometry.checkpoint_miles`](../backend/planner/domain/geometry.py) places checkpoints at 0, N, 2N … plus the destination |
| …using the truck's estimated arrival time at each checkpoint | [`timeline.py`](../backend/planner/domain/timeline.py) turns router maneuver timings into elapsed time per mile; [`forecast.py`](../backend/planner/domain/forecast.py) reads wind at that instant and precipitation for the hour being driven through |
| Calculate weather risk using the risk/load rules | [`risk.py`](../backend/planner/domain/risk.py): table-driven bands, explicit boundary conventions, load rules as data |
| Recommend the best route, balancing risk and travel time | [`recommendation.py`](../backend/planner/domain/recommendation.py): No Travel gate, then the brief's four criteria in order; reason sentence and a "Not chosen" verdict for each route |
| Show routes, checkpoints, risk levels, ETAs and summaries on a map | Risk-coloured route lines, checkpoint dots with hover/click cards (ETA, readings, reason), route pills with travel time, truck marker; summaries and strips in the panel |
| Weather heatmap along the corridor with a 0–48 h slider | Corridor grid laid out by the plan ([`heatmap.py`](../backend/planner/services/heatmap.py)), hourly frames fetched and packed in the browser ([`openMeteo.ts`](../frontend/src/api/openMeteo.ts), [`heatmap.ts`](../frontend/src/lib/heatmap.ts)); WebGL2 layer ([`HeatmapLayer.ts`](../frontend/src/features/map/heatmap/HeatmapLayer.ts)); timeline with play/scrub ([`ForecastBar.tsx`](../frontend/src/features/forecast/ForecastBar.tsx)) |
| Deliverables: repository, hosted app, Loom | This repository; Vercel config in [`vercel.json`](../vercel.json); script in [`WALKTHROUGH.md`](WALKTHROUGH.md) |

## Against the evaluation criteria

### Routes, weather, risk and recommendation logic (40%)

- **Correctness lives in plain, framework-free functions**, with tests that pin every
  boundary of the table and the load rules.
- **The data matches the brief literally.**
  - Rain is `rain + showers` (liquid only, never `precipitation`, which includes snow
    water).
  - Snow is `snowfall` in inches.
  - Wind is the sustained 10 m wind; gusts are shown but not scored.
- **The time alignment is deliberate.**
  - Wind is instantaneous, so it's interpolated between hours.
  - Rain and snow are hourly totals, so they come from the hour the truck is driving
    through.
- **Miles are attributed so they sum exactly to the route length.** Midpoint coverage
  means "Severe miles" are real miles, not "checkpoints × interval".
- **The recommendation can be audited.** Every ranking step is shown, comparisons happen
  at displayed precision, and each losing route gets a one-line reason.
- **Three routes are real alternatives.** Detours are rejected for U-turns, doubling
  back, more than 70% overlap with any kept route, or being over 1.5× slower. If
  geography allows only two routes, the app says so.

### UI, map and heatmap smoothness and performance (40%)

- **Heatmap scrubbing costs one uniform change.** All frames sit in a GPU 3D texture;
  space and time are interpolated in the shader, and risk is classified per pixel.
- **Hot paths bypass React.**
  - **Map-side updates.** The heatmap frame, truck marker, route-strip cursor and
    checkpoint highlight all update through store subscriptions.
  - **What does re-render.** Only the slider itself re-renders during playback.
- **Playback follows the trip.** Play drives the selected route from departure to
  arrival in 10–20 s, whatever its length, while the 0–48 h slider stays free for the
  forecast. Switching routes rewinds a played trip, and an hour picked by hand stays put.
- **MapLibre is driven imperatively.**
  - **Data updates.** Routes are uploaded with `setData` only when the selection changes
    their order; hover and checkpoint highlights are feature-state.
  - **Basemap style.** It is transformed once at load: recoloured, decluttered, with paint
    transitions off.
  - **Layer order.** Weather sits under roads and route lines under labels.
- **Delivery is fast.**
  - A static shell in `index.html` paints the layout before any JavaScript runs.
  - The app's own code is 38 kB gzipped. MapLibre is a lazy chunk, preloaded at low
    priority, so the panel works while the map downloads. Vendor chunks cache separately.
  - Fonts are self-hosted, and the Latin subset is preloaded.
  - The API function runs in Frankfurt, beside its upstream services, and the CDN caches
    rules and place searches.
- **Every wait is visible.** The map, slow tiles, planning, the heatmap, the load rules
  and place search each have their own loading state. A busy free service gets a named
  countdown to an automatic retry.
  - API responses are compact: geometry is simplified to about 30 m, and the heatmap is
    one base64 byte array.
  - The heatmap needs no second server request: the plan carries its layout, and the
    browser fetches the forecasts straight from Open-Meteo.
- **Motion is purposeful.**
  - A camera ease-out frames the new routes.
  - Route rows slide in once per plan.
  - Presses scale slightly.
  - The phone sheet snaps with velocity.
  - Reduced-motion users get instant equivalents.

### Code quality (15%)

- **Layers.** Domain, integrations, services and api on the backend; feature folders, a
  typed API client, URL-as-state and a small UI store on the frontend.
- **Strict tooling** everywhere: mypy strict, Ruff, ESLint strict type-checked, TypeScript
  strict with `noUncheckedIndexedAccess`, Prettier. CI runs every check and test.
- **One error envelope** for every API failure, with a friendly message per case.

### Documentation and walkthrough (5%)

- **README** with the rules, assumptions, API and architecture; this design record; the
  walkthrough script.

## Key decisions

| Decision | Alternatives considered | Why |
| --- | --- | --- |
| Keyless public services (Valhalla, OSRM, Open-Meteo, Photon, OpenFreeMap) | TomTom, HERE, Mapbox with API keys | Reviewers can clone and run without sign-ups; the URLs are configurable for paid or self-hosted instances |
| Valhalla truck costing ≤ 800 mi, OSRM beyond, both capped at 65 mph | One provider | Truck restrictions where possible; the public Valhalla server rejects trips over 1,500 km. One speed cap keeps ETAs from depending on the engine (Valhalla's truck default is 75 mph) |
| Generated detours for the missing options | Accepting fewer routes | The brief asks for three; quality checks keep them meaningful |
| Sustained wind for scoring | Gusts | The literal reading of "Wind"; gusts would make most windy days No Travel. Gusts are still shown |
| Continuous driving for ETAs | Hours-of-Service breaks | Matches the brief; HOS is listed as a known limit |
| No Travel ranked before the brief's criteria | Treating it as Severe | A route through No Travel can't be driven as planned |
| Classify interpolated values, not interpolated levels | Interpolating levels | Avoids false bands between calm and stormy cells |
| Clamped Catmull-Rom spatial interpolation | Bilinear, B-spline | Round contours, exact at cells, never beyond the data (a B-spline would understate peaks) |
| One forecast window per 6-hour departure block, shared by the plan and its heatmap | A window per request | Open-Meteo's free tier charges per location, not per hour, so the longer window is free, and the heatmap, coarser intervals and nearby departures reuse its forecasts |
| Heatmap cells read at the plan's 50-mile checkpoints when they contain one | Always at the cell centre | 30–54% fewer heatmap calls on the sample trips, for about the accuracy of one coarser grid step (measured against a finer grid over 49 frames) |
| Heatmap forecasts fetched by the viewer's browser, the server as fallback | The server fetching them | Each viewer spends their own Open-Meteo quota instead of the function's shared egress IP, so the server pays for plans only (100–136 calls per sample trip instead of 260–350). The browser packs the same bytes as the server (a shared fixture checks), at the cost of a copy of the packing code and viewers' IPs reaching Open-Meteo |
| Busy services answered with `retry_after`, retried by the browser with a countdown | Retrying inside the request | A per-minute limit can outlast any request; the user sees what is happening and can try at once |
| Stateless API with the trip in the URL | Persisting plans in a database | Shareable links, any instance serves any request, nothing to migrate; forecasts are refreshed on every visit |
| MapLibre directly (no React wrapper) | react-map-gl | Full control of a custom WebGL layer under MapLibre 6; fewer moving parts |
| Base UI primitives, native radios for segmented controls | Radix, React Aria | Accessible combobox, slider and tabs from one family; radios need no JS |
| Custom bottom sheet | Base UI Drawer, Vaul | A permanent, non-modal map sheet; Drawer is built as a dismissable dialog and Vaul is unmaintained |
