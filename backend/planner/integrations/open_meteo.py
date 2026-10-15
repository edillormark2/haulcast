"""Open-Meteo forecast API: hourly wind, rain and snow for many points at once.

https://open-meteo.com/en/docs — keyless. The free tier allows 600 calls a
minute, 5,000 an hour and 10,000 a day per client IP. Each location in a
request is one call, whatever the hours asked for (up to 14 days) and with up
to 10 variables, so cost follows the number of locations alone.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from datetime import UTC, datetime
from itertools import pairwise
from typing import Any

import httpx

from planner import conf
from planner.domain.forecast import HOUR_S, HourlySeries
from planner.domain.geometry import Coordinate
from planner.integrations.http import UpstreamError, request_json, retry_after_header

SERVICE = "Open-Meteo"
HOURLY_VARIABLES = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")
MAX_LOCATIONS_PER_REQUEST = 150
"""About a 2.5 KB URL; Open-Meteo rejects URLs past ~8 KB."""
MINUTE_RETRY_S = 20
"""Open-Meteo clears its per-minute counts once a minute, at a second we can't
know, so a retry after 20 s has a fair chance and the third is sure to pass.
Refused requests aren't counted, so trying early costs nothing."""
DAY_S = 24 * HOUR_S


def forecast_url() -> str:
    """The forecast endpoint. Browsers call it too, for the heatmap."""
    return f"{conf.upstream().open_meteo_url}/v1/forecast"


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
    payload = request_json(SERVICE, "GET", forecast_url(), params=params, retry_after=_retry_after)
    locations = payload if isinstance(payload, list) else [payload]
    if len(locations) != len(points):
        raise UpstreamError(SERVICE, f"returned {len(locations)} locations for {len(points)}")
    return [_parse_location(location, start) for location in locations]


def _retry_after(response: httpx.Response) -> float | None:
    """How long a refusal lasts. The free tier counts calls per IP over fixed
    windows: each minute, each UTC hour (cleared during its first minute) and
    each UTC day, and the 429's reason names the one that ran out. Any other
    refusal, such as too many concurrent requests, clears within moments, so
    it gets the usual backoff (None)."""
    refused = response.status_code == httpx.codes.TOO_MANY_REQUESTS
    reason = _reason(response) if refused else ""
    now = time.time()
    if reason.startswith("Minutely"):
        return MINUTE_RETRY_S
    if reason.startswith("Hourly"):
        return HOUR_S - now % HOUR_S + 60
    if reason.startswith("Daily"):
        return DAY_S - now % DAY_S + 60
    return retry_after_header(response)


def _reason(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return ""
    reason = body.get("reason") if isinstance(body, dict) else None
    return reason if isinstance(reason, str) else ""


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
