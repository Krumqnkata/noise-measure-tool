import numpy as np

from audio import SAMPLE_RATE
from panns import FRAMES, HOP, N_FFT, N_MELS, log_mel, model_input


def reference_log_mel(wav, mel_basis):
    """Поредната рамка по рамка, както в скрипта за конвертиране на модела (build_panns.py)."""
    padded = np.pad(wav, (N_FFT // 2, N_FFT // 2), mode="reflect")
    n = 1 + (len(padded) - N_FFT) // HOP
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)
    power = np.empty((n, N_FFT // 2 + 1))
    for t in range(n):
        s = np.fft.rfft(padded[t * HOP: t * HOP + N_FFT] * win, n=N_FFT)
        power[t] = s.real ** 2 + s.imag ** 2
    return 10 * np.log10(np.maximum(power @ mel_basis.T, 1e-10))


def test_log_mel_matches_reference():
    rng = np.random.default_rng(0)
    wav = rng.uniform(-0.5, 0.5, 32_000).astype(np.float32)
    mel_basis = rng.uniform(0, 1, (N_MELS, N_FFT // 2 + 1)).astype(np.float32)
    ours = log_mel(wav, mel_basis)
    ref = reference_log_mel(wav, mel_basis)
    assert ours.shape == ref.shape == (101, N_MELS)
    assert np.allclose(ours, ref, atol=1e-3)


def test_model_input_is_ten_seconds_of_repeated_audio():
    mel_basis = np.ones((N_MELS, N_FFT // 2 + 1), np.float32)
    t = np.arange(int(2.5 * SAMPLE_RATE)) / SAMPLE_RATE
    x = model_input(0.1 * np.sin(2 * np.pi * 400 * t), mel_basis)
    assert x.shape == (1, 1, FRAMES, N_MELS)
    assert x.dtype == np.float32
    # постоянен тон, повторен: всички рамки (без краищата) са почти еднакви
    frames = x[0, 0, 5:-5, 0]
    assert frames.max() - frames.min() < 1.0


def test_model_input_handles_empty_audio():
    x = model_input(np.zeros(0), np.ones((N_MELS, N_FFT // 2 + 1), np.float32))
    assert x.shape == (1, 1, FRAMES, N_MELS)
