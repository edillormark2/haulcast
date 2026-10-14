"""Open-Meteo forecast API: hourly wind, rain and snow for many points at once.

https://open-meteo.com/en/docs — keyless; free tier allows 600 calls/minute,
and a multi-location request is assumed to cost one call per location.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from itertools import pairwise
from typing import Any

from planner import conf
from planner.domain.forecast import HOUR_S, HourlySeries
from planner.domain.geometry import Coordinate
from planner.integrations.http import UpstreamError, request_json

SERVICE = "Open-Meteo"
HOURLY_VARIABLES = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")
MAX_LOCATIONS_PER_REQUEST = 100


def fetch_hourly(points: Sequence[Coordinate], start: int, end: int) -> list[HourlySeries]:
    """Hourly series from `start` to `end` (inclusive, UTC unix seconds on the
    hour) for each point, in the same order as `points`."""
    if not points:
        return []
    if len(points) > MAX_LOCATIONS_PER_REQUEST:
        raise ValueError(f"At most {MAX_LOCATIONS_PER_REQUEST} locations per request")

    params = {
        "latitude": ",".join(f"{p.lat:.4f}" for p in points),
        "longitude": ",".join(f"{p.lon:.4f}" for p in points),
        "hourly": ",".join(HOURLY_VARIABLES),
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",  # also switches snowfall to inches
        "timeformat": "unixtime",
        "timezone": "GMT",
        "start_hour": _iso_hour(start),
        "end_hour": _iso_hour(end),
    }
    url = f"{conf.upstream().open_meteo_url}/v1/forecast"
    payload = request_json(SERVICE, "GET", url, params=params)
    locations = payload if isinstance(payload, list) else [payload]
    if len(locations) != len(points):
        raise UpstreamError(SERVICE, f"returned {len(locations)} locations for {len(points)}")
    return [_parse_location(location, start) for location in locations]


def _parse_location(location: dict[str, Any], expected_start: int) -> HourlySeries:
    hourly = location.get("hourly") or {}
    times: list[int] = hourly.get("time") or []
    if not times or times[0] != expected_start:
        raise UpstreamError(SERVICE, "forecast window doesn't match the request")
    if any(b - a != HOUR_S for a, b in pairwise(times)):
        raise UpstreamError(SERVICE, "forecast hours aren't contiguous")

    def column(name: str) -> list[float]:
        values = hourly.get(name)
        if values is None or len(values) != len(times) or any(v is None for v in values):
            raise UpstreamError(SERVICE, f"forecast is missing {name} values")
        return [float(v) for v in values]

    rain, showers = column("rain"), column("showers")
    return HourlySeries(
        start=times[0],
        wind_mph=tuple(column("wind_speed_10m")),
        gust_mph=tuple(column("wind_gusts_10m")),
        # Large-scale rain and convective showers are both liquid precipitation.
        rain_in=tuple(r + s for r, s in zip(rain, showers, strict=True)),
        snow_in=tuple(column("snowfall")),
    )


def _iso_hour(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, tz=UTC).strftime("%Y-%m-%dT%H:%M")
