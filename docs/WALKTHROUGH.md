# Loom walkthrough script (about 8 minutes)

A suggested outline for the 5–10 minute video. Times are approximate.

## 0:00 Introduction (30 s)

- "This is Haulcast, a React and Django app that helps a truck driver pick the safest of
  three routes based on weather, load weight and travel time."
- Show the empty state: the short explanation and the sample trips.

## 0:30 Planning a trip (1 min)

- Type an origin and destination to show the search suggestions, or pick **Chicago to
  Denver**.
- Point out the departure quick picks, the load weight, and the load hint, which changes
  between 30,000, 36,000 and 42,000 lb.
- Choose **25 mi** checkpoints and submit. Mention the honest loading message: routing,
  then the forecast at every checkpoint. The map frames the trip's two ends and says it's
  finding routes.
- Note that the trip is now in the URL, so plans are shareable links. **New trip** goes
  back to a blank planner and the sample trips; **Edit** changes this one.

## 1:30 The recommendation (1.5 min)

- Read the recommendation and its reason. Explain the ranking order:
  - No Travel miles first;
  - then fewest Severe miles;
  - then fewest High miles;
  - then lowest average risk;
  - then shortest time.
- In the route list:
  - each **risk strip** is the road unrolled, coloured by risk, on one shared mile scale;
  - point out the exposure line (miles per level) and the **Not chosen** verdicts.
- Hover a strip stretch and show the matching checkpoint lighting up on the map.

## 3:00 The map (1.5 min)

- Three routes, risk-coloured, with the selected route bold. Click another route or its
  pill to select it.
- Hover a checkpoint to show its ETA, wind (with gusts), rain, snow, the factor that drove
  the risk, and any load rule. Click it to pin the card.
- Open the **Checkpoints** tab: the itinerary, the route switcher and the "Moderate and
  up" filter. Clicking a row flies the map to it.

## 4:30 The heatmap (1.5 min)

- Press **Play**: the truck drives the selected route from departure to arrival while the
  weather moves with it, then stops; **Replay** runs it again. Pick another route and the
  trip rewinds. Then scrub the slider across the full 48 hours.
- Switch between **Risk, Wind, Rain and Snow**. Same colours, same meaning; the legend
  shows this load's thresholds (wind bands shift for heavy loads).
- Hover the shading for a readout at that hour. Read the caption: shading is the weather
  at the selected hour, route colours are the weather when the truck passes.
- Mention that it's one GPU texture and one draw call per frame, so the slider runs at
  60 fps.

## 6:00 Under the hood (1.5 min)

- `backend/planner/domain/risk.py`:
  - the table as data;
  - the boundary conventions (0.25 is High, 1.00 is still Severe, strict load limits);
  - rounding before classifying.
- `recommendation.py`: the lexicographic key and the explanation text.
- `services/routing.py`:
  - Valhalla truck costing, with OSRM beyond the public server's 1,500 km limit;
  - detour quality rules.
- Tests:
  - boundary tables;
  - the exhaustive load-threshold check;
  - API tests with faked services.

## 7:30 Wrap-up (30 s)

- Phone layout: the bottom sheet keeps the recommendation visible.
- Assumptions:
  - continuous driving;
  - sustained wind;
  - free public services, swappable by environment variable.
- Thanks.
