import sys
from pathlib import Path

import numpy as np
import pytest

# Модулите в backend/ се импортират като в main.py: `from audio import ...`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from audio import BLOCK_SIZE, SAMPLE_RATE  # noqa: E402


def sine(freq: float, seconds: float, amplitude: float = 0.5) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return amplitude * np.sin(2 * np.pi * freq * t)


def feed(engine, x: np.ndarray) -> None:
    """Подава сигнала на AudioEngine на блокове, както звуковата карта."""
    for i in range(0, len(x), BLOCK_SIZE):
        engine._push(x[i:i + BLOCK_SIZE])


@pytest.fixture
def engine():
    from audio import AudioEngine
    return AudioEngine(demo=False, config={"calibration_offset": 0.0, "device": None})
