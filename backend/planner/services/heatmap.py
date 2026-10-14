"""The corridor weather heatmap: hourly frames of wind, rain and snow over a
grid around the routes, packed as one RGBA texture for WebGL.

Frame k shows the weather at departure + k hours, read with the same function
that reads checkpoint weather, so the heatmap and the checkpoints always agree
at whole slider hours. Risk is not baked in: the client classifies the
interpolated values with the thresholds sent alongside, which avoids the false
bands that interpolating risk levels would draw.
"""

from __future__ import annotations

import base64
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from planner.domain.corridor import Corridor, build_corridor
from planner.domain.forecast import HOUR_S
from planner.domain.geometry import Coordinate, Polyline
from planner.domain.risk import BandScale, Factor, scales_for_load
from planner.services.forecasts import ForecastWindow, fetch_forecasts

SLIDER_HOURS = 48
FRAME_COUNT = SLIDER_HOURS + 1
CORRIDOR_BUFFER_MI = 35
MAX_FORECAST_CELLS = 220
"""Keeps one heatmap well inside Open-Meteo's free 600 calls/minute."""
MIN_STEP_DEG, MAX_STEP_DEG = 0.1, 0.6

STEP: dict[Factor, float] = {Factor.WIND: 0.5, Factor.RAIN: 0.01, Factor.SNOW: 0.02}
"""Value of one byte step per channel. Every risk threshold lands on a whole byte."""


@dataclass(frozen=True, slots=True)
class Heatmap:
    corridor: Corridor
    departure_ts: float
    frames: int
    data_b64: str
    """`frames` × rows × columns × RGBA bytes: wind, rain, snow, corridor weight."""
    scales: dict[Factor, BandScale]
    forecast_cells: int
    timings_ms: dict[str, int]


def build_heatmap(
    lines: Sequence[Sequence[Coordinate]], departure: datetime, load_lb: int
) -> Heatmap:
    started = time.perf_counter()
    corridor = build_corridor(
        [Polyline.from_points(line) for line in lines],
        buffer_mi=CORRIDOR_BUFFER_MI,
        max_cells=MAX_FORECAST_CELLS,
        min_step_deg=MIN_STEP_DEG,
        max_step_deg=MAX_STEP_DEG,
    )
    grid, cells = corridor.grid, corridor.cell_indices
    departure_ts = departure.timestamp()
    forecasts = fetch_forecasts(
        (grid.point(i) for i in cells), ForecastWindow.covering(departure_ts, SLIDER_HOURS)
    )
    fetched = time.perf_counter()

    data = bytearray(FRAME_COUNT * grid.size * 4)
    for cell in cells:
        series = forecasts[grid.point(cell)]
        for frame in range(FRAME_COUNT):
            conditions = series.conditions_at(departure_ts + frame * HOUR_S)
            offset = (frame * grid.size + cell) * 4
            data[offset] = _quantize(conditions.wind_mph, STEP[Factor.WIND])
            data[offset + 1] = _quantize(conditions.rain_in_hr, STEP[Factor.RAIN])
            data[offset + 2] = _quantize(conditions.snow_in_hr, STEP[Factor.SNOW])

    # Alpha carries the corridor weight. Cells outside the corridor copy their
    # nearest inside neighbour's weather so bilinear filtering at the edge
    # doesn't fade the colours toward calm; the weight draws the edge instead.
    weights = [round(corridor.weight(i) * 255) for i in range(grid.size)]
    nearest = corridor.nearest_inside()
    for frame in range(FRAME_COUNT):
        base = frame * grid.size
        for cell, source in enumerate(nearest):
            offset = (base + cell) * 4
            if source != cell and source >= 0:
                source_offset = (base + source) * 4
                data[offset : offset + 3] = data[source_offset : source_offset + 3]
            data[offset + 3] = weights[cell]

    finished = time.perf_counter()
    return Heatmap(
        corridor=corridor,
        departure_ts=departure_ts,
        frames=FRAME_COUNT,
        data_b64=base64.b64encode(bytes(data)).decode("ascii"),
        scales=scales_for_load(load_lb),
        forecast_cells=forecasts.cell_count,
        timings_ms={
            "weather": round((fetched - started) * 1000),
            "total": round((finished - started) * 1000),
        },
    )


def _quantize(value: float, step: float) -> int:
    return min(255, max(0, round(value / step)))
