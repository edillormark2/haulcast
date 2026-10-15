"""The heatmap's sampling grid: a regular lattice over the routes' bounding box,
limited to the cells within a buffer distance of any route (the corridor)."""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from planner.domain.geometry import MILES_PER_DEGREE_LAT, Coordinate, Polyline

GROWTH_FACTOR = 1.2
SOLID_SHARE = 0.55
"""Cells closer than this share of the buffer are fully opaque; the corridor
fades out over the rest of the buffer."""


@dataclass(frozen=True, slots=True)
class Grid:
    """Cell centres at (south + row·lat_step, west + column·lon_step)."""

    west: float
    south: float
    lon_step: float
    lat_step: float
    columns: int
    rows: int

    @property
    def east(self) -> float:
        return self.west + (self.columns - 1) * self.lon_step

    @property
    def north(self) -> float:
        return self.south + (self.rows - 1) * self.lat_step

    @property
    def size(self) -> int:
        return self.columns * self.rows

    def point(self, index: int) -> Coordinate:
        row, column = divmod(index, self.columns)
        return Coordinate(self.south + row * self.lat_step, self.west + column * self.lon_step)


@dataclass(frozen=True, slots=True)
class Corridor:
    grid: Grid
    distances_mi: tuple[float, ...]
    """Row-major distance from each cell centre to the nearest route (inf if far)."""
    buffer_mi: float

    @property
    def cell_indices(self) -> list[int]:
        """Cells inside the corridor, which need forecasts."""
        return [i for i, d in enumerate(self.distances_mi) if d <= self.buffer_mi]

    def sample_points(self, anchors: Iterable[Coordinate]) -> dict[int, Coordinate]:
        """Where to read each corridor cell's forecast: the anchor inside the
        cell nearest its centre when there is one, otherwise the centre. A
        cell is a point sample of the weather either way; reading it at an
        anchor lets it reuse a forecast already fetched for that point."""
        grid = self.grid
        samples = {index: grid.point(index) for index in self.cell_indices}
        offsets: dict[int, float] = {}
        for anchor in anchors:
            row_f = (anchor.lat - grid.south) / grid.lat_step
            column_f = (anchor.lon - grid.west) / grid.lon_step
            row, column = round(row_f), round(column_f)
            if not (0 <= row < grid.rows and 0 <= column < grid.columns):
                continue
            index = row * grid.columns + column
            # In cell units: cells are about square in miles.
            offset = math.hypot(row_f - row, column_f - column)
            if index in samples and offset < offsets.get(index, math.inf):
                samples[index] = anchor
                offsets[index] = offset
        return samples

    def weight(self, index: int) -> float:
        """1 near a route, fading to 0 at the corridor edge."""
        solid = SOLID_SHARE * self.buffer_mi
        distance = self.distances_mi[index]
        return min(1.0, max(0.0, (self.buffer_mi - distance) / (self.buffer_mi - solid)))

    def nearest_inside(self) -> list[int]:
        """For every cell, the index of the nearest corridor cell (itself when
        inside). Used to pad values past the corridor edge so interpolation
        near the edge doesn't blend toward zero."""
        nearest = [-1] * self.grid.size
        queue: deque[int] = deque()
        for index in self.cell_indices:
            nearest[index] = index
            queue.append(index)
        columns, rows = self.grid.columns, self.grid.rows
        while queue:
            index = queue.popleft()
            row, column = divmod(index, columns)
            for d_row, d_column in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                r, c = row + d_row, column + d_column
                if 0 <= r < rows and 0 <= c < columns and nearest[r * columns + c] == -1:
                    nearest[r * columns + c] = nearest[index]
                    queue.append(r * columns + c)
        return nearest


def build_corridor(
    routes: Sequence[Polyline],
    *,
    buffer_mi: float,
    max_cells: int,
    min_step_deg: float,
    max_step_deg: float,
) -> Corridor:
    """The finest grid (cells roughly square in miles) whose corridor needs at
    most `max_cells` forecast points."""
    points = [p for route in routes for p in route.points]
    south, north = min(p.lat for p in points), max(p.lat for p in points)
    west, east = min(p.lon for p in points), max(p.lon for p in points)
    lon_miles_per_degree = MILES_PER_DEGREE_LAT * math.cos(math.radians((south + north) / 2))

    step = min_step_deg
    while True:
        lat_step, lon_step = step, step * MILES_PER_DEGREE_LAT / lon_miles_per_degree
        pad_lat = buffer_mi / MILES_PER_DEGREE_LAT + lat_step
        pad_lon = buffer_mi / lon_miles_per_degree + lon_step
        grid = Grid(
            west=west - pad_lon,
            south=south - pad_lat,
            lon_step=lon_step,
            lat_step=lat_step,
            columns=math.ceil((east - west + 2 * pad_lon) / lon_step) + 1,
            rows=math.ceil((north - south + 2 * pad_lat) / lat_step) + 1,
        )
        corridor = Corridor(
            grid=grid,
            distances_mi=_distances(grid, routes, buffer_mi, lon_miles_per_degree),
            buffer_mi=buffer_mi,
        )
        if len(corridor.cell_indices) <= max_cells or step >= max_step_deg:
            return corridor
        step = min(step * GROWTH_FACTOR, max_step_deg)


def _distances(
    grid: Grid, routes: Sequence[Polyline], buffer_mi: float, lon_miles_per_degree: float
) -> tuple[float, ...]:
    """Distance from each cell to points sampled densely along the routes,
    computed only for cells within reach of the buffer."""
    cell_mi = grid.lat_step * MILES_PER_DEGREE_LAT
    reach_rows = math.ceil(buffer_mi / cell_mi) + 1
    reach_columns = math.ceil(buffer_mi / (grid.lon_step * lon_miles_per_degree)) + 1
    distances = [math.inf] * grid.size
    for route in routes:
        sample_count = max(2, math.ceil(route.length_mi / (cell_mi / 3)) + 1)
        for k in range(sample_count):
            sample = route.point_at(route.length_mi * k / (sample_count - 1))
            row0 = round((sample.lat - grid.south) / grid.lat_step)
            column0 = round((sample.lon - grid.west) / grid.lon_step)
            for row in range(max(0, row0 - reach_rows), min(grid.rows, row0 + reach_rows + 1)):
                dy = (grid.south + row * grid.lat_step - sample.lat) * MILES_PER_DEGREE_LAT
                for column in range(
                    max(0, column0 - reach_columns), min(grid.columns, column0 + reach_columns + 1)
                ):
                    dx = (grid.west + column * grid.lon_step - sample.lon) * lon_miles_per_degree
                    index = row * grid.columns + column
                    distances[index] = min(distances[index], math.hypot(dx, dy))
    return tuple(distances)
