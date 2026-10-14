"""Forecasts for many points: snapping, de-duplication, caching and batching."""

from __future__ import annotations

import logging
import math
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from django.core.cache import cache

from planner.domain.forecast import HOUR_S, HourlySeries
from planner.domain.geometry import Coordinate
from planner.integrations import open_meteo

logger = logging.getLogger(__name__)

SNAP_DEGREES = 0.05
"""Points are read at the nearest 0.05° lattice point (≤ 3.5 km away), finer
than the forecast models' own grids, so nearby checkpoints share one lookup."""
CACHE_TTL_S = 30 * 60
"""Forecast models update hourly; half an hour keeps lookups reasonably fresh."""
PARALLEL_REQUESTS = 2
"""Open-Meteo slows down sharply when one client opens many requests at once."""


@dataclass(frozen=True, slots=True)
class ForecastWindow:
    """Whole hours from `start` to `end` inclusive (UTC unix seconds)."""

    start: int
    end: int

    @classmethod
    def covering(cls, departure_ts: float, hours: float) -> ForecastWindow:
        """From the hour containing departure through at least `hours` later,
        plus one hour so precipitation totals stamped at the next hour exist.
        Lengths are rounded up to 12 h so similar trips share cache entries."""
        start = math.floor(departure_ts / HOUR_S) * HOUR_S
        needed = math.ceil(hours + (departure_ts - start) / HOUR_S) + 1
        return cls(start=start, end=start + math.ceil(needed / 12) * 12 * HOUR_S)


def snap(point: Coordinate) -> Coordinate:
    return Coordinate(
        round(round(point.lat / SNAP_DEGREES) * SNAP_DEGREES, 4),
        round(round(point.lon / SNAP_DEGREES) * SNAP_DEGREES, 4),
    )


class ForecastLookup:
    """Hourly series for a set of points, fetched once per distinct cell."""

    def __init__(self, series_by_cell: dict[Coordinate, HourlySeries]) -> None:
        self._series_by_cell = series_by_cell

    def __getitem__(self, point: Coordinate) -> HourlySeries:
        return self._series_by_cell[snap(point)]

    @property
    def cell_count(self) -> int:
        return len(self._series_by_cell)


def fetch_forecasts(points: Iterable[Coordinate], window: ForecastWindow) -> ForecastLookup:
    cells = list(dict.fromkeys(snap(point) for point in points))
    keys = {cell: _cache_key(cell, window) for cell in cells}
    cached: dict[str, HourlySeries] = cache.get_many(list(keys.values()))
    found = {cell: cached[keys[cell]] for cell in cells if keys[cell] in cached}
    missing = [cell for cell in cells if cell not in found]

    batch_size = open_meteo.MAX_LOCATIONS_PER_REQUEST
    batches = [missing[i : i + batch_size] for i in range(0, len(missing), batch_size)]
    if batches:
        with ThreadPoolExecutor(max_workers=PARALLEL_REQUESTS) as pool:
            results = pool.map(
                lambda batch: open_meteo.fetch_hourly(batch, window.start, window.end), batches
            )
            for batch, batch_series in zip(batches, results, strict=True):
                found.update(zip(batch, batch_series, strict=True))
        cache.set_many({keys[cell]: found[cell] for cell in missing}, CACHE_TTL_S)

    logger.info("forecasts: %d cells, %d fetched", len(cells), len(missing))
    return ForecastLookup(found)


def _cache_key(cell: Coordinate, window: ForecastWindow) -> str:
    return f"forecast:v1:{cell.lat}:{cell.lon}:{window.start}:{window.end}"
