"""Разпознаване на източника на шума с YAMNet (Google; AudioSet, 521 класа; Apache 2.0).

Основният модел (~16 MB, от Kaggle) дава освен оценките и „вградено представяне“
(embedding, 1024 числа) – то се ползва за собствените звуци и за откриване на аномалии.
Ако не може да се свали, се ползва по-малкият модел (~4 MB) само с оценките.
Моделът се сваля при първото стартиране в models/. Нужна е библиотеката
ai-edge-litert (официалният TFLite runtime на Google):

    pip install -r requirements-ml.txt

Без нея приложението работи както преди, само без тази част.

По избор оценките идват от по-точния PANNs CNN14 (виж panns.py); YAMNet остава за embeddings.
"""

import io
import shutil
import tarfile
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np
from scipy import signal

from audio import SAMPLE_RATE
from panns import PannsScorer

try:
    from ai_edge_litert.interpreter import Interpreter
except ImportError:
    Interpreter = None

LABELS_PATH = Path(__file__).with_name("yamnet_labels.txt")
MODELS = [
    # Пълният модел: изходи оценки (521), embeddings (1024) и спектрограма
    {"file": "yamnet-full.tflite", "archive_member": "1.tflite",
     "url": "https://www.kaggle.com/api/v1/models/google/yamnet/tfLite/tflite/1/download"},
    # Резерва: само оценките, квантизиран
    {"file": "yamnet.tflite", "archive_member": None,
     "url": "https://storage.googleapis.com/download.tensorflow.org/models/tflite/"
            "task_library/audio_classification/android/lite-model_yamnet_classification_tflite_1.tflite"},
]
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


def to_model_rate(audio: np.ndarray) -> np.ndarray:
    """44.1 kHz → 16 kHz (160/441)."""
    return signal.resample_poly(audio, MODEL_RATE // 100, SAMPLE_RATE // 100).astype(np.float32)


class SoundClassifier:
    """Веднъж в секунда взима последната секунда звук от AudioEngine и я класифицира.
    Слушателите (собствени звуци, аномалии) получават embedding-а на всяко разпознаване."""

    def __init__(self, engine, models_dir: Path, enabled: bool = True):
        self.engine = engine
        self.models_dir = models_dir
        self.error: str | None = None
        self.state = "starting"
        self.model_name: str | None = None
        self.has_embeddings = False
        if not enabled:
            self.state = "disabled"
        elif Interpreter is None:
            self.state = "missing_runtime"
        self.labels = LABELS_PATH.read_text(encoding="utf-8").splitlines()
        self.model_choice = "yamnet"       # "yamnet" или "panns" – кой дава оценките
        self.accurate = PannsScorer(engine, models_dir, self.labels)
        self.listeners: list = []          # функции (result, embedding) → None
        self.latest: dict | None = None
        self._smoothed: np.ndarray | None = None
        self._results: list[dict] = []
        self._lock = threading.Lock()
        self._model_lock = threading.Lock()   # интерпретаторът не е за няколко нишки
        self._stop = threading.Event()

    def status(self) -> dict:
        return {"state": self.state, "error": self.error, "model": self.model_name,
                "embeddings": self.has_embeddings, "choice": self.model_choice,
                "accurate": self.accurate.status()}

    def set_model(self, choice: str) -> None:
        """Кой модел дава оценките. Точният се сваля и пуска при първия избор."""
        self.model_choice = choice
        if choice == "panns" and self.state not in ("disabled", "missing_runtime"):
            self.accurate.start()
        else:
            self.accurate.stop()

    def start(self) -> None:
        if self.state == "starting":
            threading.Thread(target=self._run, daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        self.accurate.stop()

    def pop_results(self) -> list[dict]:
        with self._lock:
            out, self._results = self._results, []
        return out

    # --- модел -----------------------------------------------------------------

    def _download(self, spec: dict, target: Path) -> None:
        self.state = "downloading"
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_suffix(".part")
        with urllib.request.urlopen(spec["url"], timeout=120) as response:
            data = response.read()
        if spec["archive_member"]:
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:
                member = archive.extractfile(spec["archive_member"])
                with open(part, "wb") as f:
                    shutil.copyfileobj(member, f)
        else:
            part.write_bytes(data)
        part.replace(target)

    def _ensure_model(self) -> Path:
        last_error = None
        for spec in MODELS:
            path = self.models_dir / spec["file"]
            if path.exists():
                return path
            try:
                self._download(spec, path)
                return path
            except Exception as exc:   # следващият модел в списъка е резерва
                last_error = exc
        raise RuntimeError(f"моделът не може да се свали: {last_error}")

    def _load(self, path: Path) -> None:
        interp = Interpreter(model_path=str(path))
        inp = interp.get_input_details()[0]
        if list(inp["shape_signature"]) == [-1]:      # пълният модел приема произволна дължина
            interp.resize_tensor_input(inp["index"], [MODEL_SAMPLES])
        interp.allocate_tensors()
        self._interp = interp
        self._input = inp["index"]
        outputs = interp.get_output_details()
        self._scores_out = outputs[0]["index"]
        emb = [o for o in outputs if o["shape_signature"][-1] == 1024]
        self._emb_out = emb[0]["index"] if emb else None
        self.has_embeddings = self._emb_out is not None
        self.model_name = path.stem

    def infer(self, audio_16k: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Оценки (521) и embedding за един прозорец от 0.975 s при 16 kHz.
        Без пълния модел embedding-ът е логаритъмът на оценките – по-слаб, но работи."""
        x = np.zeros(MODEL_SAMPLES, dtype=np.float32)
        x[-min(len(audio_16k), MODEL_SAMPLES):] = audio_16k[-MODEL_SAMPLES:]
        with self._model_lock:
            self._interp.set_tensor(self._input, x)
            self._interp.invoke()
            scores = self._interp.get_tensor(self._scores_out).reshape(-1).copy()
            embedding = (self._interp.get_tensor(self._emb_out).reshape(-1).copy()
                         if self._emb_out is not None else np.log(scores + 1e-4))
        return scores, embedding

    def embed_audio(self, audio: np.ndarray, hop: float = 0.5) -> list[np.ndarray]:
        """Embeddings за припокриващи се прозорци от по-дълъг звук (44.1 kHz) – за обучение."""
        if self.state != "ready":
            raise RuntimeError("разпознаването не е готово")
        x = to_model_rate(audio)
        step = int(hop * MODEL_RATE)
        return [self.infer(x[i:i + MODEL_SAMPLES])[1]
                for i in range(0, max(1, len(x) - MODEL_SAMPLES + 1), step)]

    # --- цикъл -----------------------------------------------------------------

    def _run(self) -> None:
        try:
            self._load(self._ensure_model())
        except Exception as exc:
            self.state = "error"
            self.error = str(exc)
            return
        self.state = "ready"
        next_time = time.monotonic()
        while not self._stop.is_set():
            if self.engine.running:
                try:
                    result, embedding = self._classify(self.engine.clip())
                    for listener in self.listeners:
                        listener(result, embedding)
                    with self._lock:
                        self._results.append(result)
                        self.latest = result
                    self.error = None
                except Exception as exc:
                    self.error = str(exc)
            else:
                self._smoothed = None
            next_time = max(next_time + INTERVAL, time.monotonic())
            self._stop.wait(next_time - time.monotonic())

    def _classify(self, clip: np.ndarray) -> tuple[dict, np.ndarray]:
        scores, embedding = self.infer(to_model_rate(clip))
        # Плъзгащо се средно, за да не прескача от категория в категория всяка секунда
        self._smoothed = scores if self._smoothed is None else SMOOTHING * scores + (1 - SMOOTHING) * self._smoothed
        s = self._smoothed
        model = "yamnet"
        if self.model_choice == "panns" and (accurate := self.accurate.scores()) is not None:
            s, model = accurate, "panns"   # CNN14 вече гледа 2.5 s, не се изглажда
        by_category = sorted(((name, float(s[idx].max())) for name, idx in CATEGORIES.items()),
                             key=lambda item: item[1], reverse=True)
        best, best_score = by_category[0]
        top = np.argsort(s)[::-1][:3]
        result = {
            "t": time.time(),
            "model": model,
            "category": best if best_score >= MIN_SCORE else "unknown",
            "score": round(best_score, 3),
            "categories": [{"id": c, "score": round(v, 3)} for c, v in by_category[:6]],
            "labels": [{"name": self.labels[i], "score": round(float(s[i]), 3)} for i in top],
        }
        return result, embedding
