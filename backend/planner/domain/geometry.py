"""Geometry on WGS84 coordinates. Distances are great-circle (haversine) miles."""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import NamedTuple

EARTH_RADIUS_MI = 3958.7613
MILES_PER_DEGREE_LAT = 69.055
_EPSILON_MI = 1e-6


class Coordinate(NamedTuple):
    lat: float
    lon: float

    def lon_lat(self, digits: int = 5) -> list[float]:
        """GeoJSON order, rounded (5 digits ≈ 1 m)."""
        return [round(self.lon, digits), round(self.lat, digits)]


def haversine_mi(a: Coordinate, b: Coordinate) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a.lat, a.lon, b.lat, b.lon))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_MI * math.asin(math.sqrt(min(1.0, h)))


def initial_bearing(a: Coordinate, b: Coordinate) -> float:
    """Compass bearing in degrees for the great circle from `a` toward `b`."""
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    d_lon = math.radians(b.lon - a.lon)
    y = math.sin(d_lon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(d_lon)
    return math.degrees(math.atan2(y, x))


def destination_point(start: Coordinate, bearing_deg: float, distance_mi: float) -> Coordinate:
    """The point `distance_mi` from `start` along the initial bearing."""
    angular = distance_mi / EARTH_RADIUS_MI
    bearing = math.radians(bearing_deg)
    lat1, lon1 = math.radians(start.lat), math.radians(start.lon)
    lat2 = math.asin(
        math.sin(lat1) * math.cos(angular) + math.cos(lat1) * math.sin(angular) * math.cos(bearing)
    )
    lon2 = lon1 + math.atan2(
        math.sin(bearing) * math.sin(angular) * math.cos(lat1),
        math.cos(angular) - math.sin(lat1) * math.sin(lat2),
    )
    return Coordinate(math.degrees(lat2), (math.degrees(lon2) + 540) % 360 - 180)


def decode_polyline(encoded: str, precision: int = 6) -> list[Coordinate]:
    """Decode an encoded polyline (Valhalla uses precision 6, Google precision 5)."""
    factor = 10**precision
    coordinates: list[Coordinate] = []
    index = lat = lon = 0
    while index < len(encoded):
        deltas: list[int] = []
        for _ in range(2):
            result = shift = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        coordinates.append(Coordinate(lat / factor, lon / factor))
    return coordinates


@dataclass(frozen=True, slots=True)
class Polyline:
    """A route line with cumulative distance at every vertex."""

    points: tuple[Coordinate, ...]
    cumulative_mi: tuple[float, ...]

    @classmethod
    def from_points(cls, points: Sequence[Coordinate]) -> Polyline:
        if len(points) < 2:
            raise ValueError("A polyline needs at least two points")
        cumulative = [0.0]
        for previous, current in pairwise(points):
            cumulative.append(cumulative[-1] + haversine_mi(previous, current))
        return cls(tuple(points), tuple(cumulative))

    @property
    def length_mi(self) -> float:
        return self.cumulative_mi[-1]

    def point_at(self, mile: float) -> Coordinate:
        """The point `mile` miles from the start, interpolated along the line."""
        if mile <= 0:
            return self.points[0]
        if mile >= self.length_mi:
            return self.points[-1]
        i = bisect_right(self.cumulative_mi, mile)
        start, end = self.cumulative_mi[i - 1], self.cumulative_mi[i]
        t = (mile - start) / (end - start) if end > start else 0.0
        a, b = self.points[i - 1], self.points[i]
        return Coordinate(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t)

    def section(self, start_mi: float, end_mi: float) -> list[Coordinate]:
        """The part of the line between two mile markers, endpoints included."""
        inner_start = bisect_right(self.cumulative_mi, start_mi)
        inner_end = bisect_left(self.cumulative_mi, end_mi)
        inner = self.points[inner_start:inner_end]
        return [self.point_at(start_mi), *inner, self.point_at(end_mi)]


def checkpoint_miles(length_mi: float, interval_mi: float) -> list[float]:
    """Mile markers at 0, N, 2N, … along the route, plus the destination."""
    if interval_mi <= 0:
        raise ValueError("Checkpoint interval must be positive")
    count = int(length_mi // interval_mi) + 1
    miles = [i * interval_mi for i in range(count)]
    if length_mi - miles[-1] > _EPSILON_MI:
        miles.append(length_mi)
    return miles


def coverage(miles: Sequence[float]) -> list[tuple[float, float]]:
    """The stretch of road each checkpoint represents: from halfway to the
    previous checkpoint to halfway to the next one. Stretches tile the route,
    so their lengths sum to the route length."""
    if len(miles) == 1:
        return [(miles[0], miles[0])]
    stretches = []
    for i, mile in enumerate(miles):
        start = miles[0] if i == 0 else (miles[i - 1] + mile) / 2
        end = miles[-1] if i == len(miles) - 1 else (mile + miles[i + 1]) / 2
        stretches.append((start, end))
    return stretches


def simplify(points: Sequence[Coordinate], tolerance_mi: float) -> list[Coordinate]:
    return [points[i] for i in simplify_indices(points, tolerance_mi)]


def trace(
    line: Polyline, tolerance_mi: float, breaks_mi: Sequence[float] = ()
) -> tuple[list[Coordinate], list[float]]:
    """A simplified copy of `line` for drawing, with exact vertices inserted at
    `breaks_mi` so it can be split into sections. Returns the points and the
    mile marker of each point (measured on the full line)."""
    entries = {
        line.cumulative_mi[i]: line.points[i] for i in simplify_indices(line.points, tolerance_mi)
    }
    for mile in breaks_mi:
        entries.setdefault(mile, line.point_at(mile))
    miles = sorted(entries)
    return [entries[mile] for mile in miles], miles


def simplify_indices(points: Sequence[Coordinate], tolerance_mi: float) -> list[int]:
    """Ramer–Douglas–Peucker simplification in a local equirectangular plane.
    Returns the indices of the points to keep, in order."""
    if len(points) < 3:
        return list(range(len(points)))
    mean_lat = math.radians(sum(p.lat for p in points) / len(points))
    x_scale = math.cos(mean_lat)
    xy = [(p.lon * x_scale, p.lat) for p in points]
    tolerance = tolerance_mi / MILES_PER_DEGREE_LAT

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        farthest, max_distance = -1, tolerance
        for i in range(first + 1, last):
            distance = _segment_distance(xy[i], xy[first], xy[last])
            if distance > max_distance:
                farthest, max_distance = i, distance
        if farthest != -1:
            keep[farthest] = True
            stack.extend(((first, farthest), (farthest, last)))
    return [i for i, kept in enumerate(keep) if kept]


def _segment_distance(
    p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length_sq))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
