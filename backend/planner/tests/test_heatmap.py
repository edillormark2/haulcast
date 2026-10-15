"""The heatmap's bytes keep every reading in the band its checkpoint gets, so a
cell centre never shows a different risk level than a checkpoint reading the
same forecast."""

import pytest

from planner.domain.risk import Conditions, Factor, assess, scales_for_load
from planner.services import heatmap

LOADS = (0, 30_000, 30_001, 40_000, 40_001, 42_000, 80_000)


def reading(factor: Factor, value: float) -> Conditions:
    values = {"wind_mph": 0.0, "gust_mph": 0.0, "rain_in_hr": 0.0, "snow_in_hr": 0.0}
    field = {Factor.WIND: "wind_mph", Factor.RAIN: "rain_in_hr", Factor.SNOW: "snow_in_hr"}
    return Conditions.measured(**(values | {field[factor]: value}))


def decoded(factor: Factor, value: float) -> float:
    """`value` packed into its byte, then read back the way the browser does."""
    return heatmap._quantize(value, factor) * heatmap.STEP[factor]


@pytest.mark.parametrize("load", LOADS)
def test_wind_bytes_keep_the_checkpoint_band_at_every_tenth_of_a_mph(load: float) -> None:
    scale = scales_for_load(load)[Factor.WIND]
    for tenths in range(0, 901):
        wind = tenths / 10
        expected = assess(reading(Factor.WIND, wind), load_lb=load).factor_levels[Factor.WIND]
        assert scale.classify(decoded(Factor.WIND, wind)) is expected, (wind, load)


@pytest.mark.parametrize(
    # Past the bytes' top (2.55 in/hr of rain, 5.10 of snow) too.
    ("factor", "top_in_hr"),
    [(Factor.RAIN, 3.0), (Factor.SNOW, 6.0)],
)
def test_precipitation_bytes_keep_the_checkpoint_band_at_every_hundredth(
    factor: Factor, top_in_hr: float
) -> None:
    for load in LOADS:
        scale = scales_for_load(load)[factor]
        for hundredths in range(0, round(top_in_hr * 100) + 1):
            value = hundredths / 100
            expected = assess(reading(factor, value), load_lb=load).factor_levels[factor]
            assert scale.classify(decoded(factor, value)) is expected, (value, load)


@pytest.mark.parametrize(
    ("factor", "value", "byte"),
    [
        # Just below a band: the nearest step would be the band's first byte.
        (Factor.WIND, 34.8, 69),
        (Factor.WIND, 44.8, 89),
        (Factor.WIND, 54.8, 109),
        (Factor.SNOW, 0.99, 49),
        # On a step, where dividing by it lands a hair below the whole byte.
        (Factor.RAIN, 0.29, 29),
        (Factor.SNOW, 0.06, 3),
        # An exclusive No Travel limit is Severe on its own byte; anything past
        # it, even by a thousandth, never lands back on it.
        (Factor.SNOW, 3.0, 150),
        (Factor.SNOW, 3.01, 151),
        (Factor.SNOW, 3.004, 151),
        (Factor.RAIN, 1.0, 100),
        (Factor.RAIN, 1.01, 101),
        (Factor.RAIN, 1.003, 101),
        # Past the byte's top, 127.5 mph.
        (Factor.WIND, 130.0, 255),
    ],
)
def test_bytes_round_toward_the_inside_of_the_band(factor: Factor, value: float, byte: int) -> None:
    assert heatmap._quantize(value, factor) == byte
