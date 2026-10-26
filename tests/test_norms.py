import math

import numpy as np
import pytest

from norms import (NC_BANDS, NC_CURVES, NR_BANDS, NR_CURVES, env_limits, env_period, lden, lex_8h,
                   nc_rating, nr_rating, thirds_to_octaves, workplace_level)


def test_lex_8h():
    assert lex_8h(85, 8 * 3600) == pytest.approx(85)
    assert lex_8h(91, 2 * 3600) == pytest.approx(91 + 10 * math.log10(0.25))   # ≈ 85


def test_workplace_level_uses_lex_or_peak():
    assert workplace_level(79, 120) is None
    assert workplace_level(81, 120) == "lower"
    assert workplace_level(79, 138) == "upper"      # пикът стига горната стойност
    assert workplace_level(88, 100) == "limit"


def test_lden_of_equal_levels():
    # Еднакво ниво L във всички периоди: Lden = L + 10·lg((12 + 4·10^0.5 + 8·10^1) / 24) ≈ L + 6.4
    assert lden(50, 50, 50) == pytest.approx(50 + 10 * math.log10((12 + 4 * 10 ** 0.5 + 80) / 24))
    assert lden(50, None, 40) is None


@pytest.mark.parametrize("hour, period", [(6, "night"), (7, "day"), (18, "day"), (19, "evening"),
                                          (22, "evening"), (23, "night"), (0, "night")])
def test_env_periods_follow_ordinance(hour, period):
    assert env_period(hour) == period


def test_env_limits_with_tonal_penalty():
    assert env_limits("zone", "residential") == {"day": 55, "evening": 50, "night": 45}
    assert env_limits("room", "living", tonal=True) == {"day": 30, "evening": 30, "night": 25}
    assert env_limits("room", "shop", tonal=True) == {"day": 60, "evening": 60, "night": 60}


@pytest.mark.parametrize("nr", [20, 30, 40, 50, 60])
def test_spectrum_on_a_curve_gets_that_rating(nr):
    assert nr_rating(NR_CURVES[nr]) == nr


@pytest.mark.parametrize("nc", [20, 35, 50])
def test_nc_rating_of_curve(nc):
    assert nc_rating(NC_CURVES[nc]) == nc


def test_rating_is_set_by_the_worst_band():
    levels = list(NR_CURVES[30])
    levels[NR_BANDS.index(1000)] = 45          # една лента стига NR 45
    assert nr_rating(levels) == 45
    assert len(NC_BANDS) == 8


def test_thirds_to_octaves_sums_energy():
    from audio import THIRD_OCTAVE_NOMINAL
    thirds = np.full(len(THIRD_OCTAVE_NOMINAL), 40.0)
    assert thirds_to_octaves(thirds, [1000])[0] == pytest.approx(40 + 10 * math.log10(3))
