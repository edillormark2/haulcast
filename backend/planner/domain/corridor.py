"""The heatmap's sampling grid: a regular lattice over the routes' bounding box,
masked to the cells within a buffer distance of any route (the corridor)."""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass

from planner.domain.geometry import MILES_PER_DEGREE_LAT, Coordinate, Polyline

GROWTH_FACTOR = 1.2


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
    mask: tuple[bool, ...]
    """Row-major; True for cells inside the corridor."""

    @property
    def cell_indices(self) -> list[int]:
        return [i for i, inside in enumerate(self.mask) if inside]

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
        mask = _corridor_mask(grid, routes, buffer_mi, lon_miles_per_degree)
        if sum(mask) <= max_cells or step >= max_step_deg:
            return Corridor(grid=grid, mask=tuple(mask))
        step = min(step * GROWTH_FACTOR, max_step_deg)


def _corridor_mask(
    grid: Grid, routes: Sequence[Polyline], buffer_mi: float, lon_miles_per_degree: float
) -> list[bool]:
    """Mark cells within `buffer_mi` of points sampled densely along each route."""
    cell_mi = grid.lat_step * MILES_PER_DEGREE_LAT
    reach_rows = math.ceil(buffer_mi / cell_mi) + 1
    reach_columns = math.ceil(buffer_mi / (grid.lon_step * lon_miles_per_degree)) + 1
    mask = [False] * grid.size
    for route in routes:
        sample_count = max(2, math.ceil(route.length_mi / (cell_mi / 2)) + 1)
        for k in range(sample_count):
            sample = route.point_at(route.length_mi * k / (sample_count - 1))
            row0 = round((sample.lat - grid.south) / grid.lat_step)
            column0 = round((sample.lon - grid.west) / grid.lon_step)
            for row in range(max(0, row0 - reach_rows), min(grid.rows, row0 + reach_rows + 1)):
                for column in range(
                    max(0, column0 - reach_columns), min(grid.columns, column0 + reach_columns + 1)
                ):
                    index = row * grid.columns + column
                    if not mask[index]:
                        cell = grid.point(index)
                        dy = (cell.lat - sample.lat) * MILES_PER_DEGREE_LAT
                        dx = (cell.lon - sample.lon) * lon_miles_per_degree
                        mask[index] = dx * dx + dy * dy <= buffer_mi * buffer_mi
    return mask


def nearest_cell(grid: Grid, point: Coordinate) -> int:
    row = min(max(round((point.lat - grid.south) / grid.lat_step), 0), grid.rows - 1)
    column = min(max(round((point.lon - grid.west) / grid.lon_step), 0), grid.columns - 1)
    return row * grid.columns + column
