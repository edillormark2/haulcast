"""The corridor weather heatmap: hourly frames of wind, rain and snow over a
grid around the routes, packed as one RGBA texture for WebGL.

Frame k shows the weather at departure + k hours, read with the same function
that reads checkpoint weather and packed so each reading keeps its risk band:
at whole slider hours a cell's value falls in the band a checkpoint reading
the same forecast gets. Risk is not baked in: the client classifies the
interpolated values with the thresholds sent alongside, which avoids the false
bands that interpolating risk levels would draw.

The browser fetches the heatmap's forecasts from Open-Meteo itself, so they
come out of each viewer's free quota instead of this server's. A plan lays the
heatmap out (`plan_heatmap`): the grid, the point each cell is read at, and the
packed frames of the cells it already has forecasts for. The browser fetches
the other cells and packs them with a copy of `pack_frames`
(frontend/src/lib/heatmap.ts); a shared fixture checks both produce the same
bytes. `build_heatmap` is the fallback when the browser can't reach
Open-Meteo: the server fetches and packs the whole heatmap from the same layout.
"""

from __future__ import annotations

import base64
import math
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache

from planner.domain.corridor import Corridor, build_corridor
from planner.domain.forecast import HOUR_S, HourlySeries
from planner.domain.geometry import Coordinate, Polyline, simplify
from planner.domain.risk import SCALES, BandScale, Factor, scales_for_load
from planner.services.forecasts import (
    HORIZON_HOURS,
    ForecastLookup,
    ForecastWindow,
    fetch_forecasts,
    snap,
)

SLIDER_HOURS = HORIZON_HOURS
"""The slider spans the shared forecast horizon, so a heatmap reads the same
forecast window, and cache entries, as its plan."""
FRAME_COUNT = SLIDER_HOURS + 1
CORRIDOR_BUFFER_MI = 35
CORRIDOR_TOLERANCE_MI = 1.0
"""The corridor only needs the routes' general course."""
MAX_FORECAST_CELLS = 220
"""Open-Meteo charges one call per cell, from a free budget of 600 a minute."""
MIN_STEP_DEG, MAX_STEP_DEG = 0.1, 0.6
ANCHOR_INTERVAL_MI = 50
"""Cells the routes cross are read at the plan's checkpoints on whole
multiples of 50 miles, and at each destination. Every checkpoint interval
(10, 25 or 50 mi) includes those, so every plan has their forecasts, and the
heatmap is the same whichever interval was chosen."""

STEP: dict[Factor, float] = {Factor.WIND: 0.5, Factor.RAIN: 0.01, Factor.SNOW: 0.02}
"""Value of one byte step per channel. Every risk threshold lands on a whole byte."""


@dataclass(frozen=True, slots=True)
class HeatmapLayout:
    """Where the heatmap reads its forecasts, and how they fill the grid."""

    corridor: Corridor
    samples: tuple[Coordinate, ...]
    """The distinct forecast points (snapped), anchors first."""
    anchored: int
    """How many of the samples are anchors, whose forecasts the plan has."""
    sources: tuple[int, ...]
    """For each grid cell, the sample whose weather it shows: its own, or for a
    cell outside the corridor its nearest inside cell's, so interpolation at
    the edge doesn't fade the colours toward calm (-1 if there is none)."""
    alpha: bytes
    """For each grid cell, the corridor weight as a byte. It draws the edge."""


@dataclass(frozen=True, slots=True)
class HeatmapPlan:
    """What a plan hands the browser to build its heatmap."""

    lines: tuple[tuple[Coordinate, ...], ...]
    """Each route's general course. With the anchors, it is also what the
    server fallback is asked for."""
    anchors: tuple[Coordinate, ...]
    departure_ts: int
    """Frame 0, in whole seconds, as the API writes it."""
    layout: HeatmapLayout
    anchor_frames: bytes
    """`pack_frames` of the anchored samples, from the plan's own forecasts."""

    @property
    def window(self) -> ForecastWindow:
        """The hours the browser fetches for the other samples."""
        return ForecastWindow.covering(self.departure_ts, SLIDER_HOURS)


@dataclass(frozen=True, slots=True)
class Heatmap:
    corridor: Corridor
    departure_ts: float
    frames: int
    data_b64: str
    """`frames` × rows × columns × RGBA bytes: wind, rain, snow, corridor weight."""
    scales: dict[Factor, BandScale]
    forecast_cells: int
    fetched_cells: int
    stale_since: float | None
    timings_ms: dict[str, int]


def corridor_lines(routes: Iterable[Polyline]) -> tuple[tuple[Coordinate, ...], ...]:
    """Each route's general course, rounded the way the API sends it, so a
    layout made here and one made from the request echoing these lines match."""
    return tuple(
        tuple(
            Coordinate(round(point.lat, 4), round(point.lon, 4))
            for point in simplify(route.points, CORRIDOR_TOLERANCE_MI)
        )
        for route in routes
    )


def plan_heatmap(
    routes: Iterable[Polyline],
    departure_ts: float,
    anchors: Sequence[Coordinate],
    forecasts: ForecastLookup,
) -> HeatmapPlan:
    """The heatmap's layout for a plan, with the anchored cells already packed
    from `forecasts`, the plan's own (anchors are among its checkpoints)."""
    lines = corridor_lines(routes)
    layout = layout_heatmap(lines, anchors)
    departure = round(departure_ts)
    anchored = (forecasts[point] for point in layout.samples[: layout.anchored])
    return HeatmapPlan(
        lines=lines,
        anchors=tuple(anchors),
        departure_ts=departure,
        layout=layout,
        anchor_frames=pack_frames(anchored, departure),
    )


def build_heatmap(
    lines: Sequence[Sequence[Coordinate]],
    departure: datetime,
    load_lb: int,
    anchors: Iterable[Coordinate] = (),
) -> Heatmap:
    """The whole heatmap, fetched and packed here: the fallback for a browser
    that can't reach Open-Meteo. `anchors` are the plan's checkpoints every
    ANCHOR_INTERVAL_MI miles, whose forecasts are likely still cached."""
    started = time.perf_counter()
    layout = layout_heatmap(lines, anchors)
    departure_ts = round(departure.timestamp())
    forecasts = fetch_forecasts(layout.samples, ForecastWindow.covering(departure_ts, SLIDER_HOURS))
    fetched = time.perf_counter()
    frames = pack_frames((forecasts[point] for point in layout.samples), departure_ts)
    data = texture(layout, frames)
    finished = time.perf_counter()
    return Heatmap(
        corridor=layout.corridor,
        departure_ts=departure_ts,
        frames=FRAME_COUNT,
        data_b64=base64.b64encode(data).decode("ascii"),
        scales=scales_for_load(load_lb),
        forecast_cells=forecasts.cell_count,
        fetched_cells=forecasts.fetched,
        stale_since=forecasts.stale_since,
        timings_ms={
            "weather": round((fetched - started) * 1000),
            "total": round((finished - started) * 1000),
        },
    )


def layout_heatmap(
    lines: Sequence[Sequence[Coordinate]], anchors: Iterable[Coordinate] = ()
) -> HeatmapLayout:
    """`anchors` are the plan's checkpoints every ANCHOR_INTERVAL_MI miles."""
    return _layout(
        tuple(tuple(line) for line in lines),
        tuple(anchors),
        CORRIDOR_BUFFER_MI,
        MAX_FORECAST_CELLS,
        MIN_STEP_DEG,
        MAX_STEP_DEG,
    )


@lru_cache(maxsize=16)
def _layout(
    lines: tuple[tuple[Coordinate, ...], ...],
    anchors: tuple[Coordinate, ...],
    buffer_mi: float,
    max_cells: int,
    min_step_deg: float,
    max_step_deg: float,
) -> HeatmapLayout:
    """Kept per instance: a plan for the same routes at another interval or
    departure, and the fallback request after a plan, reuse the layout. The
    corridor's distances are the slow part (up to ~150 ms)."""
    corridor = build_corridor(
        [Polyline.from_points(line) for line in lines],
        buffer_mi=buffer_mi,
        max_cells=max_cells,
        min_step_deg=min_step_deg,
        max_step_deg=max_step_deg,
    )
    by_cell = {cell: snap(point) for cell, point in corridor.sample_points(anchors).items()}
    anchor_cells = {snap(anchor) for anchor in anchors}
    distinct = list(dict.fromkeys(by_cell.values()))
    samples = [p for p in distinct if p in anchor_cells] + [
        p for p in distinct if p not in anchor_cells
    ]
    index = {point: i for i, point in enumerate(samples)}
    return HeatmapLayout(
        corridor=corridor,
        samples=tuple(samples),
        anchored=sum(point in anchor_cells for point in samples),
        sources=tuple(
            index[by_cell[nearest]] if nearest >= 0 else -1 for nearest in corridor.nearest_inside()
        ),
        alpha=bytes(round(corridor.weight(i) * 255) for i in range(corridor.grid.size)),
    )


def pack_frames(series: Iterable[HourlySeries], departure_ts: int) -> bytes:
    """Each series' FRAME_COUNT hourly frames from departure as wind, rain and
    snow bytes, one series after another. The browser packs the forecasts it
    fetches with a copy of this, which must stay byte for byte the same."""
    data = bytearray()
    for one in series:
        for frame in range(FRAME_COUNT):
            conditions = one.conditions_at(departure_ts + frame * HOUR_S)
            data += bytes(
                (
                    _quantize(conditions.wind_mph, Factor.WIND),
                    _quantize(conditions.rain_in_hr, Factor.RAIN),
                    _quantize(conditions.snow_in_hr, Factor.SNOW),
                )
            )
    return bytes(data)


def texture(layout: HeatmapLayout, frames: bytes) -> bytes:
    """The RGBA texture from every sample's `pack_frames`: FRAME_COUNT frames ×
    rows × columns, each cell showing its source sample, with the corridor
    weight in alpha."""
    size = layout.corridor.grid.size
    data = bytearray(FRAME_COUNT * size * 4)
    for cell, (source, alpha) in enumerate(zip(layout.sources, layout.alpha, strict=True)):
        for frame in range(FRAME_COUNT):
            offset = (frame * size + cell) * 4
            if source >= 0:
                start = (source * FRAME_COUNT + frame) * 3
                data[offset : offset + 3] = frames[start : start + 3]
            data[offset + 3] = alpha
    return bytes(data)


def _quantize(value: float, factor: Factor) -> int:
    """A reading in byte steps, rounded so it keeps the band a checkpoint gives it.

    Every band starts on a whole byte, so rounding down keeps a reading in its
    band: 34.8 mph packs as 34.5, Moderate, where rounding to the nearest step
    showed 35.0, High. Past an exclusive No Travel limit it rounds up instead:
    3.01 in/hr of snow is No Travel, but 3.00 is Severe. The 1e-9 absorbs float
    error, as 0.06 / 0.02 is 2.9999999999999996.
    """
    steps = value / STEP[factor]
    scale = SCALES[factor]
    if not scale.no_travel_inclusive and value > scale.no_travel:
        byte = math.ceil(steps - 1e-9)
    else:
        byte = math.floor(steps + 1e-9)
    return min(255, max(0, byte))
