"""The browser packs the heatmap's frames itself (frontend/src/lib/heatmap.ts),
so it must produce exactly the server's bytes.

`fixtures/heatmap_parity.json` holds, for two departures, the heatmap layout a
plan sends, Open-Meteo's answers for every sample and the texture the server
packs from them. This test checks the server still writes exactly that file;
the frontend's heatmapParity.test.ts checks the browser builds the same
textures from it. After changing the server's packing on purpose, rewrite the
file, then make the browser match:

    UPDATE_FIXTURES=1 uv run pytest planner/tests/test_heatmap_parity.py
"""

from __future__ import annotations

import base64
import json
import math
import os
import random
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from planner.api.presenters import present_heatmap_layout
from planner.domain.forecast import HOUR_S
from planner.domain.geometry import Coordinate, Polyline
from planner.domain.risk import Factor
from planner.services import heatmap
from planner.services.forecasts import ForecastWindow, fetch_forecasts, snap
from planner.tests.conftest import OPEN_METEO

FIXTURE = Path(__file__).parent / "fixtures" / "heatmap_parity.json"
DEPARTURES = (
    "2026-10-16T11:30:00Z",  # half past: blending two whole or half mph values can tie
    "2026-10-16T14:20:00Z",  # a third of an hour: blends that aren't round
)
LINES = (
    (Coordinate(32.0, -97.0), Coordinate(32.3, -96.0)),
    (Coordinate(31.8, -97.0), Coordinate(32.0, -96.4), Coordinate(32.3, -96.0)),
)
ANCHORS = (snap(Coordinate(32.0, -97.0)), snap(Coordinate(32.3, -96.0)))


def test_the_browser_packs_the_same_bytes_as_the_server(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A small grid keeps the shared fixture small.
    monkeypatch.setattr(heatmap, "MIN_STEP_DEG", 0.5)
    monkeypatch.setattr(heatmap, "MAX_STEP_DEG", 0.5)
    cases = [_case(departure) for departure in DEPARTURES]
    # The answers must test the rounding: Python rounds ties to even, so a
    # browser that rounds half up (Math.round, toFixed) would differ here.
    wind_ties, snow_ties = map(sum, zip(*(_ties(case) for case in cases), strict=True))
    assert wind_ties > 0
    assert snow_ties > 0

    written = json.dumps({"cases": cases}, separators=(",", ":")) + "\n"
    if os.environ.get("UPDATE_FIXTURES"):
        FIXTURE.parent.mkdir(exist_ok=True)
        FIXTURE.write_text(written)
    assert FIXTURE.read_text() == written, (
        "The server's heatmap bytes changed. If that was meant, rewrite the fixture "
        "(see this module's docstring) and make frontend/src/lib/heatmap.ts match."
    )


def _case(departure: str) -> dict[str, Any]:
    departure_ts = round(datetime.fromisoformat(departure).timestamp())
    layout = heatmap.layout_heatmap(LINES, ANCHORS)
    window = ForecastWindow.covering(departure_ts, heatmap.SLIDER_HOURS)
    answers = [_answer(point, window) for point in layout.samples]

    with _open_meteo(dict(zip(layout.samples, answers, strict=True))):
        # The plan's side: its own forecasts for the anchored samples.
        plan_forecasts = fetch_forecasts(layout.samples[: layout.anchored], window)
        planned = heatmap.plan_heatmap(
            (Polyline.from_points(line) for line in LINES), departure_ts, ANCHORS, plan_forecasts
        )
        # The server fallback, which fetches and packs everything.
        server = heatmap.build_heatmap(
            LINES, datetime.fromisoformat(departure), load_lb=40_000, anchors=ANCHORS
        )
        rest = fetch_forecasts(layout.samples[layout.anchored :], window)

    # What the browser does, in Python: the plan's frames, then the rest packed.
    browser = heatmap.texture(
        planned.layout,
        planned.anchor_frames
        + heatmap.pack_frames(
            (rest[point] for point in layout.samples[layout.anchored :]), departure_ts
        ),
    )
    assert planned.layout == layout
    assert base64.b64encode(browser).decode("ascii") == server.data_b64
    return {
        "departure": departure,
        "layout": present_heatmap_layout(planned),
        "open_meteo": answers,
        "texture": server.data_b64,
    }


def _answer(point: Coordinate, window: ForecastWindow) -> dict[str, Any]:
    """An Open-Meteo answer for one point, as the browser asks for it, with
    values picked to land on rounding ties and the byte limits."""
    rnd = random.Random(f"{point.lat:.4f},{point.lon:.4f}")
    hours = (window.end - window.start) // HOUR_S + 1

    def series(*special: float, top: float, digits: int) -> list[float]:
        return [
            rnd.choice([0.0, *special, round(rnd.uniform(0, top), digits)]) for _ in range(hours)
        ]

    return {
        # Open-Meteo answers with its model cell's position, not the one asked for.
        "latitude": round(point.lat + 0.0123, 5),
        "longitude": round(point.lon - 0.0217, 5),
        "hourly": {
            "time": [window.start + hour * HOUR_S for hour in range(hours)],
            # Whole and half mph values blend to exact ties at :30; 130 mph overflows a byte.
            "wind_speed_10m": series(12.0, 12.5, 37.5, 130.0, top=70, digits=1),
            "rain": series(0.125, 0.1, 0.004, 3.0, top=1.2, digits=3),
            "showers": series(0.2, 0.025, top=0.4, digits=3),
            # Odd hundredths of snow are ties in 0.02 in/hr steps.
            "snowfall": series(0.01, 0.05, 0.49, 0.99, 1.99, 6.0, top=3.5, digits=2),
        },
    }


def _ties(case: dict[str, Any]) -> tuple[int, int]:
    """Frames whose wind (to 0.1 mph) or snow byte rounds differently half up."""
    departure_ts = round(datetime.fromisoformat(case["departure"]).timestamp())
    wind_ties = snow_ties = 0
    for answer in case["open_meteo"]:
        hourly = answer["hourly"]
        for frame in range(heatmap.FRAME_COUNT):
            offset_h = (departure_ts + frame * HOUR_S - hourly["time"][0]) / HOUR_S
            hour = math.floor(offset_h)
            a, b = hourly["wind_speed_10m"][hour : hour + 2]
            wind = a + (b - a) * (offset_h - hour)
            wind_ties += round(wind, 1) != math.floor(wind * 10 + 0.5) / 10
            snow = round(hourly["snowfall"][hour + 1], 2) / heatmap.STEP[Factor.SNOW]
            snow_ties += round(snow) != math.floor(snow + 0.5)
    return wind_ties, snow_ties


def _open_meteo(answers: dict[Coordinate, dict[str, Any]]) -> respx.MockRouter:
    def reply(request: httpx.Request) -> httpx.Response:
        params = request.url.params
        points = zip(params["latitude"].split(","), params["longitude"].split(","), strict=True)
        body = []
        for lat, lon in points:
            answer = answers[Coordinate(float(lat), float(lon))]
            hourly = answer["hourly"]
            # The server asks for gusts too (plans show them).
            gusts = {"wind_gusts_10m": [wind * 1.5 for wind in hourly["wind_speed_10m"]]}
            body.append(answer | {"hourly": hourly | gusts})
        return httpx.Response(200, json=body)

    router = respx.mock(assert_all_called=False)
    router.get(OPEN_METEO).mock(side_effect=reply)
    return router
