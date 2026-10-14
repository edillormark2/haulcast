# Haulcast: weather-aware truck routing

**Live app: [haulcast.vercel.app](https://haulcast.vercel.app)**

A React + Django app that helps a truck driver choose the safest route. It finds three
route options, reads the forecast at every checkpoint **for the moment the truck will be
there**, scores wind, rain and snow against the brief's risk and load rules, and recommends
the route with the least dangerous weather, explaining why in plain language. A 48-hour
weather heatmap along the corridor shows how conditions move while the truck is on the road.

![Desktop: three routes from Chicago to Denver, the recommended one highlighted, with the corridor heatmap and forecast timeline](docs/screenshot-desktop.jpg)

<img src="docs/screenshot-mobile.jpg" alt="Phone layout: forecast bar on top, recommendation in a bottom sheet" width="225" align="right">

**Highlights**

- **Three genuinely different routes**: truck routing (Valhalla) with the load's weight,
  plus generated detours when the router returns fewer than three.
- **Weather at the truck's ETA**: checkpoints every 10, 25 or 50 miles, each read at its
  own arrival time.
- **Risk exactly per the brief**, with every boundary pinned by tests, including the
  load rules for heavy trucks.
- **Recommendation you can check**: fewest No Travel, then Severe, then High miles, then
  lowest average risk, then shortest time, with the reason for each route spelled out.
- **A smooth WebGL heatmap**: 49 hourly frames live on the GPU, so the 0–48 h slider
  scrubs and plays at 60 fps with no network or React work.
- **Keyless**: OpenStreetMap routing, Open-Meteo forecasts and OpenFreeMap tiles. Clone
  it and run it.

<br clear="right">

## Contents

1. [Quick start](#quick-start)
2. [How a plan is made](#how-a-plan-is-made)
3. [Risk rules and recommendation](#risk-rules-and-recommendation)
4. [The heatmap](#the-heatmap)
5. [Architecture](#architecture)
6. [API](#api)
7. [Design](#design)
8. [Quality](#quality)
9. [Deployment](#deployment)
10. [Assumptions and limits](#assumptions-and-limits)

More detail: [design record](docs/DESIGN.md) (requirement-by-requirement) and the
[walkthrough script](docs/WALKTHROUGH.md).

## Quick start

Requirements: Python 3.12+ with [uv](https://docs.astral.sh/uv/), Node 20.19+.

```bash
# API on http://127.0.0.1:8000
cd backend
uv sync
DJANGO_DEBUG=1 uv run python manage.py runserver

# Web app on http://localhost:5173 (proxies /api to the API)
cd frontend
npm install
npm run dev
```

Open the app and pick a sample trip, or type an origin and destination. No API keys or
database are needed. Every trip is a URL, so plans are shareable links.

| Command | Where | What |
| --- | --- | --- |
| `uv run pytest` | `backend/` | 118 tests: risk boundaries, ranking, geometry, API with faked services |
| `uv run ruff check . && uv run mypy planner config` | `backend/` | Lint and strict type-check |
| `npm test` | `frontend/` | 41 tests: thresholds, heatmap sampling, geometry, URL state, UI |
| `npm run lint && npm run build` | `frontend/` | ESLint (strict, type-aware), type-check, production build |

## How a plan is made

```mermaid
flowchart LR
  A[Origin, destination,<br/>departure, load] --> B[Route options<br/>Valhalla truck / OSRM]
  B --> C[Checkpoints every<br/>10 / 25 / 50 mi + ETAs]
  C --> D[Open-Meteo hourly forecast<br/>read at each ETA]
  D --> E[Risk per checkpoint<br/>thresholds + load rules]
  E --> F[Miles per risk level<br/>per route]
  F --> G[Ranking + plain-language reason]
  B -. corridor .-> H[Heatmap grid, 49 hourly frames]
```

1. **Routes.** Trips up to 800 miles straight-line use Valhalla's **truck** costing with the
   truck's gross weight (load + 35,000 lb tare), so roads closed to heavy trucks are
   avoided. The public Valhalla server rejects anything over 1,500 km, so longer trips use
   OSRM with a 65 mph truck speed cap applied to every road segment. The router's own
   alternatives come first. If it returns fewer than three, Haulcast routes through a via
   point offset to either side of the fastest route's midpoint. A detour is kept only if
   it:
   - is at most 1.5× slower than the fastest route;
   - overlaps every other option by no more than 70%;
   - has no U-turns and doesn't double back on itself.

   If the geography allows only two real options, the app shows two and says so rather
   than padding with a near-copy.
2. **Checkpoints and ETAs.** A checkpoint sits every 10, 25 or 50 miles from the origin,
   plus one at the destination. The router's per-maneuver timings give the truck's
   elapsed time at every mile, so each checkpoint has its own ETA.
3. **Weather at the ETA.** Open-Meteo's hourly forecast is read at each checkpoint's ETA:
   - *Wind:* an instantaneous value, interpolated between the surrounding hours.
   - *Rain and snow:* hourly totals, so the app uses the hour the truck is driving
     through. Rain is `rain + showers` (liquid only); snow is `snowfall` in inches.

   Lookups are snapped to a 0.05° lattice (≤ 3.5 km, finer than the forecast models),
   de-duplicated across routes, batched 150 per request and cached for 30 minutes.
4. **Risk, exposure, recommendation.** See below.

## Risk rules and recommendation

Thresholds per checkpoint, straight from the brief:

| Condition | Low | Moderate | High | Severe | No Travel |
| --- | --- | --- | --- | --- | --- |
| Wind (mph) | < 25 | 25–34 | 35–44 | 45–54 | ≥ 55 |
| Rain (in/hr) | < 0.10 | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | > 1.00 |
| Snow (in/hr) | < 0.5 | 0.5–1.0 | 1.0–2.0 | 2.0–3.0 | > 3.0 |

Load rules: ≥ 55 mph is No Travel for any load; 45–54 mph with **more than** 30,000 lb is
No Travel; 35–44 mph with **more than** 40,000 lb is Severe.

**Edge cases, decided explicitly** ([`risk.py`](backend/planner/domain/risk.py)):

- **Shared band edges.** The table's bands share endpoints (0.25 is in both Moderate and
  High), so each band's lower bound is inclusive and the shared value takes the higher
  band: 0.25 in/hr is High, 35 mph is High.
- **Whole-number wind bands** are continuous half-open ranges: 34.6 mph is Moderate.
- **No Travel's edge** follows the table's own sign: 55 mph *is* No Travel, but 1.00 in/hr
  of rain and 3.0 in/hr of snow are still Severe.
- **Load limits are strict:** exactly 30,000 or 40,000 lb does not escalate.
- **Rounding before classifying.** Readings are rounded to the precision the UI shows
  (0.1 mph, 0.01 in/hr), so a value on screen always matches its band. This also stops
  floating-point noise: `0.07 + 0.03` is `0.0999…` in binary.
- **Sustained wind.** "Wind" is read as sustained wind speed; gusts are shown at every
  checkpoint but don't score.
- **Overall level.** A checkpoint's level is its worst factor. The factors that set it,
  and any load rule that applied, are shown with it.

**Miles per level.** Each checkpoint stands for the road halfway to its neighbours, so a
route's stretches add up to its exact length. Average risk is the distance-weighted mean
of scores 0 (Low) to 4 (No Travel).

**Ranking** ([`recommendation.py`](backend/planner/domain/recommendation.py)) is
lexicographic, in the brief's order, with one addition in front:

0. **Fewest No Travel miles.** The brief's list doesn't rank No Travel because it's a
   stop, not a degree of risk; a route through it can't be driven as planned.
1. Fewest Severe miles
2. Fewest High miles
3. Lowest average risk
4. Shortest travel time

Values are compared at displayed precision (0.1 mi, 0.01 average, whole minutes), so
floating-point noise never decides and the explanation never contradicts the screen.

The recommendation comes with:

- a reason sentence, e.g. *"Route B avoids the 25 mi of Severe weather on Route A and
  matches Route C's weather risk while being 23 min faster"*;
- a "Not chosen" line for every other route;
- a warning when even the best route crosses Severe or No Travel weather.

## The heatmap

**On the server**
([`heatmap.py`](backend/planner/services/heatmap.py), [`corridor.py`](backend/planner/domain/corridor.py)):

- **Grid.** The heatmap samples a grid over the routes, limited to cells within 35 miles
  of any route. Grid spacing adapts so a trip needs at most 220 forecast points.
- **Frames.** Frame *k* is the weather at *departure + k hours*, read with the same
  function the checkpoints use, so the two agree at whole hours.
- **Packing.** Wind, rain, snow and a corridor-edge weight are packed as RGBA bytes. Every
  threshold lands on a whole byte.

**In the browser**
([`HeatmapLayer.ts`](frontend/src/features/map/heatmap/HeatmapLayer.ts), [`shaders.ts`](frontend/src/features/map/heatmap/shaders.ts)):

- **One texture, one draw call.** All 49 frames are uploaded once as a 3D texture, and a
  custom WebGL2 layer draws the corridor in a single draw call. Moving the slider changes
  one uniform: no fetching, no CPU resampling, no re-render.
- **Interpolation.** Space uses a Catmull-Rom curve clamped to the nearest four cells, so
  contours are round but never invent values beyond the data. Time is blended linearly
  between hours.
- **Classification.** Risk is computed per pixel from the interpolated wind, rain and snow
  against this load's thresholds. Interpolating risk *levels* instead would draw false
  Moderate/High rings between a calm cell and a stormy one.
- **No colour-only cues.** No Travel gets road-closed hatching, and the same colours mean
  the same bands in the Risk, Wind, Rain and Snow views.
- **Hover readouts** use a CPU copy of the same maths ([`heatmap.ts`](frontend/src/lib/heatmap.ts)).
- **Playback.** A small clock drives playback at 4 forecast-hours per second and eases the
  map toward the slider while scrubbing. Hour changes reach the heatmap, the truck marker
  and the route strips through store subscriptions, outside React rendering.

## Architecture

```
backend/                        Django 5.2 LTS + DRF, stateless (no database)
  config/                       settings from environment variables
  planner/
    domain/                     pure Python, no framework: the logic reviewers care about
      risk.py                   thresholds, load rules, classification
      recommendation.py         exposure, ranking, explanations
      geometry.py  timeline.py  forecast.py  corridor.py
    integrations/               HTTP clients: valhalla, osrm, open_meteo, photon (+ retries, throttles)
    services/                   orchestration: routing, trip_planner, forecasts (cache), heatmap
    api/                        serializers (validation), views, presenters (JSON), error envelope
    tests/                      pytest, with respx faking every upstream service
frontend/                       React 19 + TypeScript (strict) + Vite 8 + Tailwind 4
  src/api/                      typed client and TanStack Query hooks
  src/state/                    trip in the URL, UI state in a small Zustand store
  src/features/
    map/                        MapLibre GL 6: routes, checkpoints, labels, camera, WebGL heatmap
    forecast/                   timeline slider, playback clock, legend
    routes/  checkpoints/       recommendation, ranked routes with risk strips, itinerary
    trip-form/  planner/        form with place search, panel composition, empty/loading/error
  src/ui/                       Button, Segmented, RiskBadge, WeatherReadout, BottomSheet
api/index.py                    Vercel entry point (WSGI)
```

**Why it's shaped this way**

- **The rules live in a framework-free domain layer.** It's tested in isolation, with no
  HTTP or Django involved.
- **Upstream services sit behind small typed clients.** Swapping in a commercial router
  touches one module.
- **The backend stores nothing.** Trips live in the URL, upstream answers live in Django's
  cache, and the heatmap request carries its own corridor, so any instance can serve any
  request.
- **The map is driven imperatively.** React decides *what* is on the map; MapLibre layers
  and the GPU handle *how*, so 60 fps work never goes through React.

**Performance**

- **Slider and playback** touch only a uniform, a marker and two style properties.
- **Load cost.** The app's own code is 42 kB gzipped; React, UI primitives and MapLibre
  are cached in separate chunks.
- **Plan cost.**
  - **Routes** are cached for 30 minutes, so changing the checkpoint interval re-plans in
    about 0.3 s.
  - **Forecasts** come from parallel batched lookups, cached per cell.
  - **Route geometry** is thinned to 5 m before processing.

## API

All responses are JSON; errors share one envelope:
`{"error": {"code", "message", "fields"?}}`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health/` | Liveness |
| `GET /api/rules/` | The thresholds, load rules and ranking order (the UI's legends read these) |
| `GET /api/geocode/?q=denver` | Place suggestions (Photon, North America first) |
| `POST /api/plans/` | Plan a trip (below) |
| `POST /api/heatmap/` | Heatmap frames for a plan's `heatmap_request` |

```jsonc
// POST /api/plans/
{
  "origin": {"label": "Chicago, IL", "lat": 41.8781, "lon": -87.6298},
  "destination": {"label": "Denver, CO", "lat": 39.7392, "lon": -104.9903},
  "departure": "2026-10-16T06:00:00-05:00",   // ISO 8601 with offset, now−1 h to now+7 days
  "load_lb": 42000,                            // 0–80,000
  "interval_mi": 25                            // 10, 25 or 50
}
// → trip, thresholds (for this load), routes[] with geometry, risk sections, exposure and
//   checkpoints[] (mile, ETA, weather, level, drivers, load rule, reason), recommendation
//   {route_id, ranking, reason, comparisons[], warning}, heatmap_request, notes, meta.timings_ms
```

| Status | When |
| --- | --- |
| 400 `invalid_request` | Field errors, with per-field messages |
| 422 `no_route` | No road connects the places |
| 503 `upstream_busy` | A free service is rate-limiting |
| 502 `upstream_error` | A service failed |

## Design

- **Brand.**
  - **Palette.** The colours are sampled from the Spotter brief and logo: dark teal
    `#043D4C` for chrome and primary actions, teal `#008080`, aqua `#BCDDDE` and coral
    `#F84960`.
  - **Neutrals and basemap.** Neutrals are tinted toward the teal, and OpenFreeMap's
    Positron basemap is recoloured to match.
  - **Header.** The panel header closes in the same gentle wave as the brief's page edges.
- **Risk colours** were tuned to stay distinct under protanopia, deuteranopia and
  tritanopia. Colour is never the only cue: every level also has text, and No Travel has
  stripes.
- **Typography.** Overpass is an open descendant of Highway Gothic, the US road-sign
  typeface, so numbers read like the signs drivers know. Data uses tabular figures.
- **Layout: the decision first.**
  - **Order.** The recommendation and its reason come first, then the evidence (route
    strips, map), then the detail (checkpoint itinerary).
  - **Route strips.** Each route is unrolled as a bar on one shared mile scale and
    coloured by risk; hovering a stretch highlights its checkpoint on the map.
  - **Phones.** A bottom sheet keeps the recommendation in its header even when collapsed.
- **Motion,** following Emil Kowalski's interface principles:
  - short ease-out transitions (150–250 ms, `cubic-bezier(0.23, 1, 0.32, 1)`);
  - a 97% press scale;
  - a camera that eases out;
  - velocity-aware sheet snapping;
  - nothing animated that the user didn't cause;
  - `prefers-reduced-motion` respected throughout, including discrete playback steps.
- **Accessibility.**
  - **Keyboard.** Every control is keyboard-operable with visible focus.
  - **Form controls.** Segmented controls are native radio groups, place search is a
    WAI-ARIA combobox (Base UI), and the slider announces times ("Thu 3:00 PM, 7 hours
    after departure").
  - **Screen readers.** Route strips carry a text summary.

## Quality

- **Domain tests pin every rule.**
  - **Boundaries.** Every band edge of the table, and the load-rule grid.
  - **Load thresholds.** An exhaustive check at every 0.1 mph from 0 to 90 at six loads
    shows the folded thresholds behind the heatmap and legends match `assess()` exactly.
  - **Ranking.** Each criterion decides on its own, the No Travel gate applies first, and
    floating-point noise never decides.
- **The API is tested end to end** against faked Valhalla and Open-Meteo: ranking, risk
  sections, the heatmap byte layout, validation and upstream-failure mapping.
- **Static checks run strict.** Ruff and mypy (strict) on the backend; ESLint
  (`strictTypeChecked`), TypeScript strict and Prettier on the frontend. CI runs all of it
  ([`ci.yml`](.github/workflows/ci.yml)).

## Deployment

One Vercel project serves both halves ([`vercel.json`](vercel.json)): the React build from
the CDN and Django as a Python function ([`api/index.py`](api/index.py)) behind `/api/*`.

1. Import the GitHub repository in Vercel (framework preset: Other; settings come from
   `vercel.json`).
2. Set `DJANGO_ALLOWED_HOSTS=.vercel.app` (add your domain if you use one).
3. Deploy.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | random per instance | Nothing is signed or stored, so an ephemeral key is safe |
| `VALHALLA_URL`, `OSRM_URL`, `OPEN_METEO_URL`, `PHOTON_URL` | public servers | Point at self-hosted or commercial instances |
| `UPSTREAM_USER_AGENT` | `Haulcast/0.1 (…)` | Identify your deployment to fair-use APIs |
| `THROTTLE_PLAN`, `THROTTLE_HEATMAP`, `THROTTLE_GEOCODE` | 20/min, 20/min, 120/min | Per-client rate limits |

## Assumptions and limits

- **ETAs assume continuous driving** at the router's speeds; no Hours-of-Service breaks
  are inserted, and Valhalla's ETAs don't include live traffic.
- **Truck weight** sent to the router is load + 35,000 lb (a typical empty tractor and 53 ft
  trailer).
- **Trips over 800 miles straight-line** use OSRM (car road network, 65 mph truck cap),
  because the public Valhalla server stops at 1,500 km. Each route shows which engine
  planned it.
- **Departure** must be within the next 7 days so the whole trip and the 48-hour heatmap
  stay inside reliable forecast range.
- **Free public services** (Valhalla, OSRM, Open-Meteo, Photon, OpenFreeMap) have
  fair-use limits and variable latency: a first plan takes about 3–10 s, repeats are
  cached. For production, point the URLs at paid or self-hosted instances.
- **Snowfall** comes from Open-Meteo, which converts snow water at a fixed 7:1 ratio, so
  light, fluffy snow may read low.

Data © OpenStreetMap contributors · Weather by [Open-Meteo](https://open-meteo.com/)
(CC BY 4.0) · Tiles by [OpenFreeMap](https://openfreemap.org/).
