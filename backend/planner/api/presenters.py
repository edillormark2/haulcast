"""Shapes domain results into the JSON the frontend reads."""

from __future__ import annotations

from bisect import bisect_left
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from planner.domain.geometry import simplify, trace
from planner.domain.recommendation import CRITERIA_ORDER
from planner.domain.risk import LOAD_RULES, SCALES, RiskLevel
from planner.services.heatmap import Heatmap
from planner.services.trip_planner import Checkpoint, NamedPlace, RoutePlan, TripPlan

DISPLAY_TOLERANCE_MI = 0.02
"""About 30 m: invisible at any zoom where a whole route fits on screen."""
CORRIDOR_TOLERANCE_MI = 1.0
"""The heatmap corridor only needs the routes' general course."""


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
        "routes": [
            _route(route, ranks[route.option.route_id], recommendation.route_id)
            for route in plan.routes
        ],
        "recommendation": {
            "route_id": recommendation.route_id,
            "ranking": list(recommendation.ranking),
            "reason": recommendation.reason,
            "comparisons": [
                {"route_id": c.route_id, "criterion": c.criterion, "text": c.text}
                for c in recommendation.comparisons
            ],
            "warning": recommendation.warning,
        },
        "heatmap_request": {
            "corridor": [
                [p.lon_lat(4) for p in simplify(route.option.line.points, CORRIDOR_TOLERANCE_MI)]
                for route in plan.routes
            ],
            "departure": departure,
            "load_lb": request.load_lb,
        },
        "meta": {
            "forecast_cells": plan.forecast_cells,
            "timings_ms": plan.timings_ms,
        },
    }


def present_heatmap(heatmap: Heatmap) -> dict[str, Any]:
    grid = heatmap.corridor.grid
    return {
        "grid": {
            "west": round(grid.west, 5),
            "south": round(grid.south, 5),
            "east": round(grid.east, 5),
            "north": round(grid.north, 5),
            "columns": grid.columns,
            "rows": grid.rows,
        },
        "start": iso(heatmap.start_ts),
        "hours": heatmap.hours,
        "mask": heatmap.mask_b64,
        "layers": {
            name: {"scale": layer.scale, "unit": layer.unit, "data": layer.data_b64}
            for name, layer in heatmap.layers.items()
        },
        "meta": {"forecast_cells": heatmap.forecast_cells, "timings_ms": heatmap.timings_ms},
    }


def present_rules() -> dict[str, Any]:
    return {
        "levels": [
            {"value": int(level), "slug": level.slug, "label": level.label} for level in RiskLevel
        ],
        "factors": {
            factor.value: {
                "unit": scale.unit,
                "moderate": scale.moderate,
                "high": scale.high,
                "severe": scale.severe,
                "no_travel": scale.no_travel,
                "no_travel_inclusive": scale.no_travel_inclusive,
            }
            for factor, scale in SCALES.items()
        },
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
