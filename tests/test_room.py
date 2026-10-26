import numpy as np
import pytest

from audio import SAMPLE_RATE
from room import measure_rt60, synthetic_clap


def recording_with_clap(t60: float, noise_db: float = -70.0, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    noise = 10 ** (noise_db / 20)
    before = noise * rng.standard_normal(SAMPLE_RATE)
    clap = synthetic_clap(t60, SAMPLE_RATE, seconds=2.5, rng=rng)
    clap += noise * rng.standard_normal(len(clap))
    return np.concatenate((before, clap))


@pytest.mark.parametrize("t60", [0.3, 0.6, 1.2])
def test_rt60_single_take(t60):
    # Едно измерване на случаен шум варира с няколко процента – затова ISO 3382 осреднява
    result = measure_rt60(recording_with_clap(t60), SAMPLE_RATE)
    assert result["rt60"] == pytest.approx(t60, rel=0.1)
    for band in result["bands"]:
        assert band["t20"] == pytest.approx(t60, rel=0.25)
        assert band["t30"] == pytest.approx(t60, rel=0.12)


@pytest.mark.parametrize("t60", [0.4, 1.0])
def test_rt60_has_no_bias_on_average(t60):
    takes = [measure_rt60(recording_with_clap(t60, seed=s), SAMPLE_RATE) for s in range(8)]
    t30 = [b["t30"] for r in takes for b in r["bands"] if b["band"] in (500, 1000)]
    assert np.mean(t30) == pytest.approx(t60, rel=0.03)


def test_no_clap_returns_none():
    rng = np.random.default_rng(2)
    assert measure_rt60(0.001 * rng.standard_normal(3 * SAMPLE_RATE), SAMPLE_RATE) is None


def test_dynamic_range_limits_what_can_be_measured():
    # Шум ~40 dB под импулса: T20 (нужни 35 dB) се мери, T30 (нужни 45 dB) – не
    result = measure_rt60(recording_with_clap(0.6, noise_db=-46), SAMPLE_RATE)
    for band in result["bands"]:
        assert 35 <= band["range_db"] < 45
        assert band["t20"] is not None and band["t30"] is None
