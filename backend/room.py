"""Време на реверберация RT60 по ISO 3382-2 (инженерен метод, импулсен източник).

Плясък или спукан балон дава кратък импулс; звукът в стаята после затихва
експоненциално. За всяка октава: филтър → енергия → обратно интегриране на
Шрьодер (кривата на затихване EDC) → права по най-малки квадрати между −5 и
−25 dB (T20) и между −5 и −35 dB (T30), продължена до −60 dB.
"""

import numpy as np
from scipy import signal

RT_BANDS = [125, 250, 500, 1000, 2000, 4000]
DECAY_SECONDS = 2.5          # колко след импулса се анализира
SMOOTHING = 0.01             # s – плъзгащо средно за откриване на шумовия под
CURVE_POINTS = 250           # точки от кривата на затихване за графиката


def _octave_sos(center: float, fs: int):
    # Октавна лента: 4-ти ред Бътъруърт (8-ми ред лентов филтър)
    return signal.butter(4, [center / 2 ** 0.5, center * 2 ** 0.5], btype="bandpass", fs=fs, output="sos")


def _fit_decay(edc_db: np.ndarray, fs: int, top: float, bottom: float, available_db: float) -> float | None:
    """Време за затихване с 60 dB от наклона на правата между top и bottom dB.
    Нужни са поне 10 dB динамичен обхват под долната граница (ISO 3382-2)."""
    if available_db < -bottom + 10:
        return None
    idx = np.nonzero((edc_db <= top) & (edc_db >= bottom))[0]
    if len(idx) < 10:
        return None
    t = idx / fs
    slope, _ = np.polyfit(t, edc_db[idx], 1)
    return float(-60 / slope) if slope < 0 else None


def analyze_band(x: np.ndarray, onset: int, fs: int, center: float) -> dict:
    y = signal.sosfilt(_octave_sos(center, fs), x)
    energy = y ** 2
    pre = energy[:max(onset - int(0.05 * fs), 1)]
    noise = float(np.mean(pre[-fs:])) if len(pre) else 0.0
    decay = energy[onset:onset + int(DECAY_SECONDS * fs)]

    # Интегрираме само докато затихването е над шума (иначе шумът „удължава“ опашката)
    win = max(1, int(SMOOTHING * fs))
    smooth = np.convolve(decay, np.ones(win) / win, mode="same")
    start = int(np.argmax(smooth))
    above = np.nonzero(smooth[start:] <= noise * 10 ** 0.5)[0]   # 5 dB над шума
    end = start + int(above[0]) if len(above) else len(decay)
    useful = np.maximum(decay[start:end] - noise, 0)
    if len(useful) < 10 or useful.sum() <= 0:
        return {"band": center, "range_db": 0.0, "t20": None, "t30": None, "curve": []}

    # Динамичен обхват: от върха на импулса до шумовия под в тази лента
    available_db = 10 * np.log10(smooth[start] / noise) if noise > 0 else np.inf
    edc = np.cumsum(useful[::-1])[::-1]
    edc_db = 10 * np.log10(np.maximum(edc / edc[0], 1e-12))
    step = max(1, len(edc_db) // CURVE_POINTS)
    return {
        "band": center,
        "range_db": round(float(min(available_db, 99)), 1),
        "t20": _fit_decay(edc_db, fs, -5, -25, available_db),
        "t30": _fit_decay(edc_db, fs, -5, -35, available_db),
        "curve": [[round(i / fs, 4), round(float(edc_db[i]), 1)] for i in range(0, len(edc_db), step)],
    }


def find_onset(x: np.ndarray, fs: int, jump_db: float = 20.0) -> int | None:
    """Началото на импулса: първото място, където нивото (10 ms) скача с jump_db над фона."""
    win = int(0.01 * fs)
    power = np.convolve(x ** 2, np.ones(win) / win, mode="same")
    background = np.median(power[: len(power) // 4]) + 1e-20
    hits = np.nonzero(power > background * 10 ** (jump_db / 10))[0]
    if not len(hits):
        return None
    first = int(hits[0])
    # Връх на импулса в следващите 50 ms
    return first + int(np.argmax(np.abs(x[first:first + int(0.05 * fs)])))


def measure_rt60(x: np.ndarray, fs: int) -> dict | None:
    onset = find_onset(x, fs)
    if onset is None or onset + int(0.5 * fs) > len(x):
        return None
    bands = [analyze_band(x, onset, fs, f) for f in RT_BANDS]
    by_band = {b["band"]: b for b in bands}
    # Обобщено RT60: средното на T20 при 500 Hz и 1 kHz (най-често използваното)
    mids = [by_band[f]["t20"] for f in (500, 1000) if by_band[f]["t20"] is not None]
    return {"bands": bands, "rt60": float(np.mean(mids)) if mids else None}


def synthetic_clap(t60: float, fs: int, seconds: float = DECAY_SECONDS, amplitude: float = 0.5,
                   rng: np.random.Generator | None = None) -> np.ndarray:
    """Шум с експоненциално затихване – 60 dB за t60 секунди. За демо режима и тестовете."""
    rng = rng or np.random.default_rng()
    t = np.arange(int(seconds * fs)) / fs
    return amplitude * rng.standard_normal(len(t)) * np.exp(-6.9078 * t / t60)
