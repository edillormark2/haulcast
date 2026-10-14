import pytest

from planner.domain.geometry import (
    Coordinate,
    Polyline,
    checkpoint_miles,
    coverage,
    decode_polyline,
    haversine_mi,
    simplify,
)

CHICAGO = Coordinate(41.8781, -87.6298)
DENVER = Coordinate(39.7392, -104.9903)


def test_haversine_matches_known_distance() -> None:
    # Great-circle Chicago–Denver is about 920 miles.
    assert haversine_mi(CHICAGO, DENVER) == pytest.approx(920, abs=3)


def test_decodes_google_reference_polyline() -> None:
    # Example from Google's encoded polyline documentation (precision 5).
    points = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision=5)
    assert points == [
        Coordinate(38.5, -120.2),
        Coordinate(40.7, -120.95),
        Coordinate(43.252, -126.453),
    ]


def straight_line(miles: float) -> Polyline:
    """A due-north line starting at the equator, `miles` long."""
    degrees = miles / haversine_mi(Coordinate(0, 0), Coordinate(1, 0))
    return Polyline.from_points(
        [Coordinate(0, 0), Coordinate(degrees / 2, 0), Coordinate(degrees, 0)]
    )


def test_point_at_interpolates_along_the_line() -> None:
    line = straight_line(100)
    assert line.length_mi == pytest.approx(100)
    assert haversine_mi(line.points[0], line.point_at(25)) == pytest.approx(25)
    assert line.point_at(-5) == line.points[0]
    assert line.point_at(500) == line.points[-1]


def test_section_includes_interior_vertices_and_interpolated_ends() -> None:
    line = straight_line(100)
    section = line.section(25, 75)
    assert len(section) == 3  # start, the midpoint vertex, end
    assert haversine_mi(section[0], section[-1]) == pytest.approx(50)


@pytest.mark.parametrize(
    ("length", "interval", "expected"),
    [
        (100, 25, [0, 25, 50, 75, 100]),
        (110, 25, [0, 25, 50, 75, 100, 110]),
        (8, 10, [0, 8]),
        (120, 50, [0, 50, 100, 120]),
    ],
)
def test_checkpoints_every_interval_plus_destination(
    length: float, interval: float, expected: list[float]
) -> None:
    assert checkpoint_miles(length, interval) == expected


def test_coverage_tiles_the_route() -> None:
    miles = [0, 25, 50, 60]
    stretches = coverage(miles)
    assert stretches == [(0, 12.5), (12.5, 37.5), (37.5, 55), (55, 60)]
    assert sum(end - start for start, end in stretches) == 60


def test_simplify_drops_collinear_points_and_keeps_corners() -> None:
    points = [Coordinate(0, x / 10) for x in range(11)] + [Coordinate(1, 1)]
    simplified = simplify(points, tolerance_mi=0.1)
    assert simplified == [Coordinate(0, 0), Coordinate(0, 1), Coordinate(1, 1)]
