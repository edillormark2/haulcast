import math

import pytest

from planner.domain.corridor import build_corridor
from planner.domain.forecast import HOUR_S
from planner.domain.geometry import Coordinate, Polyline
from planner.integrations.trips import Trip, highway_ref, make_trip
from planner.services import routing
from planner.services.forecasts import ForecastWindow, snap


def line(lat: float, lon_from: float = -97, lon_to: float = -95, steps: int = 40) -> Polyline:
    return Polyline.from_points(
        [Coordinate(lat, lon_from + (lon_to - lon_from) * i / steps) for i in range(steps + 1)]
    )


def candidate(polyline: Polyline, hours: float, roads: dict[str, float], u_turns: int = 0):
    trip = Trip(
        shape=list(polyline.points),
        timing=[(0, 0.0), (len(polyline.points) - 1, hours * 3600)],
        road_miles=roads,
        time_s=hours * 3600,
        u_turns=u_turns,
    )
    return routing._Candidate(trip=trip, line=polyline)


class TestDetourRules:
    fastest = candidate(line(32.0), 2.0, {"I-20": 115})

    def test_keeps_a_distinct_reasonable_detour(self) -> None:
        detour = candidate(line(32.6), 2.4, {"US-80": 115})
        assert routing._detour_problem(detour, self.fastest, [self.fastest]) is None

    def test_rejects_slow_similar_and_u_turning_detours(self) -> None:
        slow = candidate(line(32.6), 3.5, {})
        similar = candidate(line(32.0), 2.1, {})
        u_turn = candidate(line(32.6), 2.2, {}, u_turns=1)
        kept = [self.fastest]
        assert routing._detour_problem(slow, self.fastest, kept) == "too slow"
        assert routing._detour_problem(similar, self.fastest, kept) == "too similar"
        assert routing._detour_problem(u_turn, self.fastest, kept) == "U-turn"

    def test_rejects_an_out_and_back_spur(self) -> None:
        out = [Coordinate(32.0, -97 + i * 0.05) for i in range(21)]
        spur = [Coordinate(32.0 + i * 0.05, -96.0) for i in range(1, 11)]
        back = list(reversed(spur))[1:]
        rest = [Coordinate(32.0, -96 + i * 0.05) for i in range(1, 21)]
        doubling = candidate(Polyline.from_points(out + spur + back + rest), 2.2, {})
        assert routing._detour_problem(doubling, self.fastest, []) == "doubles back"


def test_labels_name_the_roads_that_set_routes_apart() -> None:
    a = candidate(line(32.0), 2.0, {"I-20": 100, "I-30": 15})
    b = candidate(line(32.6), 2.2, {"I-20": 60, "US-80": 55})
    c = candidate(line(31.4), 2.5, {"I-20": 50, "TX-31": 65})
    assert routing._via_labels([a, b, c]) == ["via I-20 & I-30", "via US-80", "via TX-31"]


@pytest.mark.parametrize(
    ("name", "ref"),
    [("I 80 West", "I-80"), ("US 6", "US-6"), ("IL-53", "IL-53"), ("Main Street", None)],
)
def test_highway_refs_are_normalised(name: str, ref: str | None) -> None:
    assert highway_ref(name) == ref


def test_thinning_a_shape_never_moves_a_timing_breakpoint() -> None:
    shape = [Coordinate(32.0, -97 + i * 0.0001) for i in range(101)]  # collinear
    trip = make_trip(shape, [(0, 0.0), (50, 30.0), (100, 60.0)], {}, 60.0)
    # Every collinear point goes except the breakpoint in the middle.
    assert trip.shape == [shape[0], shape[50], shape[100]]
    assert trip.timing == [(0, 0.0), (1, 30.0), (2, 60.0)]


class TestCorridor:
    def test_respects_the_forecast_budget_and_covers_the_route(self) -> None:
        route = line(32.0, -100, -90, steps=200)
        corridor = build_corridor(
            [route], buffer_mi=35, max_cells=120, min_step_deg=0.1, max_step_deg=0.6
        )
        assert len(corridor.cell_indices) <= 120
        grid = corridor.grid
        for point in route.points[::20]:
            row = round((point.lat - grid.south) / grid.lat_step)
            column = round((point.lon - grid.west) / grid.lon_step)
            assert corridor.distances_mi[row * grid.columns + column] <= 35

    def test_weight_fades_from_the_route_to_the_edge(self) -> None:
        corridor = build_corridor(
            [line(32.0)], buffer_mi=35, max_cells=500, min_step_deg=0.1, max_step_deg=0.6
        )
        weights = [corridor.weight(i) for i in range(corridor.grid.size)]
        nearest = min(range(corridor.grid.size), key=lambda i: corridor.distances_mi[i])
        assert weights[nearest] == 1
        assert min(weights) == 0
        assert all(0 <= w <= 1 for w in weights)

    def test_cells_outside_take_the_nearest_inside_value(self) -> None:
        corridor = build_corridor(
            [line(32.0)], buffer_mi=35, max_cells=500, min_step_deg=0.1, max_step_deg=0.6
        )
        inside = set(corridor.cell_indices)
        nearest = corridor.nearest_inside()
        assert all(nearest[i] == i for i in inside)
        assert all(source in inside for source in nearest)


def test_forecast_window_covers_the_trip_and_rounds_to_12_hours() -> None:
    departure = 1_792_000_800 + 20 * 60  # 20 minutes past an hour
    window = ForecastWindow.covering(departure, hours=30)
    assert window.start == 1_792_000_800
    assert window.end - window.start == 36 * HOUR_S
    assert window.end >= departure + 31 * HOUR_S


def test_points_snap_to_a_0_05_degree_lattice() -> None:
    assert snap(Coordinate(41.8781, -87.6298)) == Coordinate(41.9, -87.65)
    assert math.isclose(snap(Coordinate(39.74, -104.99)).lat, 39.75)
