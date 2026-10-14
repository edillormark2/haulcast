"""OSRM routing on the public demo server, for trips longer than the public
Valhalla server accepts.

https://project-osrm.org/docs/v5.24.0/api/ — keyless, about one request per
second. The demo only has a car profile, so segment durations are slowed to a
truck speed cap: a truck never covers a segment faster than TRUCK_MAX_MPH.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from planner import conf
from planner.domain.geometry import Coordinate, decode_polyline
from planner.integrations.http import HostThrottle, UpstreamError, request_json
from planner.integrations.trips import Trip, make_trip, tally_highways
from planner.integrations.valhalla import NoRouteError

SERVICE = "OSRM"
TRUCK_MAX_MPH = 65.0
METERS_PER_MILE = 1609.344
TIMING_STEP_MI = 1.0
"""Keep one timing breakpoint per mile or so; per-segment data is overkill."""

_throttle = HostThrottle(min_interval_s=1.1)


def route(waypoints: Sequence[Coordinate], *, alternatives: int = 0) -> list[Trip]:
    path = ";".join(f"{p.lon:.6f},{p.lat:.6f}" for p in waypoints)
    params = {
        "overview": "full",
        "geometries": "polyline6",
        "steps": "true",
        "annotations": "duration,distance",
        "alternatives": str(alternatives) if alternatives else "false",
    }
    with _throttle:
        try:
            payload = request_json(
                SERVICE, "GET", f"{conf.upstream().osrm_url}/route/v1/driving/{path}", params=params
            )
        except UpstreamError as exc:
            if exc.status == 400:
                raise NoRouteError(exc.detail) from exc
            raise
    if payload.get("code") != "Ok" or not payload.get("routes"):
        raise NoRouteError(str(payload.get("message") or payload.get("code")))
    return [_parse_route(route) for route in payload["routes"]]


def _parse_route(route: dict[str, Any]) -> Trip:
    shape = decode_polyline(route["geometry"], precision=6)
    timing: list[tuple[int, float]] = [(0, 0.0)]
    elapsed = since_breakpoint = 0.0
    index = 0
    for leg in route["legs"]:
        annotation = leg["annotation"]
        for duration, distance in zip(annotation["duration"], annotation["distance"], strict=True):
            index += 1
            elapsed += max(float(duration), distance / METERS_PER_MILE / TRUCK_MAX_MPH * 3600)
            since_breakpoint += distance / METERS_PER_MILE
            if since_breakpoint >= TIMING_STEP_MI:
                timing.append((index, elapsed))
                since_breakpoint = 0.0
    if timing[-1][0] != len(shape) - 1:
        timing.append((len(shape) - 1, elapsed))

    roads = [
        (_names(step), float(step["distance"]) / METERS_PER_MILE)
        for leg in route["legs"]
        for step in leg["steps"]
    ]
    return make_trip(shape, timing, tally_highways(roads), elapsed)


def _names(step: dict[str, Any]) -> list[str]:
    refs = [ref.strip() for ref in (step.get("ref") or "").split(";") if ref.strip()]
    return [*refs, step.get("name") or ""]
