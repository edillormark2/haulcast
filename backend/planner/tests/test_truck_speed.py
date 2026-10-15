"""Both routers plan the truck at the same top speed, so ETAs don't depend on
which engine planned the trip."""

import json

import httpx
import pytest
import respx

from planner.domain.geometry import Coordinate
from planner.integrations import osrm, valhalla
from planner.integrations.trips import TRUCK_MAX_MPH
from planner.integrations.valhalla import Waypoint
from planner.services import routing
from planner.tests.conftest import VALHALLA_ROUTE, encode_polyline, valhalla_trip

OSRM_ROUTE = "https://router.project-osrm.org/route/v1/driving/"


def test_valhalla_is_asked_for_the_truck_weight_and_top_speed() -> None:
    with respx.mock() as router:
        call = router.post(VALHALLA_ROUTE).mock(
            return_value=httpx.Response(200, json={"trip": valhalla_trip(32.0, "I 20", 2.0)})
        )
        valhalla.route(
            [Waypoint(Coordinate(32.0, -97.0)), Waypoint(Coordinate(32.0, -95.0))],
            gross_weight_lb=77_000,
        )

    truck = json.loads(call.calls.last.request.content)["costing_options"]["truck"]
    assert truck["weight"] == pytest.approx(34.93)  # metric tons
    # Valhalla's own default is 120 km/h (75 mph); whole km/h, 105 ≈ 65 mph.
    assert truck["top_speed"] == 105
    assert truck["top_speed"] / valhalla.KM_PER_MILE == pytest.approx(TRUCK_MAX_MPH, abs=0.5)


def test_osrm_segments_are_slowed_to_the_same_top_speed() -> None:
    # One 65-mile segment that the car profile drives in 45 minutes (87 mph).
    points = [(40.0, -100.0), (40.0, -98.77)]
    segment_m = 65 * osrm.METERS_PER_MILE
    payload = {
        "code": "Ok",
        "routes": [
            {
                "geometry": encode_polyline(points),
                "legs": [
                    {
                        "annotation": {"duration": [45 * 60], "distance": [segment_m]},
                        "steps": [{"distance": segment_m, "ref": "I 80", "name": ""}],
                    }
                ],
            }
        ],
    }
    with respx.mock() as router:
        router.get(url__startswith=OSRM_ROUTE).mock(return_value=httpx.Response(200, json=payload))
        trip = osrm.route([Coordinate(40.0, -100.0), Coordinate(40.0, -98.77)])[0]

    assert trip.time_s == pytest.approx(65 / TRUCK_MAX_MPH * 3600)


@pytest.mark.parametrize(
    ("straight_mi", "engine"),
    [(500, "Valhalla truck routing"), (900, "OSRM roads")],
)
def test_route_labels_state_the_speed_cap(straight_mi: float, engine: str) -> None:
    origin = Coordinate(40.0, -100.0)
    destination = Coordinate(40.0, -100.0 + straight_mi / 53.0)  # ~53 mi per degree here
    _, label = routing._choose_router(origin, destination, load_lb=40_000)
    assert label.startswith(engine)
    assert f"{TRUCK_MAX_MPH:.0f} mph" in label
