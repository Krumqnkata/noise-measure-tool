"""Обработка на звука: запис (или симулация), претегляне, нива и спектри."""

import math
import threading
import time

import numpy as np
from scipy import signal

try:
    import sounddevice as sd
except OSError:  # липсва PortAudio – остава само demo режимът
    sd = None

SAMPLE_RATE = 44100
BLOCK_SIZE = 1024
FFT_SIZE = 2048
OCTAVE_FFT_SIZE = 8192                  # по-голям FFT, за да има смисъл при ниските ленти
BUFFER_SIZE = OCTAVE_FFT_SIZE
CLIP_SIZE = 43_200                      # ~0.98 s – колкото иска разпознаването на звуци
HISTORY_SECONDS = 12                    # суров звук назад във времето (клипове, RT60)
WAVEFORM_SAMPLES = 1024
WAVEFORM_POINTS = 512
NUM_BANDS = 128
F_MIN, F_MAX = 20.0, 20000.0
DB_FLOOR = -120.0

WEIGHTINGS = ("A", "C", "Z")
TIME_CONSTANTS = {"F": 0.125, "S": 1.0}   # Fast и Slow по IEC 61672

# Номинални средни честоти на третинооктавните ленти (IEC 61260)
THIRD_OCTAVE_NOMINAL = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
    1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]


def weighting_sos(kind: str, fs: int) -> np.ndarray:
    """Цифров A- или C-претеглящ филтър (IEC 61672) като второпорядкови секции.

    Аналоговите филтри имат нули в 0 и полюси при 20.6 Hz (×2) и 12194 Hz (×2);
    A-кривата има още два полюса при 107.7 Hz и 737.9 Hz. Превръщаме ги в цифрови
    с билинейна трансформация и нормираме усилването да е точно 0 dB при 1 kHz.
    Заради изкривяването на честотите близо до Найкуист при 44.1 kHz A-филтърът
    е с ~1.5 dB по-нисък при 10 kHz и ~3.4 dB при 12.5 kHz – в границите на
    толерансите за клас 1 по IEC 61672. Под 4 kHz съвпада с аналоговия.
    """
    f1, f2, f3, f4 = 20.598997, 107.65265, 737.86223, 12194.217
    if kind == "A":
        zeros = [0.0] * 4
        pole_freqs = (f1, f1, f2, f3, f4, f4)
    elif kind == "C":
        zeros = [0.0] * 2
        pole_freqs = (f1, f1, f4, f4)
    else:
        raise ValueError(kind)
    poles = [-2 * math.pi * f for f in pole_freqs]
    z, p, k = signal.bilinear_zpk(zeros, poles, 1.0, fs)
    _, h = signal.freqz_zpk(z, p, k, worN=[1000.0], fs=fs)
    k /= abs(h[0])
    return signal.zpk2sos(z, p, k)


def power_db(mean_square: float) -> float:
    return max(10 * math.log10(max(mean_square, 1e-24)), DB_FLOOR)


class RingBuffer:
    """Кръгов буфер с фиксиран размер – записът не копира целия буфер всеки път."""

    def __init__(self, size: int):
        self._data = np.zeros(size, dtype=np.float32)
        self._pos = 0          # къде ще се запише следващият семпъл
        self.filled = 0        # колко семпъла има реално (до size)

    def write(self, block: np.ndarray) -> None:
        size = len(self._data)
        block = block[-size:]
        n = len(block)
        end = self._pos + n
        if end <= size:
            self._data[self._pos:end] = block
        else:
            first = size - self._pos
            self._data[self._pos:] = block[:first]
            self._data[:n - first] = block[first:]
        self._pos = end % size
        self.filled = min(size, self.filled + n)

    def last(self, n: int) -> np.ndarray:
        """Последните n семпъла в хронологичен ред (копие)."""
        n = min(n, len(self._data))
        start = (self._pos - n) % len(self._data)
        if start + n <= len(self._data):
            return self._data[start:start + n].copy()
        return np.concatenate((self._data[start:], self._data[:self._pos]))


class _SecondAccumulator:
    """Натрупва данни за една секунда – от тях става един ред в базата."""

    def __init__(self):
        self.n = 0
        self.sumsq = {w: 0.0 for w in WEIGHTINGS}
        self.laf_max = 0.0
        self.laf_min = math.inf
        self.z_peak = 0.0


class AudioEngine:
    """Събира звук в кръгов буфер, смята текущите нива и едносекундни обобщения."""

    def __init__(self, demo: bool, config: dict):
        self.demo = demo
        self.config = config
        self.running = False
        self.error: str | None = None

        self._lock = threading.Lock()
        self._sos = {"A": weighting_sos("A", SAMPLE_RATE), "C": weighting_sos("C", SAMPLE_RATE)}
        # Експоненциално усредняване на квадрата: y[n] = α·x²[n] + (1−α)·y[n−1]
        self._alpha = {t: 1 - math.exp(-1 / (tau * SAMPLE_RATE)) for t, tau in TIME_CONSTANTS.items()}
        self._stream = None
        self._demo_thread: threading.Thread | None = None
        self._demo_stop = threading.Event()
        self._reset_state()

        # FFT за спектъра (128 логаритмични ленти)
        self._window = np.hanning(FFT_SIZE)
        self._win_norm = 2.0 / self._window.sum()  # пълноскален синус → 0 dBFS
        self._freqs = np.fft.rfftfreq(FFT_SIZE, 1.0 / SAMPLE_RATE)
        edges = np.geomspace(F_MIN, F_MAX, NUM_BANDS + 1)
        self._band_centers = np.sqrt(edges[:-1] * edges[1:])
        self._band_ranges = []
        for lo, hi in zip(edges[:-1], edges[1:]):
            idx = np.nonzero((self._freqs >= lo) & (self._freqs < hi))[0]
            self._band_ranges.append((idx[0], idx[-1] + 1) if idx.size else None)
        # Ниските ленти са по-тесни от една FFT клетка (≈21.5 Hz) – за тях интерполираме
        self._empty_bands = np.array([r is None for r in self._band_ranges])

        # FFT за третинооктавните ленти. Мощността се нормира така, че сборът по
        # всички клетки да е средният квадрат на сигнала (теорема на Парсевал).
        self._oct_window = np.hanning(OCTAVE_FFT_SIZE)
        self._oct_norm = 2.0 / (OCTAVE_FFT_SIZE * np.sum(self._oct_window ** 2))
        df = SAMPLE_RATE / OCTAVE_FFT_SIZE
        n_bins = OCTAVE_FFT_SIZE // 2 + 1
        # Клетка k покрива [(k−½)·df, (k+½)·df]; кумулативната мощност в тези граници
        # позволява да „отрежем“ и части от клетка при лентите, по-тесни от нея.
        self._oct_cum_freqs = (np.arange(n_bins + 1) - 0.5) * df
        centers = 1000 * 10 ** ((np.arange(13, 44) - 30) / 10)
        self._oct_lo = centers * 10 ** -0.05
        self._oct_hi = np.minimum(centers * 10 ** 0.05, SAMPLE_RATE / 2)

    def _reset_state(self) -> None:
        with self._lock:
            self._raw = np.zeros(BUFFER_SIZE)
            self._history = RingBuffer(HISTORY_SECONDS * SAMPLE_RATE)
            self._zi = {w: np.zeros((sos.shape[0], 2)) for w, sos in self._sos.items()}
            self._ms = None          # текущ среден квадрат за всяка комбинация претегляне/време
            self._acc = _SecondAccumulator()
            self._seconds: list[dict] = []

    def _push(self, block: np.ndarray) -> None:
        channels = {"Z": block}
        for w, sos in self._sos.items():
            channels[w], self._zi[w] = signal.sosfilt(sos, block, zi=self._zi[w])

        acc = self._acc
        if self._ms is None:  # първи блок – стартираме от средното му, а не от нула
            self._ms = {w: {t: float(np.mean(x * x)) for t in TIME_CONSTANTS} for w, x in channels.items()}
        ms = {w: dict(v) for w, v in self._ms.items()}
        for w, x in channels.items():
            sq = x * x
            acc.sumsq[w] += float(sq.sum())
            for t, a in self._alpha.items():
                y, _ = signal.lfilter([a], [1.0, a - 1.0], sq, zi=[(1.0 - a) * ms[w][t]])
                ms[w][t] = float(y[-1])
                if w == "A" and t == "F":
                    acc.laf_max = max(acc.laf_max, float(y.max()))
                    acc.laf_min = min(acc.laf_min, float(y.min()))
        acc.z_peak = max(acc.z_peak, float(np.max(np.abs(block))))
        acc.n += len(block)

        with self._lock:
            self._raw = np.concatenate((self._raw[len(block):], block))
            self._history.write(block)
            self._ms = ms
            if acc.n >= SAMPLE_RATE:
                self._seconds.append(self._finish_second(acc))
                self._acc = _SecondAccumulator()

    def _finish_second(self, acc: _SecondAccumulator) -> dict:
        off = self.config["calibration_offset"]
        return {
            "t": time.time(),
            "laeq": power_db(acc.sumsq["A"] / acc.n) + off,
            "lafmax": power_db(acc.laf_max) + off,
            "lafmin": power_db(acc.laf_min) + off,
            "lceq": power_db(acc.sumsq["C"] / acc.n) + off,
            "lzeq": power_db(acc.sumsq["Z"] / acc.n) + off,
            "lzpeak": power_db(acc.z_peak ** 2) + off,
        }

    def _callback(self, indata, frames, time_info, status) -> None:
        self._push(indata[:, 0].astype(np.float64))

    # --- управление ---------------------------------------------------------

    def start(self) -> None:
        if self.running:
            return
        self._reset_state()
        try:
            if self.demo:
                self._demo_stop.clear()
                self._demo_thread = threading.Thread(target=self._demo_loop, daemon=True)
                self._demo_thread.start()
            else:
                if sd is None:
                    raise RuntimeError("sounddevice/PortAudio is not available")
                self._stream = sd.InputStream(
                    device=self.config["device"],
                    channels=1,
                    samplerate=SAMPLE_RATE,
                    blocksize=BLOCK_SIZE,
                    dtype="float32",
                    callback=self._callback,
                )
                self._stream.start()
        except Exception as exc:
            self._stream = None
            self.error = str(exc)
            raise
        self.running = True
        self.error = None

    def stop(self) -> None:
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        if self._demo_thread is not None:
            self._demo_stop.set()
            self._demo_thread.join()
            self._demo_thread = None
        self.running = False

    def clip(self) -> np.ndarray:
        """Последната ~1 секунда звук (за разпознаването на източника)."""
        return self.recent_audio(CLIP_SIZE / SAMPLE_RATE)

    def recent_audio(self, seconds: float) -> np.ndarray:
        """Суровият звук за последните `seconds` секунди (до HISTORY_SECONDS)."""
        with self._lock:
            return self._history.last(int(seconds * SAMPLE_RATE))

    def pop_seconds(self) -> list[dict]:
        """Връща и изчиства натрупаните едносекундни обобщения."""
        with self._lock:
            out, self._seconds = self._seconds, []
        return out

    def level(self, weighting: str = "A", time_weighting: str = "F") -> float:
        with self._lock:
            ms = self._ms
        if ms is None:
            return DB_FLOOR + self.config["calibration_offset"]
        return power_db(ms[weighting][time_weighting]) + self.config["calibration_offset"]

    # --- симулиран сигнал ---------------------------------------------------

    def _demo_loop(self) -> None:
        rng = np.random.default_rng()
        n = np.arange(1, BLOCK_SIZE + 1)
        pos = 0                   # номер на текущия семпъл
        phase = 0.0
        burst_left = 0            # оставащи блокове от внезапен силен шум
        block_time = BLOCK_SIZE / SAMPLE_RATE
        next_time = time.perf_counter()

        while not self._demo_stop.is_set():
            sec = pos / SAMPLE_RATE
            t = (pos + n) / SAMPLE_RATE

            # Тон, чиято честота бавно „плува“ между 220 и 880 Hz. Фазата се
            # натрупва, за да няма прекъсвания между блоковете.
            freq = 440.0 * 2 ** math.sin(2 * math.pi * sec / 20)
            phases = phase + 2 * math.pi * freq * n / SAMPLE_RATE
            phase = phases[-1] % (2 * math.pi)
            tone_amp = 0.5 + 0.5 * math.sin(2 * math.pi * sec / 13)
            tone = tone_amp * (np.sin(phases) + 0.3 * np.sin(2 * phases))

            hum = 0.3 * np.sin(2 * math.pi * 50 * t)           # мрежов брум
            whistle = 0.1 * np.sin(2 * math.pi * 3150 * t)     # постоянен висок тон
            noise_amp = 0.2 + (0.5 + 0.5 * math.sin(2 * math.pi * sec / 8)) ** 3
            noise = noise_amp * rng.standard_normal(BLOCK_SIZE)

            # Общото ниво бавно се мени между ≈ −80 и −40 dBFS (≈ 40–80 dB при
            # офсет 120), а редките „удари“ го вдигат с още ~22 dB.
            level_db = -60 + 15 * math.sin(2 * math.pi * sec / 40)
            if burst_left == 0 and rng.random() < 0.004:
                burst_left = int(rng.integers(5, 20))
            if burst_left:
                level_db += 22
                burst_left -= 1
            gain = 10 ** (level_db / 20)

            self._push(np.clip(gain * (tone + hum + whistle + noise), -1.0, 1.0))
            pos += BLOCK_SIZE

            # Темпо като на истинска звукова карта
            next_time += block_time
            delay = next_time - time.perf_counter()
            if delay > 0:
                self._demo_stop.wait(delay)
            else:
                next_time = time.perf_counter()

    # --- кадър за интерфейса ------------------------------------------------

    def compute_frame(self) -> dict:
        with self._lock:
            raw = self._raw.copy()
            ms = self._ms
        off = self.config["calibration_offset"]

        if ms is None:
            levels = {w: {t: DB_FLOOR + off for t in TIME_CONSTANTS} for w in WEIGHTINGS}
        else:
            levels = {w: {t: round(power_db(v) + off, 1) for t, v in ms[w].items()} for w in WEIGHTINGS}
        recent = raw[-int(TIME_CONSTANTS["F"] * SAMPLE_RATE):]
        peak_db = power_db(float(np.max(np.abs(recent))) ** 2) + off

        # Спектър: 128 логаритмични ленти
        mag = np.abs(np.fft.rfft(raw[-FFT_SIZE:] * self._window)) * self._win_norm
        mag_db = 20 * np.log10(np.maximum(mag, 1e-12))
        bands = np.empty(NUM_BANDS)
        for i, rng in enumerate(self._band_ranges):
            if rng is not None:
                bands[i] = mag_db[rng[0]:rng[1]].max()
        bands[self._empty_bands] = np.interp(
            self._band_centers[self._empty_bands], self._freqs, mag_db
        )
        bands = np.maximum(bands, DB_FLOOR)

        # Пикова честота: най-силната клетка + параболична интерполация между съседите
        lo = int(np.searchsorted(self._freqs, F_MIN))
        k = lo + int(np.argmax(mag_db[lo:]))
        delta = 0.0
        if 0 < k < len(mag_db) - 1:
            a, b, c = mag_db[k - 1], mag_db[k], mag_db[k + 1]
            denom = a - 2 * b + c
            if denom != 0:
                delta = 0.5 * (a - c) / denom
        peak_freq = (k + delta) * SAMPLE_RATE / FFT_SIZE

        # Третинооктавни ленти (непретеглени), в калибрирани dB
        power = np.abs(np.fft.rfft(raw * self._oct_window)) ** 2 * self._oct_norm
        cum = np.concatenate(([0.0], np.cumsum(power)))
        band_power = (np.interp(self._oct_hi, self._oct_cum_freqs, cum)
                      - np.interp(self._oct_lo, self._oct_cum_freqs, cum))
        octaves = 10 * np.log10(np.maximum(band_power, 1e-24))
        octaves = np.maximum(octaves, DB_FLOOR) + off

        step = WAVEFORM_SAMPLES // WAVEFORM_POINTS
        waveform = raw[-WAVEFORM_SAMPLES:][::step]

        return {
            "type": "data",
            "db": levels["Z"]["F"],
            "dba": levels["A"]["F"],
            "dbc": levels["C"]["F"],
            "levels": levels,
            "peak_db": round(peak_db, 1),
            "peak_freq": round(peak_freq, 1),
            "waveform": np.round(waveform, 4).tolist(),
            "spectrum": np.round(bands, 1).tolist(),
            "octaves": np.round(octaves, 1).tolist(),
        }
