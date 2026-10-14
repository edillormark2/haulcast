"""Request validation. Responses are shaped in `presenters`."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from django.utils import timezone
from rest_framework import serializers

from planner.domain.geometry import Coordinate, haversine_mi

CHECKPOINT_INTERVALS_MI = (10, 25, 50)
MAX_LOAD_LB = 80_000
DEPARTURE_GRACE = timedelta(hours=1)
DEPARTURE_HORIZON = timedelta(days=7)
"""Forecast skill drops off after a week, and the 48-hour heatmap must fit
inside the 16-day forecast."""
MIN_TRIP_MI = 1.0


class PlaceSerializer(serializers.Serializer[dict[str, Any]]):
    # `label` shadows Field.label in the type stubs only; DRF collects it as a field.
    label = serializers.CharField(max_length=200)  # type: ignore[assignment]
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)


class TripRequestSerializer(serializers.Serializer[dict[str, Any]]):
    origin = PlaceSerializer()
    destination = PlaceSerializer()
    departure = serializers.DateTimeField()
    load_lb = serializers.IntegerField(min_value=0, max_value=MAX_LOAD_LB)
    interval_mi = serializers.ChoiceField(choices=CHECKPOINT_INTERVALS_MI, default=25)

    def validate_departure(self, value: datetime) -> datetime:
        now = timezone.now()
        if value < now - DEPARTURE_GRACE:
            raise serializers.ValidationError("Departure can't be in the past.")
        if value > now + DEPARTURE_HORIZON:
            raise serializers.ValidationError("Departure must be within the next 7 days.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        origin, destination = attrs["origin"], attrs["destination"]
        distance = haversine_mi(
            Coordinate(origin["lat"], origin["lon"]),
            Coordinate(destination["lat"], destination["lon"]),
        )
        if distance < MIN_TRIP_MI:
            raise serializers.ValidationError(
                {"destination": "Destination must be at least a mile from the origin."}
            )
        return attrs


class HeatmapRequestSerializer(serializers.Serializer[dict[str, Any]]):
    corridor = serializers.ListField(
        child=serializers.ListField(
            child=serializers.ListField(child=serializers.FloatField(), min_length=2, max_length=2),
            min_length=2,
            max_length=2_000,
        ),
        min_length=1,
        max_length=3,
    )
    departure = serializers.DateTimeField()
    load_lb = serializers.IntegerField(min_value=0, max_value=MAX_LOAD_LB)

    def validate_departure(self, value: datetime) -> datetime:
        return TripRequestSerializer().validate_departure(value)
