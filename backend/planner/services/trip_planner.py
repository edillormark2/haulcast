"""Plans a trip end to end: route options → checkpoints → weather at each
checkpoint's ETA → risk → exposure per route → recommendation."""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime

from planner.domain.forecast import ForecastUnavailableError
from planner.domain.geometry import Coordinate, checkpoint_miles, coverage
from planner.domain.recommendation import (
    Recommendation,
    RouteCandidate,
    RouteExposure,
    recommend,
)
from planner.domain.risk import Conditions, RiskAssessment, assess, describe
from planner.services.forecasts import ForecastLookup, ForecastWindow, fetch_forecasts
from planner.services.routing import RouteOption, find_route_options


@dataclass(frozen=True, slots=True)
class NamedPlace:
    label: str
    coordinate: Coordinate


@dataclass(frozen=True, slots=True)
class TripRequest:
    origin: NamedPlace
    destination: NamedPlace
    departure: datetime
    load_lb: int
    interval_mi: int


@dataclass(frozen=True, slots=True)
class Checkpoint:
    index: int
    mile: float
    coordinate: Coordinate
    eta_ts: float
    stretch: tuple[float, float]
    """Miles of road this checkpoint stands for (see geometry.coverage)."""
    conditions: Conditions
    assessment: RiskAssessment
    reason: str


@dataclass(frozen=True, slots=True)
class RoutePlan:
    option: RouteOption
    checkpoints: tuple[Checkpoint, ...]
    exposure: RouteExposure
    arrival_ts: float


@dataclass(frozen=True, slots=True)
class TripPlan:
    request: TripRequest
    routes: tuple[RoutePlan, ...]
    recommendation: Recommendation
    forecast_cells: int
    timings_ms: dict[str, int]


def plan_trip(request: TripRequest) -> TripPlan:
    started = time.perf_counter()
    options = find_route_options(
        request.origin.coordinate, request.destination.coordinate, load_lb=request.load_lb
    )
    routed = time.perf_counter()

    departure_ts = request.departure.timestamp()
    placements = {
        option.route_id: _place(option, departure_ts, request.interval_mi) for option in options
    }
    longest_trip_h = max(option.duration_s for option in options) / 3600
    forecasts = fetch_forecasts(
        (placement.coordinate for route in placements.values() for placement in route),
        ForecastWindow.covering(departure_ts, longest_trip_h),
    )
    forecasted = time.perf_counter()

    routes = tuple(
        _assess_route(option, placements[option.route_id], forecasts, request.load_lb)
        for option in options
    )
    recommendation = recommend(
        [
            RouteCandidate(
                route_id=route.option.route_id,
                name=route.option.name,
                duration_s=route.option.duration_s,
                exposure=route.exposure,
            )
            for route in routes
        ]
    )
    finished = time.perf_counter()
    return TripPlan(
        request=request,
        routes=routes,
        recommendation=recommendation,
        forecast_cells=forecasts.cell_count,
        timings_ms={
            "routing": _ms(started, routed),
            "weather": _ms(routed, forecasted),
            "total": _ms(started, finished),
        },
    )


@dataclass(frozen=True, slots=True)
class _Placement:
    mile: float
    coordinate: Coordinate
    eta_ts: float
    stretch: tuple[float, float]


def _place(option: RouteOption, departure_ts: float, interval_mi: int) -> list[_Placement]:
    """Checkpoints every `interval_mi` miles, each with the truck's ETA."""
    miles = checkpoint_miles(option.line.length_mi, interval_mi)
    return [
        _Placement(
            mile=mile,
            coordinate=option.line.point_at(mile),
            eta_ts=departure_ts + option.profile.elapsed_seconds(mile),
            stretch=stretch,
        )
        for mile, stretch in zip(miles, coverage(miles), strict=True)
    ]


def _assess_route(
    option: RouteOption, placements: list[_Placement], forecasts: ForecastLookup, load_lb: int
) -> RoutePlan:
    checkpoints = []
    for index, placement in enumerate(placements):
        try:
            conditions = forecasts[placement.coordinate].conditions_at(placement.eta_ts)
        except ForecastUnavailableError as exc:
            raise ForecastUnavailableError(
                f"No forecast for {option.name} at mile {placement.mile:.0f}"
            ) from exc
        assessment = assess(conditions, load_lb)
        checkpoints.append(
            Checkpoint(
                index=index,
                mile=placement.mile,
                coordinate=placement.coordinate,
                eta_ts=placement.eta_ts,
                stretch=placement.stretch,
                conditions=conditions,
                assessment=assessment,
                reason=describe(conditions, assessment),
            )
        )
    exposure = RouteExposure.from_stretches(
        (cp.stretch[1] - cp.stretch[0], cp.assessment.level) for cp in checkpoints
    )
    return RoutePlan(
        option=option,
        checkpoints=tuple(checkpoints),
        exposure=exposure,
        arrival_ts=checkpoints[-1].eta_ts,
    )


def _ms(start: float, end: float) -> int:
    return round((end - start) * 1000)
