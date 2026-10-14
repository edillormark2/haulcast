"""Fakes for the upstream services, so API tests run offline and fast."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import respx
from django.core.cache import caches

from planner.integrations import osrm, valhalla
from planner.integrations.http import HostThrottle

VALHALLA_ROUTE = "https://valhalla1.openstreetmap.de/route"
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"


def encode_polyline(points: list[tuple[float, float]], precision: int = 6) -> str:
    """Encode (lat, lon) pairs the way Valhalla does."""
    factor = 10**precision
    output: list[str] = []
    previous = (0, 0)
    for lat, lon in points:
        current = (round(lat * factor), round(lon * factor))
        for value in (current[0] - previous[0], current[1] - previous[1]):
            value = ~(value << 1) if value < 0 else value << 1
            while value >= 0x20:
                output.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            output.append(chr(value + 63))
        previous = current
    return "".join(output)


def valhalla_trip(lat: float, road: str, hours: float) -> dict[str, Any]:
    """A trip due east from lon -97 to -95 along latitude `lat` (about 115 mi)."""
    points = [(lat, -97 + i * 0.2) for i in range(11)]
    return {
        "legs": [
            {
                "shape": encode_polyline(points),
                "maneuvers": [
                    {
                        "type": 1,
                        "time": hours * 3600,
                        "length": 115.0,
                        "street_names": [road],
                        "begin_shape_index": 0,
                        "end_shape_index": 10,
                    },
                    {
                        "type": 4,
                        "time": 0,
                        "length": 0,
                        "begin_shape_index": 10,
                        "end_shape_index": 10,
                    },
                ],
            }
        ],
        "summary": {"length": 115.0, "time": hours * 3600},
    }


@pytest.fixture(autouse=True)
def _isolate(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fresh caches and no fair-use sleeps in every test."""
    monkeypatch.setattr(valhalla, "_throttle", HostThrottle(min_interval_s=0))
    monkeypatch.setattr(osrm, "_throttle", HostThrottle(min_interval_s=0))
    for alias in ("default", "routes"):
        caches[alias].clear()


WeatherFn = Callable[[float, float], dict[str, float]]


@pytest.fixture
def upstream() -> Iterator[Callable[[WeatherFn], respx.MockRouter]]:
    """Mock Valhalla with three distinct routes and Open-Meteo with weather
    given by a function of (lat, lon). Anything else hitting the network fails."""
    with respx.mock(assert_all_called=False) as router:

        def install(weather: WeatherFn) -> respx.MockRouter:
            router.post(VALHALLA_ROUTE).mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "trip": valhalla_trip(32.0, "I 20", 2.0),
                        "alternates": [
                            {"trip": valhalla_trip(32.6, "US 80", 2.2)},
                            {"trip": valhalla_trip(31.4, "TX 31", 2.5)},
                        ],
                    },
                )
            )
            router.get(OPEN_METEO).mock(side_effect=lambda request: _forecast(request, weather))
            return router

        yield install


def _forecast(request: httpx.Request, weather: WeatherFn) -> httpx.Response:
    query = parse_qs(urlparse(str(request.url)).query)
    lats = [float(v) for v in query["latitude"][0].split(",")]
    lons = [float(v) for v in query["longitude"][0].split(",")]
    start = _epoch(query["start_hour"][0])
    end = _epoch(query["end_hour"][0])
    times = list(range(start, end + 1, 3600))
    body = []
    for lat, lon in zip(lats, lons, strict=True):
        values = weather(lat, lon)
        body.append(
            {
                "latitude": lat,
                "longitude": lon,
                "hourly": {
                    "time": times,
                    "wind_speed_10m": [values.get("wind", 5.0)] * len(times),
                    "wind_gusts_10m": [values.get("gust", 10.0)] * len(times),
                    "rain": [values.get("rain", 0.0)] * len(times),
                    "showers": [0.0] * len(times),
                    "snowfall": [values.get("snow", 0.0)] * len(times),
                },
            }
        )
    return httpx.Response(200, content=json.dumps(body))


def _epoch(iso_hour: str) -> int:
    from datetime import UTC, datetime

    return int(datetime.strptime(iso_hour, "%Y-%m-%dT%H:%M").replace(tzinfo=UTC).timestamp())
