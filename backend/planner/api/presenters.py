"""Shapes domain results into the JSON the frontend reads."""

from __future__ import annotations

import base64
import time
from bisect import bisect_left
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from planner.domain.corridor import Grid
from planner.domain.geometry import trace
from planner.domain.recommendation import CRITERIA_ORDER
from planner.domain.risk import LOAD_RULES, SCALES, BandScale, Factor, RiskLevel, scales_for_load
from planner.integrations import open_meteo
from planner.services.heatmap import FRAME_COUNT, STEP, Heatmap, HeatmapPlan
from planner.services.routing import ROUTE_COUNT
from planner.services.trip_planner import Checkpoint, NamedPlace, RoutePlan, TripPlan

DISPLAY_TOLERANCE_MI = 0.02
"""About 30 m: invisible at any zoom where a whole route fits on screen."""


def present_plan(plan: TripPlan) -> dict[str, Any]:
    recommendation = plan.recommendation
    ranks = {route_id: rank for rank, route_id in enumerate(recommendation.ranking, start=1)}
    request = plan.request
    departure = iso(request.departure.timestamp())
    return {
        "trip": {
            "origin": _place(request.origin),
            "destination": _place(request.destination),
            "departure": departure,
            "load_lb": request.load_lb,
            "interval_mi": request.interval_mi,
        },
        "thresholds": present_scales(scales_for_load(request.load_lb)),
        "routes": [
            _route(route, ranks[route.option.route_id], recommendation.route_id)
            for route in plan.routes
        ],
        "recommendation": {
            "route_id": recommendation.route_id,
            "ranking": list(recommendation.ranking),
            "reason": recommendation.reason,
            "comparisons": [
                {
                    "route_id": c.route_id,
                    "criterion": c.criterion,
                    "text": c.text,
                    "verdict": c.verdict,
                }
                for c in recommendation.comparisons
            ],
            "warning": recommendation.warning,
        },
        "heatmap_request": {
            "corridor": [[p.lon_lat(4) for p in line] for line in plan.heatmap.lines],
            "anchors": [cell.lon_lat(4) for cell in plan.heatmap.anchors],
            "departure": departure,
            "load_lb": request.load_lb,
        },
        "heatmap_layout": present_heatmap_layout(plan.heatmap),
        "notes": _notes(plan),
        "meta": _forecast_meta(plan.forecast_cells, plan.fetched_cells, plan.stale_since)
        | {"timings_ms": plan.timings_ms},
    }


def _notes(plan: TripPlan) -> list[str]:
    notes = []
    if len(plan.routes) < ROUTE_COUNT:
        count = "one route" if len(plan.routes) == 1 else f"{len(plan.routes)} routes"
        notes.append(
            f"Only {count} found that differ meaningfully and take less than "
            "1.5× the fastest time, so fewer than three options are shown."
        )
    if plan.stale_since is not None:
        minutes = max(1, round((time.time() - plan.stale_since) / 60))
        notes.append(
            "Open-Meteo couldn't send fresh forecasts, so this plan uses ones "
            f"fetched {minutes} min ago."
        )
    return notes


def _forecast_meta(cells: int, fetched: int, stale_since: float | None) -> dict[str, Any]:
    """How many forecast cells were read and how many cost an Open-Meteo call."""
    return {
        "forecast_cells": cells,
        "fetched_cells": fetched,
        "stale_since": None if stale_since is None else iso(stale_since),
    }


def present_scales(scales: dict[Factor, BandScale]) -> dict[str, Any]:
    """Band lower bounds (Moderate, High, Severe, No Travel) per factor."""
    return {
        factor.value: {
            "unit": scale.unit,
            "bounds": [scale.moderate, scale.high, scale.severe, scale.no_travel],
            "no_travel_inclusive": scale.no_travel_inclusive,
        }
        for factor, scale in scales.items()
    }


def present_heatmap_layout(heatmap: HeatmapPlan) -> dict[str, Any]:
    """Everything the browser needs to build the heatmap itself: it fetches
    the samples after the anchored ones from `forecast` and packs them like the
    server does. The thresholds are the plan's."""
    layout, window = heatmap.layout, heatmap.window
    return {
        "grid": _grid(layout.corridor.grid),
        "start": iso(heatmap.departure_ts),
        "frames": FRAME_COUNT,
        "steps": _steps(),
        "alpha": _base64(layout.alpha),
        "sources": list(layout.sources),
        "samples": [point.lon_lat(4) for point in layout.samples],
        "anchor_frames": _base64(heatmap.anchor_frames),
        "forecast": {"url": open_meteo.forecast_url(), "start": window.start, "end": window.end},
    }


def present_heatmap(heatmap: Heatmap) -> dict[str, Any]:
    return {
        "grid": _grid(heatmap.corridor.grid),
        "start": iso(heatmap.departure_ts),
        "frames": heatmap.frames,
        "steps": _steps(),
        "thresholds": present_scales(heatmap.scales),
        "data": heatmap.data_b64,
        "meta": _forecast_meta(heatmap.forecast_cells, heatmap.fetched_cells, heatmap.stale_since)
        | {"timings_ms": heatmap.timings_ms},
    }


def _grid(grid: Grid) -> dict[str, Any]:
    return {
        "west": round(grid.west, 5),
        "south": round(grid.south, 5),
        "east": round(grid.east, 5),
        "north": round(grid.north, 5),
        "columns": grid.columns,
        "rows": grid.rows,
    }


def _steps() -> dict[str, float]:
    return {factor.value: step for factor, step in STEP.items()}


def _base64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def present_rules() -> dict[str, Any]:
    return {
        "levels": [
            {"value": int(level), "slug": level.slug, "label": level.label} for level in RiskLevel
        ],
        "factors": present_scales(SCALES),
        "load_rules": [
            {
                "min_wind_mph": rule.min_wind_mph,
                "max_wind_mph": None if rule.max_wind_mph == float("inf") else rule.max_wind_mph,
                "heavier_than_lb": rule.heavier_than_lb,
                "level": rule.level.slug,
                "description": rule.description,
            }
            for rule in LOAD_RULES
        ],
        "recommendation_order": list(CRITERIA_ORDER),
    }


def iso(timestamp: float) -> str:
    return datetime.fromtimestamp(round(timestamp), tz=UTC).isoformat().replace("+00:00", "Z")


def _place(place: NamedPlace) -> dict[str, Any]:
    return {"label": place.label, "lat": place.coordinate.lat, "lon": place.coordinate.lon}


def _route(route: RoutePlan, rank: int, recommended_id: str) -> dict[str, Any]:
    option = route.option
    sections = _risk_sections(route.checkpoints)
    points, miles = trace(
        option.line, DISPLAY_TOLERANCE_MI, [start for start, _, _ in sections[1:]]
    )
    exposure = route.exposure
    return {
        "id": option.route_id,
        "name": option.name,
        "via": option.via,
        "router": option.router,
        "rank": rank,
        "recommended": option.route_id == recommended_id,
        "distance_mi": round(option.line.length_mi, 1),
        "duration_s": round(option.duration_s),
        "arrival": iso(route.arrival_ts),
        "exposure": {
            "miles": {level.slug: round(exposure.miles(level), 1) for level in RiskLevel},
            "average_risk": round(exposure.average_risk, 2),
        },
        "geometry": [point.lon_lat() for point in points],
        "geometry_miles": [round(mile, 3) for mile in miles],
        "sections": [
            {
                "level": level.slug,
                "from_mi": round(start, 2),
                "to_mi": round(end, 2),
                "start": bisect_left(miles, start),
                "end": bisect_left(miles, end),
            }
            for start, end, level in sections
        ],
        "checkpoints": [_checkpoint(cp) for cp in route.checkpoints],
    }


def _risk_sections(checkpoints: Sequence[Checkpoint]) -> list[tuple[float, float, RiskLevel]]:
    """Consecutive checkpoint stretches merged into runs of equal risk."""
    sections: list[tuple[float, float, RiskLevel]] = []
    for checkpoint in checkpoints:
        start, end = checkpoint.stretch
        level = checkpoint.assessment.level
        if sections and sections[-1][2] is level:
            sections[-1] = (sections[-1][0], end, level)
        elif end > start:
            sections.append((start, end, level))
    return sections


def _checkpoint(checkpoint: Checkpoint) -> dict[str, Any]:
    conditions, assessment = checkpoint.conditions, checkpoint.assessment
    return {
        "index": checkpoint.index,
        "mile": round(checkpoint.mile, 1),
        "lat": round(checkpoint.coordinate.lat, 5),
        "lon": round(checkpoint.coordinate.lon, 5),
        "eta": iso(checkpoint.eta_ts),
        "stretch": [round(checkpoint.stretch[0], 1), round(checkpoint.stretch[1], 1)],
        "risk": assessment.level.slug,
        "factors": {factor.value: level.slug for factor, level in assessment.factor_levels.items()},
        "drivers": [factor.value for factor in assessment.drivers],
        "load_rule": assessment.load_rule.description if assessment.load_rule else None,
        "reason": checkpoint.reason,
        "weather": {
            "wind_mph": conditions.wind_mph,
            "gust_mph": conditions.gust_mph,
            "rain_in_hr": conditions.rain_in_hr,
            "snow_in_hr": conditions.snow_in_hr,
        },
    }
