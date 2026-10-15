"""Valhalla routing with truck costing.

https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/ — the
public FOSSGIS server is keyless, asks for at most about one request per
second, and rejects requests whose locations are more than 1,500 km apart in
straight-line total.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from planner import conf
from planner.domain.geometry import Coordinate, decode_polyline
from planner.integrations.http import HostThrottle, UpstreamError, request_json
from planner.integrations.trips import TRUCK_MAX_MPH, Trip, make_trip, tally_highways

SERVICE = "Valhalla"
KM_PER_MILE = 1.609344
MAX_PATH_MI = 1_500 / KM_PER_MILE
"""The public server's limit on the summed straight-line distance between
consecutive locations."""
KG_PER_LB = 0.45359237
TRUCK_TOP_SPEED_KPH = round(TRUCK_MAX_MPH * KM_PER_MILE)
"""Valhalla's truck default is 120 km/h (75 mph), faster than a loaded truck
drives and than the cap on OSRM trips. Valhalla takes whole km/h."""
U_TURN_MANEUVERS = frozenset({12, 13})

_throttle = HostThrottle(min_interval_s=1.1)


class NoRouteError(Exception):
    """The router found no drivable route between the locations."""


@dataclass(frozen=True, slots=True)
class Waypoint:
    coordinate: Coordinate
    kind: Literal["break", "through"] = "break"
    """`through` passes the point without stopping (no extra leg)."""
    major_roads_only: bool = False
    """Snap to a primary road or bigger, never a ramp: keeps detours on truck roads."""


def route(
    waypoints: Sequence[Waypoint], *, gross_weight_lb: float, alternates: int = 0
) -> list[Trip]:
    """The best truck route through the waypoints, then up to `alternates`
    alternatives (Valhalla may return fewer)."""
    body: dict[str, Any] = {
        "locations": [_location(w) for w in waypoints],
        "costing": "truck",
        "costing_options": {
            "truck": {
                "weight": round(gross_weight_lb * KG_PER_LB / 1000, 2),
                "top_speed": TRUCK_TOP_SPEED_KPH,
            }
        },
        "units": "miles",
        "directions_type": "maneuvers",
        "language": "en-US",
    }
    if alternates:
        body["alternates"] = alternates

    with _throttle:
        try:
            payload = request_json(
                SERVICE, "POST", f"{conf.upstream().valhalla_url}/route", json=body
            )
        except UpstreamError as exc:
            if exc.status == 400:  # "no path", "no edges near location", distance limit
                raise NoRouteError(exc.detail) from exc
            raise

    trips = [payload["trip"], *(alt["trip"] for alt in payload.get("alternates", []))]
    return [_parse_trip(trip) for trip in trips]


def _location(waypoint: Waypoint) -> dict[str, Any]:
    location: dict[str, Any] = {
        "lat": waypoint.coordinate.lat,
        "lon": waypoint.coordinate.lon,
        "type": waypoint.kind,
    }
    if waypoint.major_roads_only:
        location["search_filter"] = {"min_road_class": "primary", "exclude_ramp": True}
        location["search_cutoff"] = 100_000
    return location


def _parse_trip(trip: dict[str, Any]) -> Trip:
    shape: list[Coordinate] = []
    timing: list[tuple[int, float]] = []
    roads: list[tuple[list[str], float]] = []
    elapsed = 0.0
    u_turns = 0
    for leg in trip["legs"]:
        offset = max(len(shape) - 1, 0)  # consecutive legs share their joining point
        leg_shape = decode_polyline(leg["shape"], precision=6)
        shape.extend(leg_shape if not shape else leg_shape[1:])
        for maneuver in leg["maneuvers"]:
            timing.append((offset + maneuver["begin_shape_index"], elapsed))
            elapsed += float(maneuver.get("time", 0))
            roads.append((maneuver.get("street_names", []), float(maneuver.get("length", 0))))
            u_turns += maneuver.get("type") in U_TURN_MANEUVERS
    timing.append((len(shape) - 1, elapsed))
    return make_trip(shape, timing, tally_highways(roads), elapsed, u_turns)
