"""The corridor weather heatmap: hourly frames of risk, wind, rain and snow
over a grid around the routes, packed for upload as WebGL textures."""

from __future__ import annotations

import base64
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from planner.domain.corridor import Corridor, build_corridor
from planner.domain.geometry import Coordinate, Polyline
from planner.domain.risk import Conditions, assess
from planner.services.forecasts import ForecastWindow, fetch_forecasts

SLIDER_HOURS = 48
FRAME_COUNT = SLIDER_HOURS + 2
"""Frames start at the top of the departure hour, so one extra frame keeps
"+48 h" inside the data for any departure minute."""
CORRIDOR_BUFFER_MI = 30
MAX_FORECAST_CELLS = 220
"""Keeps a heatmap well inside Open-Meteo's free 600 calls/minute."""
MIN_STEP_DEG, MAX_STEP_DEG = 0.1, 0.6


@dataclass(frozen=True, slots=True)
class LayerSpec:
    scale: float
    """Value represented by one byte step."""
    unit: str

    def quantize(self, value: float) -> int:
        return min(255, max(0, round(value / self.scale)))


LAYER_SPECS: dict[str, LayerSpec] = {
    "risk": LayerSpec(1, "level"),
    "wind": LayerSpec(0.5, "mph"),
    "rain": LayerSpec(0.01, "in/hr"),
    "snow": LayerSpec(0.02, "in/hr"),
}


@dataclass(frozen=True, slots=True)
class Layer:
    scale: float
    unit: str
    data_b64: str
    """`FRAME_COUNT` row-major frames of grid bytes, frame after frame."""


@dataclass(frozen=True, slots=True)
class Heatmap:
    corridor: Corridor
    start_ts: int
    hours: int
    mask_b64: str
    layers: dict[str, Layer]
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
    window = ForecastWindow.covering(departure.timestamp(), FRAME_COUNT)
    forecasts = fetch_forecasts((grid.point(i) for i in cells), window)
    fetched = time.perf_counter()

    frames = {name: bytearray(FRAME_COUNT * grid.size) for name in LAYER_SPECS}
    for cell in cells:
        series = forecasts[grid.point(cell)]
        for hour in range(FRAME_COUNT):
            conditions = series.conditions_at_hour(hour)
            values = _layer_values(conditions, load_lb)
            for name, value in values.items():
                frames[name][hour * grid.size + cell] = LAYER_SPECS[name].quantize(value)

    # Pad cells outside the corridor with their nearest inside value so that
    # bilinear filtering at the corridor edge doesn't fade toward zero; the
    # mask, not the data, draws the edge.
    nearest = corridor.nearest_inside()
    outside = [(cell, source) for cell, source in enumerate(nearest) if source != cell]
    for data in frames.values():
        for hour in range(FRAME_COUNT):
            base = hour * grid.size
            for cell, source in outside:
                data[base + cell] = data[base + source]

    finished = time.perf_counter()
    return Heatmap(
        corridor=corridor,
        start_ts=window.start,
        hours=FRAME_COUNT,
        mask_b64=_b64(bytes(255 if inside else 0 for inside in corridor.mask)),
        layers={
            name: Layer(scale=spec.scale, unit=spec.unit, data_b64=_b64(bytes(frames[name])))
            for name, spec in LAYER_SPECS.items()
        },
        forecast_cells=forecasts.cell_count,
        timings_ms={
            "weather": round((fetched - started) * 1000),
            "total": round((finished - started) * 1000),
        },
    )


def _layer_values(conditions: Conditions, load_lb: int) -> dict[str, float]:
    return {
        "risk": assess(conditions, load_lb).level,
        "wind": conditions.wind_mph,
        "rain": conditions.rain_in_hr,
        "snow": conditions.snow_in_hr,
    }


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")
