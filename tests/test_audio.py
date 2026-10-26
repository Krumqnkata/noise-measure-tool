import numpy as np
import pytest
from scipy import signal

from audio import SAMPLE_RATE, THIRD_OCTAVE_NOMINAL, RingBuffer, weighting_sos
from conftest import feed, sine


def response_db(kind: str, freqs: list[float]) -> np.ndarray:
    _, h = signal.sosfreqz(weighting_sos(kind, SAMPLE_RATE), worN=freqs, fs=SAMPLE_RATE)
    return 20 * np.log10(np.abs(h))


# Номинални стойности от IEC 61672-1, таблица 3, и допустимото отклонение за клас 1.
# Над 4 kHz билинейната трансформация реже малко повече – още в толеранса.
@pytest.mark.parametrize("freq, expected, tol", [
    (31.5, -39.4, 0.5), (63, -26.2, 0.3), (125, -16.1, 0.3), (250, -8.6, 0.2),
    (500, -3.2, 0.2), (1000, 0.0, 0.01), (2000, 1.2, 0.2), (4000, 1.0, 0.3), (8000, -1.1, 3.0),
])
def test_a_weighting_matches_iec_61672(freq, expected, tol):
    assert response_db("A", [freq])[0] == pytest.approx(expected, abs=tol)


@pytest.mark.parametrize("freq, expected, tol", [
    (31.5, -3.0, 0.2), (63, -0.8, 0.2), (1000, 0.0, 0.01), (4000, -0.8, 0.3), (8000, -3.0, 1.5),
])
def test_c_weighting_matches_iec_61672(freq, expected, tol):
    assert response_db("C", [freq])[0] == pytest.approx(expected, abs=tol)


def test_levels_of_full_scale_sine(engine):
    # Синус с амплитуда 0.5: RMS = 0.5/√2 → −9.03 dBFS във всички претегляния при 1 kHz
    feed(engine, sine(1000, 3))
    levels = engine.compute_frame()["levels"]
    for weighting in "ACZ":
        for time_weighting in "FS":
            assert levels[weighting][time_weighting] == pytest.approx(-9.0, abs=0.1)


def test_third_octave_band_holds_the_tone_energy(engine):
    feed(engine, sine(1000, 1))
    octaves = engine.compute_frame()["octaves"]
    i = THIRD_OCTAVE_NOMINAL.index(1000)
    assert octaves[i] == pytest.approx(-9.0, abs=0.2)
    assert max(octaves[i - 1], octaves[i + 1]) < -60


def test_second_records_use_calibration_offset():
    from audio import AudioEngine
    eng = AudioEngine(demo=False, config={"calibration_offset": 100.0, "device": None})
    feed(eng, sine(1000, 2.2))
    rows = eng.pop_seconds()
    assert len(rows) == 2
    assert rows[-1]["laeq"] == pytest.approx(91.0, abs=0.1)
    assert rows[-1]["lzpeak"] == pytest.approx(94.0, abs=0.1)


def test_ring_buffer_keeps_last_samples_in_order():
    rb = RingBuffer(10)
    rb.write(np.arange(7, dtype=np.float32))
    rb.write(np.arange(7, 15, dtype=np.float32))
    assert rb.last(10).tolist() == list(range(5, 15))
    assert rb.last(3).tolist() == [12, 13, 14]
    rb.write(np.arange(100, 130, dtype=np.float32))   # блок, по-голям от буфера
    assert rb.last(10).tolist() == list(range(120, 130))


def test_recent_audio_returns_requested_length(engine):
    feed(engine, sine(440, 2))
    assert len(engine.recent_audio(1.5)) == int(1.5 * SAMPLE_RATE)
