"""Разпознаване на източника на шума с YAMNet (Google; AudioSet, 521 класа; Apache 2.0).

Моделът (~4 MB) се сваля при първото стартиране в models/. Нужна е библиотеката
ai-edge-litert (официалният TFLite runtime на Google):

    pip install -r requirements-ml.txt

Без нея приложението работи както преди, само без този раздел.
"""

import shutil
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from scipy import signal

from audio import SAMPLE_RATE

try:
    from ai_edge_litert.interpreter import Interpreter
except ImportError:
    Interpreter = None

MODEL_URL = ("https://storage.googleapis.com/download.tensorflow.org/models/tflite/"
             "task_library/audio_classification/android/lite-model_yamnet_classification_tflite_1.tflite")
MODEL_RATE = 16_000
MODEL_SAMPLES = 15_600     # 0.975 s – прозорецът на YAMNet
INTERVAL = 1.0             # колко често разпознаваме
SMOOTHING = 0.5            # тежест на новия резултат в плъзгащото се средно
MIN_SCORE = 0.15           # под това категорията е „неясна“


def _r(a: int, b: int) -> list[int]:
    return list(range(a, b + 1))


# Групи от класове на AudioSet по индексите им в списъка на YAMNet
CATEGORIES = {
    "people": _r(0, 23) + _r(33, 45) + _r(61, 66),
    "music": _r(24, 32) + _r(132, 276),
    "dog": _r(68, 75) + [117],
    "animals": [67] + _r(76, 116) + _r(118, 131),
    "traffic": _r(294, 303) + _r(305, 315) + _r(320, 338) + _r(342, 347),
    "construction": _r(339, 341) + _r(412, 419),
    "alarm": [304] + _r(316, 319) + [382] + _r(389, 395),
    "nature": _r(277, 293),
    "household": _r(348, 381) + _r(383, 388) + _r(398, 411),
    "bang": _r(420, 430) + [454, 455] + _r(460, 464),
    "noise": [482, 487, 490] + _r(507, 517),
    "silence": [494],
}


class SoundClassifier:
    """Веднъж в секунда взима последната секунда звук от AudioEngine и я класифицира."""

    def __init__(self, engine, model_path: Path, enabled: bool = True):
        self.engine = engine
        self.model_path = model_path
        self.error: str | None = None
        self.state = "starting"
        if not enabled:
            self.state = "disabled"
        elif Interpreter is None:
            self.state = "missing_runtime"
        self._labels: list[str] = []
        self._smoothed: np.ndarray | None = None
        self._results: list[dict] = []
        self._lock = threading.Lock()
        self._stop = threading.Event()

    def status(self) -> dict:
        return {"state": self.state, "error": self.error}

    def start(self) -> None:
        if self.state == "starting":
            threading.Thread(target=self._run, daemon=True).start()

    def stop(self) -> None:
        self._stop.set()

    def pop_results(self) -> list[dict]:
        with self._lock:
            out, self._results = self._results, []
        return out

    def _ensure_model(self) -> None:
        if self.model_path.exists():
            return
        self.state = "downloading"
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        part = self.model_path.with_suffix(".part")
        with urllib.request.urlopen(MODEL_URL, timeout=60) as response, open(part, "wb") as f:
            shutil.copyfileobj(response, f)
        part.replace(self.model_path)

    def _load(self) -> None:
        # Имената на класовете са вградени в .tflite файла като zip архив
        with zipfile.ZipFile(self.model_path) as z:
            self._labels = z.read("yamnet_label_list.txt").decode().splitlines()
        self._interp = Interpreter(model_path=str(self.model_path))
        self._interp.allocate_tensors()
        self._input = self._interp.get_input_details()[0]["index"]
        self._output = self._interp.get_output_details()[0]["index"]

    def _run(self) -> None:
        try:
            self._ensure_model()
            self._load()
        except Exception as exc:
            self.state = "error"
            self.error = str(exc)
            return
        self.state = "ready"
        next_time = time.monotonic()
        while not self._stop.is_set():
            if self.engine.running:
                try:
                    result = self._classify(self.engine.clip())
                    with self._lock:
                        self._results.append(result)
                    self.error = None
                except Exception as exc:
                    self.error = str(exc)
            else:
                self._smoothed = None
            next_time = max(next_time + INTERVAL, time.monotonic())
            self._stop.wait(next_time - time.monotonic())

    def _classify(self, clip: np.ndarray) -> dict:
        # 44.1 kHz → 16 kHz (160/441) и последните 0.975 s
        x = signal.resample_poly(clip, MODEL_RATE // 100, SAMPLE_RATE // 100)[-MODEL_SAMPLES:]
        self._interp.set_tensor(self._input, x.astype(np.float32))
        self._interp.invoke()
        scores = self._interp.get_tensor(self._output).reshape(-1)

        # Плъзгащо се средно, за да не прескача от категория в категория всяка секунда
        self._smoothed = scores if self._smoothed is None else SMOOTHING * scores + (1 - SMOOTHING) * self._smoothed
        s = self._smoothed
        by_category = sorted(((name, float(s[idx].max())) for name, idx in CATEGORIES.items()),
                             key=lambda item: item[1], reverse=True)
        best, best_score = by_category[0]
        top = np.argsort(s)[::-1][:3]
        return {
            "t": time.time(),
            "category": best if best_score >= MIN_SCORE else "unknown",
            "score": round(best_score, 3),
            "categories": [{"id": c, "score": round(v, 3)} for c, v in by_category[:6]],
            "labels": [{"name": self._labels[i], "score": round(float(s[i]), 3)} for i in top],
        }
