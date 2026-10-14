from __future__ import annotations

from typing import Any

from django.utils.cache import patch_cache_control
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from planner.api.presenters import present_heatmap, present_plan, present_rules
from planner.api.serializers import HeatmapRequestSerializer, TripRequestSerializer
from planner.domain.geometry import Coordinate
from planner.services.geocoding import search_places
from planner.services.heatmap import build_heatmap
from planner.services.trip_planner import NamedPlace, TripRequest, plan_trip

MIN_QUERY_LENGTH, MAX_QUERY_LENGTH = 2, 120


class HealthView(APIView):
    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})


class RiskRulesView(APIView):
    """The thresholds and load rules, so the UI's legends never drift from the
    rules the server applies."""

    def get(self, request: Request) -> Response:
        response = Response(present_rules())
        patch_cache_control(response, public=True, max_age=24 * 60 * 60)
        return response


class GeocodeView(APIView):
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "geocode"

    def get(self, request: Request) -> Response:
        query = request.query_params.get("q", "").strip()[:MAX_QUERY_LENGTH]
        if len(query) < MIN_QUERY_LENGTH:
            return Response({"results": []})
        places = search_places(query)
        return Response(
            {
                "results": [
                    {
                        "label": place.label,
                        "name": place.name,
                        "detail": place.detail,
                        "lat": place.lat,
                        "lon": place.lon,
                        "kind": place.kind,
                    }
                    for place in places
                ]
            }
        )


class PlanView(APIView):
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "plan"

    def post(self, request: Request) -> Response:
        serializer = TripRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        plan = plan_trip(
            TripRequest(
                origin=_named_place(data["origin"]),
                destination=_named_place(data["destination"]),
                departure=data["departure"],
                load_lb=data["load_lb"],
                interval_mi=data["interval_mi"],
            )
        )
        return Response(present_plan(plan))


class HeatmapView(APIView):
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "heatmap"

    def post(self, request: Request) -> Response:
        serializer = HeatmapRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        lines = [[Coordinate(lat, lon) for lon, lat in line] for line in data["corridor"]]
        heatmap = build_heatmap(lines, data["departure"], data["load_lb"])
        return Response(present_heatmap(heatmap))


def _named_place(data: dict[str, Any]) -> NamedPlace:
    return NamedPlace(label=data["label"], coordinate=Coordinate(data["lat"], data["lon"]))
