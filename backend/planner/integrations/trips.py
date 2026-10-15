"""The router-independent result of a routing request."""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from planner.domain.geometry import Coordinate, simplify_indices

_HIGHWAY_REF = re.compile(r"^(I|US|[A-Z]{2})[- ]?(\d+[A-Z]?)\b")
TRUCK_MAX_MPH = 65.0
"""The fastest a loaded truck is planned to drive, on either router, so ETAs
don't depend on which engine planned the trip."""
SHAPE_TOLERANCE_MI = 0.003
"""About 5 m. Router shapes are far denser than that; thinning them speeds up
everything downstream without moving the line."""


@dataclass(frozen=True, slots=True)
class Trip:
    shape: list[Coordinate] = field(repr=False)
    timing: list[tuple[int, float]] = field(repr=False)
    """(shape index, seconds since departure) breakpoints, increasing."""
    road_miles: dict[str, float]
    """Miles driven on each numbered highway, e.g. {"I-80": 812.4}."""
    time_s: float
    u_turns: int = 0


def make_trip(
    shape: Sequence[Coordinate],
    timing: Sequence[tuple[int, float]],
    road_miles: dict[str, float],
    time_s: float,
    u_turns: int = 0,
) -> Trip:
    """A Trip with its shape thinned to SHAPE_TOLERANCE_MI. Points that timing
    breakpoints refer to are always kept, so no breakpoint moves."""
    kept = sorted(set(simplify_indices(shape, SHAPE_TOLERANCE_MI)) | {index for index, _ in timing})
    position = {index: i for i, index in enumerate(kept)}
    return Trip(
        shape=[shape[i] for i in kept],
        timing=[(position[index], seconds) for index, seconds in timing],
        road_miles=road_miles,
        time_s=time_s,
        u_turns=u_turns,
    )


def highway_ref(name: str) -> str | None:
    """Normalise a road name or ref ("I 80 West", "US 6") to "I-80" / "US-6"."""
    match = _HIGHWAY_REF.match(name.strip())
    return f"{match[1]}-{match[2]}" if match else None


def tally_highways(segments: Iterable[tuple[Iterable[str], float]]) -> dict[str, float]:
    """Sum miles per highway from (names on a stretch, miles) pairs, crediting
    each stretch to its first numbered highway."""
    totals: dict[str, float] = {}
    for names, miles in segments:
        ref = next((r for r in map(highway_ref, names) if r), None)
        if ref:
            totals[ref] = totals.get(ref, 0.0) + miles
    return totals
