"""Forecasts for many points: snapping, de-duplication, caching and batching.

Open-Meteo's free tier charges one call per location, so every lookup is
arranged to fetch as few distinct locations as possible and to reuse them:
points snap to a lattice, a plan and its heatmap read one shared window, and
forecasts that arrive are cached batch by batch. When Open-Meteo refuses or
fails, older cached forecasts stand in rather than failing the request.
"""

from __future__ import annotations

import logging
import math
import time
from collections.abc import Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import NamedTuple

from django.core.cache import cache

from planner.domain.forecast import HOUR_S, HourlySeries
from planner.domain.geometry import Coordinate
from planner.integrations import open_meteo
from planner.integrations.http import UpstreamError

logger = logging.getLogger(__name__)

SNAP_DEGREES = 0.05
"""Points are read at the nearest 0.05° lattice point (≤ 3.5 km away), finer
than the forecast models' own grids, so nearby checkpoints share one lookup."""
FRESH_S = 30 * 60
"""Forecast models update hourly; half an hour keeps lookups reasonably fresh."""
KEEP_S = 6 * 60 * 60
"""Older forecasts stay cached this long to stand in when Open-Meteo refuses."""
PARALLEL_REQUESTS = 2
"""Open-Meteo runs one request per client IP at a time and queues the rest
(refusing past five), so a second request only overlaps the transfer."""
HORIZON_HOURS = 48
"""Every window covers at least the heatmap's 48 hours from departure, so a
plan and its heatmap read the same cache entries. Hours are free: Open-Meteo
charges per location for anything up to 14 days."""
BLOCK_HOURS = 6
"""Windows start on 6-hour UTC blocks, so departures in one block share them."""


@dataclass(frozen=True, slots=True)
class ForecastWindow:
    """Whole hours from `start` to `end` inclusive (UTC unix seconds)."""

    start: int
    end: int

    @classmethod
    def covering(cls, departure_ts: float, hours: float) -> ForecastWindow:
        """From the start of the 6-hour block containing departure through at
        least `hours` (and at least 48) later, plus one hour so precipitation
        totals stamped at the next hour exist. Lengths are rounded up to 12 h."""
        block_s = BLOCK_HOURS * HOUR_S
        start = math.floor(departure_ts / block_s) * block_s
        needed = math.ceil(max(hours, HORIZON_HOURS) + (departure_ts - start) / HOUR_S) + 1
        return cls(start=start, end=start + math.ceil(needed / 12) * 12 * HOUR_S)


def snap(point: Coordinate) -> Coordinate:
    return Coordinate(
        round(round(point.lat / SNAP_DEGREES) * SNAP_DEGREES, 4),
        round(round(point.lon / SNAP_DEGREES) * SNAP_DEGREES, 4),
    )


class ForecastLookup:
    """Hourly series for a set of points, fetched once per distinct cell.

    `fetched` counts the cells this lookup paid Open-Meteo for; the rest came
    from the cache. `stale_since` is set when older cached forecasts stood in
    for a failed fetch: when the oldest of them was fetched (unix seconds).
    """

    def __init__(
        self,
        series_by_cell: dict[Coordinate, HourlySeries],
        *,
        fetched: int,
        stale_since: float | None = None,
    ) -> None:
        self._series_by_cell = series_by_cell
        self.fetched = fetched
        self.stale_since = stale_since

    def __getitem__(self, point: Coordinate) -> HourlySeries:
        return self._series_by_cell[snap(point)]

    @property
    def cell_count(self) -> int:
        return len(self._series_by_cell)


class _Entry(NamedTuple):
    fetched_at: float
    series: HourlySeries


def fetch_forecasts(points: Iterable[Coordinate], window: ForecastWindow) -> ForecastLookup:
    cells = list(dict.fromkeys(snap(point) for point in points))
    keys = {cell: _cache_key(cell, window) for cell in cells}
    entries: dict[str, _Entry] = cache.get_many(list(keys.values()))
    cached = {cell: entries[keys[cell]] for cell in cells if keys[cell] in entries}
    now = time.time()
    series = {
        cell: entry.series for cell, entry in cached.items() if now - entry.fetched_at < FRESH_S
    }
    missing = [cell for cell in cells if cell not in series]

    fetched, error = _download(missing, window)
    # Cached even when another batch failed, so a retry pays only for the rest.
    cache.set_many({keys[cell]: _Entry(now, s) for cell, s in fetched.items()}, KEEP_S)
    series.update(fetched)
    logger.info("forecasts: %d cells, %d fetched", len(cells), len(fetched))

    stale_since = None
    if error is not None:
        unavailable = [cell for cell in missing if cell not in fetched]
        if any(cell not in cached for cell in unavailable):
            raise error
        stale_since = min(cached[cell].fetched_at for cell in unavailable)
        series.update({cell: cached[cell].series for cell in unavailable})
        logger.warning(
            "forecasts: %s; %d cells read from older cache entries", error, len(unavailable)
        )
    return ForecastLookup(series, fetched=len(fetched), stale_since=stale_since)


def _download(
    cells: Sequence[Coordinate], window: ForecastWindow
) -> tuple[dict[Coordinate, HourlySeries], UpstreamError | None]:
    """Fetch `cells` in parallel batches. Batches that arrived are returned even
    when another failed; after a failure, batches not yet sent are dropped,
    since a refusal would refuse them too."""
    size = open_meteo.MAX_LOCATIONS_PER_REQUEST
    batches = [cells[i : i + size] for i in range(0, len(cells), size)]
    fetched: dict[Coordinate, HourlySeries] = {}
    error: UpstreamError | None = None
    if not batches:
        return fetched, error
    with ThreadPoolExecutor(max_workers=PARALLEL_REQUESTS) as pool:
        futures = {
            pool.submit(open_meteo.fetch_hourly, batch, window.start, window.end): batch
            for batch in batches
        }
        for future in as_completed(futures):
            if future.cancelled():
                continue
            try:
                fetched.update(zip(futures[future], future.result(), strict=True))
            except UpstreamError as exc:
                error = error or exc
                for pending in futures:
                    pending.cancel()
    return fetched, error


def _cache_key(cell: Coordinate, window: ForecastWindow) -> str:
    return f"forecast:v2:{cell.lat}:{cell.lon}:{window.start}:{window.end}"
