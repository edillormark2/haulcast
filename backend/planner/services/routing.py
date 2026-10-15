"""Three distinct truck route options between two places.

Routing engine: Valhalla's truck costing (vehicle weight, truck restrictions)
when the trip fits the public server's distance limit; otherwise OSRM's road
network. Both plan the truck at no more than TRUCK_MAX_MPH, so ETAs don't
depend on the engine. The router's own alternatives come first. When
it returns fewer than three, more are found by routing through a via point
offset to either side of the fastest route's midpoint, keeping candidates that
are genuinely different and not much slower.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from itertools import pairwise

from django.core.cache import caches

from planner.domain.geometry import (
    Coordinate,
    Polyline,
    destination_point,
    haversine_mi,
    initial_bearing,
)
from planner.domain.timeline import TravelTimeProfile
from planner.integrations import osrm, valhalla
from planner.integrations.trips import TRUCK_MAX_MPH, Trip
from planner.integrations.valhalla import NoRouteError, Waypoint

logger = logging.getLogger(__name__)

ROUTE_COUNT = 3
TARE_WEIGHT_LB = 35_000
"""Typical empty tractor with a 53 ft trailer; truck weight = tare + load."""
VALHALLA_MAX_DIRECT_MI = 800
"""Longest straight-line trip sent to Valhalla, leaving headroom under its
1,500 km limit for via-point detours."""
MAX_SLOWDOWN = 1.5
"""An option may take at most 1.5× the fastest option's time."""
DUPLICATE_OVERLAP = 0.9
DETOUR_MAX_OVERLAP = 0.7
"""A detour must leave at least 30% of its length off every other option."""
DETOUR_OFFSET_SHARES = (0.25, 0.15)
"""Via points sit this share of the straight-line distance off the route,"""
MIN_DETOUR_OFFSET_MI, MAX_DETOUR_OFFSET_MI = 37.0, 217.0
"""within these bounds (60–350 km)."""
MAX_BACKTRACK = 0.03
"""Share of a route allowed to double back on itself before a detour is rejected."""
PATH_LIMIT_MARGIN = 0.97
MAJOR_ROAD_SHARE = 0.05
OVERLAP_CELL_DEG = 0.02
OVERLAP_SAMPLE_MI = 0.5
CACHE_TTL_S = 30 * 60
"""Changing only the checkpoint interval or departure reuses the routes."""

Router = Callable[[Sequence[Coordinate], int], list[Trip]]


@dataclass(frozen=True, slots=True)
class RouteOption:
    route_id: str
    name: str
    via: str
    """The highways that set this route apart, e.g. "via I-70"."""
    router: str
    line: Polyline
    profile: TravelTimeProfile
    duration_s: float


@dataclass(frozen=True, slots=True)
class _Candidate:
    trip: Trip
    line: Polyline

    @classmethod
    def from_trip(cls, trip: Trip) -> _Candidate:
        return cls(trip=trip, line=Polyline.from_points(trip.shape))

    @property
    def duration_s(self) -> float:
        return self.trip.time_s


def find_route_options(
    origin: Coordinate, destination: Coordinate, *, load_lb: float
) -> list[RouteOption]:
    cache = caches["routes"]
    key = (
        "routes:v2:"
        + ":".join(f"{value:.4f}" for value in (*origin, *destination))
        + f":{load_lb:.0f}"
    )
    options: list[RouteOption] | None = cache.get(key)
    if options is None:
        options = _route_options(origin, destination, load_lb)
        cache.set(key, options, CACHE_TTL_S)
    return options


def _route_options(
    origin: Coordinate, destination: Coordinate, load_lb: float
) -> list[RouteOption]:
    router, router_name = _choose_router(origin, destination, load_lb)

    candidates: list[_Candidate] = []
    for trip in router([origin, destination], ROUTE_COUNT - 1):
        candidate = _Candidate.from_trip(trip)
        if _overlap(candidate, candidates) < DUPLICATE_OVERLAP:
            candidates.append(candidate)
    if len(candidates) < ROUTE_COUNT:
        candidates += _detours(origin, destination, candidates, router)

    candidates.sort(key=lambda c: c.duration_s)
    vias = _via_labels(candidates)
    return [
        RouteOption(
            route_id=letter,
            name=f"Route {letter}",
            via=via,
            router=router_name,
            line=candidate.line,
            profile=_travel_time_profile(candidate),
            duration_s=candidate.duration_s,
        )
        for letter, candidate, via in zip("ABC", candidates, vias, strict=False)
    ]


def _choose_router(
    origin: Coordinate, destination: Coordinate, load_lb: float
) -> tuple[Router, str]:
    if haversine_mi(origin, destination) > VALHALLA_MAX_DIRECT_MI:
        return _road_router, f"OSRM roads with a {TRUCK_MAX_MPH:.0f} mph truck speed cap"

    gross_weight_lb = load_lb + TARE_WEIGHT_LB

    def truck_router(points: Sequence[Coordinate], alternates: int) -> list[Trip]:
        if _straight_path_mi(points) > PATH_LIMIT_MARGIN * valhalla.MAX_PATH_MI:
            raise NoRouteError("Detour exceeds the routing server's distance limit")
        endpoints = (0, len(points) - 1)
        waypoints = [
            Waypoint(point)
            if i in endpoints
            else Waypoint(point, kind="through", major_roads_only=True)
            for i, point in enumerate(points)
        ]
        return valhalla.route(waypoints, gross_weight_lb=gross_weight_lb, alternates=alternates)

    return truck_router, f"Valhalla truck routing with a {TRUCK_MAX_MPH:.0f} mph speed cap"


def _road_router(points: Sequence[Coordinate], alternatives: int) -> list[Trip]:
    return osrm.route(points, alternatives=alternatives)


def _detours(
    origin: Coordinate, destination: Coordinate, existing: Sequence[_Candidate], router: Router
) -> list[_Candidate]:
    """Up to the missing number of extra options, each routed through a via
    point beside the fastest route's midpoint. Candidates that are slow, too
    similar to a kept route, or that U-turn or double back are rejected; with
    no good candidate the trip simply has fewer options."""
    fastest = min(existing, key=lambda c: c.duration_s)
    line = fastest.line
    midpoint = line.point_at(line.length_mi / 2)
    # Offset perpendicular to the route's own direction around its midpoint.
    heading = initial_bearing(
        line.point_at(line.length_mi * 0.4), line.point_at(line.length_mi * 0.6)
    )
    direct = haversine_mi(origin, destination)

    def clearance(via: Coordinate) -> float:
        return min(haversine_mi(via, c.line.point_at(c.line.length_mi / 2)) for c in existing)

    attempts = []
    for share in DETOUR_OFFSET_SHARES:
        offset = min(max(direct * share, MIN_DETOUR_OFFSET_MI), MAX_DETOUR_OFFSET_MI)
        sides = [destination_point(midpoint, heading + side, offset) for side in (-90, 90)]
        attempts += sorted(sides, key=lambda via: -clearance(via))

    found: list[_Candidate] = []
    for via in attempts:
        if len(existing) + len(found) >= ROUTE_COUNT:
            break
        try:
            candidate = _Candidate.from_trip(router([origin, via, destination], 0)[0])
        except NoRouteError as exc:
            logger.info("detour via %s: no route (%s)", via, exc)
            continue
        problem = _detour_problem(candidate, fastest, [*existing, *found])
        logger.info(
            "detour via %s: %.1f h, %s", via, candidate.duration_s / 3600, problem or "kept"
        )
        if problem is None:
            found.append(candidate)
    return found


def _detour_problem(
    candidate: _Candidate, fastest: _Candidate, kept: Sequence[_Candidate]
) -> str | None:
    if candidate.duration_s > MAX_SLOWDOWN * fastest.duration_s:
        return "too slow"
    if candidate.trip.u_turns:
        return "U-turn"
    if _backtrack_share(candidate.line) > MAX_BACKTRACK:
        return "doubles back"
    if any(_overlap(candidate, [other]) > DETOUR_MAX_OVERLAP for other in kept):
        return "too similar"
    return None


def _backtrack_share(line: Polyline) -> float:
    """Share of the route that re-enters ground it already covered, e.g. an
    out-and-back spur to reach a via point."""
    cells = _cells(line)
    last_seen: dict[tuple[int, int], int] = {}
    returns = 0
    for position, cell in enumerate(cells):
        if cell in last_seen and position - last_seen[cell] > 3:
            returns += 1
        last_seen[cell] = position
    return returns / len(cells)


def _travel_time_profile(candidate: _Candidate) -> TravelTimeProfile:
    """Router timing breakpoints, placed by distance along our polyline."""
    cumulative = candidate.line.cumulative_mi
    last = len(cumulative) - 1
    miles = tuple(cumulative[min(index, last)] for index, _ in candidate.trip.timing)
    seconds = tuple(elapsed for _, elapsed in candidate.trip.timing)
    return TravelTimeProfile(miles=miles, seconds=seconds)


def _via_labels(candidates: Sequence[_Candidate]) -> list[str]:
    """Name each route by the highways that set it apart: those it drives
    noticeably more miles on than any other option does. A route with nothing
    distinctive is named by its main highway."""
    labels = []
    for candidate in candidates:
        roads = candidate.trip.road_miles
        others = [c.trip.road_miles for c in candidates if c is not candidate]
        threshold = MAJOR_ROAD_SHARE * candidate.line.length_mi
        excess = {
            ref: miles - max((other.get(ref, 0.0) for other in others), default=0.0)
            for ref, miles in roads.items()
        }
        distinctive = sorted(
            (ref for ref, extra in excess.items() if extra >= threshold), key=lambda r: -excess[r]
        )
        chosen = distinctive[:2] or sorted(roads, key=lambda r: -roads[r])[:1]
        labels.append(f"via {' & '.join(chosen)}" if chosen else "via local roads")
    return labels


def _overlap(candidate: _Candidate, others: Sequence[_Candidate]) -> float:
    """Share of the candidate's length running within ~2 km of another option."""
    if not others:
        return 0.0
    taken: set[tuple[int, int]] = set()
    for other in others:
        for row, column in _cells(other.line):
            taken.update((row + dr, column + dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1))
    samples = _cells(candidate.line)
    return sum(cell in taken for cell in samples) / len(samples)


def _cells(line: Polyline) -> list[tuple[int, int]]:
    count = max(2, math.ceil(line.length_mi / OVERLAP_SAMPLE_MI) + 1)
    points = (line.point_at(line.length_mi * i / (count - 1)) for i in range(count))
    return [(round(p.lat / OVERLAP_CELL_DEG), round(p.lon / OVERLAP_CELL_DEG)) for p in points]


def _straight_path_mi(points: Sequence[Coordinate]) -> float:
    return sum(haversine_mi(a, b) for a, b in pairwise(points))
