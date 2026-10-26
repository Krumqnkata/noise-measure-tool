"""По-точно разпознаване с PANNs CNN14 (Kong и др., 2020; AudioSet, 527 класа, mAP 0.431
срещу ~0.31 за YAMNet).

Ползва се готовото TFLite копие от litert-community в Hugging Face (тегла CC-BY-4.0 от
Zenodo 3987831, код Apache-2.0) – върви със същата библиотека ai-edge-litert. Файлът е
~160 MB и се сваля само ако потребителят избере точния модел.

Моделът приема log-mel спектрограма на точно 10 s звук при 32 kHz и смята ~1 s на
процесора, затова върви в своя нишка на ~2 s. За да отговаря на това, което се чува
сега, последните 2.5 s се повтарят до 10 s (мрежата усреднява и взима максимума по
времето, така че повторението не променя резултата за самия откъс).

YAMNet продължава да дава embeddings за собствените звуци и аномалиите.
"""

import hashlib
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np
from scipy import signal

from audio import SAMPLE_RATE

try:
    from ai_edge_litert.interpreter import Interpreter
except ImportError:
    Interpreter = None

# Фиксирана версия на хранилището + SHA-256 на файловете, за да не се зареди подменен модел
REPO = "https://huggingface.co/litert-community/PANNs-CNN14-AudioSet-LiteRT/resolve/d9bade70b0224209ab4ab7145e1923c21641c626/"
FILES = {
    "cnn14_audioset_fp16.tflite": "26e52a285ff324778c7b90642e9733b47a46071622ecba93d42ca14ec19a467f",
    "mel_basis.bin": "50edbf75f0ffdb5bf295a54cb3b9c4ad27b841be1119255f0f785552b99f13bd",
    "audioset_labels.txt": None,
}
MODEL_RATE = 32_000
N_FFT, HOP, N_MELS = 1024, 320, 64
FRAMES = 1001                 # 10 s
WINDOW_SECONDS = 2.5          # колко от последния звук се оценява
INTERVAL = 2.0
FRESH_SECONDS = 6.0           # по-стар резултат не се ползва
# Класовете на AudioSet, които YAMNet няма – към най-близкия му клас
EXTRA_LABELS = {"Male speech, man speaking": "Speech", "Female speech, woman speaking": "Speech",
                "Male singing": "Singing", "Female singing": "Singing",
                "Funny music": "Music", "Battle cry": "Shout"}


def log_mel(audio_32k: np.ndarray, mel_basis: np.ndarray) -> np.ndarray:
    """Като torchlibrosa в PANNs: отражение в краищата, периодичен Hann, |FFT|², mel, 10·lg."""
    padded = np.pad(audio_32k, (N_FFT // 2, N_FFT // 2), mode="reflect")
    frames = np.lib.stride_tricks.sliding_window_view(padded, N_FFT)[::HOP]
    window = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)
    power = np.abs(np.fft.rfft(frames * window, axis=1)) ** 2
    return (10 * np.log10(np.maximum(power @ mel_basis.T, 1e-10))).astype(np.float32)


def model_input(audio_44k: np.ndarray, mel_basis: np.ndarray) -> np.ndarray:
    """Последният звук (44.1 kHz), повторен до 10 s при 32 kHz → [1, 1, 1001, 64]."""
    x = signal.resample_poly(audio_44k, MODEL_RATE // 100, SAMPLE_RATE // 100)
    x = np.clip(x, -1, 1).astype(np.float32)
    if not len(x):
        x = np.zeros(1, np.float32)
    x = np.tile(x, int(np.ceil(10 * MODEL_RATE / len(x))))[:10 * MODEL_RATE]
    mel = log_mel(x, mel_basis)[:FRAMES]
    return mel[None, None]


class PannsScorer:
    """Сваля и пуска CNN14 в своя нишка; `scores()` дава последните оценки
    в списъка класове на YAMNet (521), за да работят същите категории."""

    def __init__(self, engine, models_dir: Path, yamnet_labels: list[str]):
        self.engine = engine
        self.dir = models_dir / "panns"
        self.yamnet_labels = yamnet_labels
        self.state = "idle"          # idle → starting → (downloading) → ready / error
        self.error: str | None = None
        self.progress = 0.0
        self._scores: np.ndarray | None = None
        self._scores_t = 0.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def status(self) -> dict:
        return {"state": self.state, "error": self.error, "progress": round(self.progress, 3)}

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            self._stop.set()
            self._thread.join(timeout=5)
        self._stop.clear()
        self.state = "starting"
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._scores = None

    def scores(self) -> np.ndarray | None:
        if self._scores is None or time.time() - self._scores_t > FRESH_SECONDS:
            return None
        return self._scores

    # --- модел -----------------------------------------------------------------

    def _download(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        missing = [f for f in FILES if not (self.dir / f).exists()]
        if not missing:
            return
        self.state = "downloading"
        for name in missing:
            part = self.dir / f"{name}.part"
            digest = hashlib.sha256()
            with urllib.request.urlopen(REPO + name, timeout=60) as response, open(part, "wb") as f:
                total = int(response.headers.get("Content-Length") or 0)
                done = 0
                while chunk := response.read(1 << 20):
                    if self._stop.is_set():
                        raise RuntimeError("прекъснато")
                    f.write(chunk)
                    digest.update(chunk)
                    done += len(chunk)
                    if name.endswith(".tflite") and total:
                        self.progress = done / total
            if FILES[name] and digest.hexdigest() != FILES[name]:
                part.unlink()
                raise RuntimeError(f"{name}: контролната сума не съвпада")
            part.replace(self.dir / name)

    def _load(self):
        interp = Interpreter(model_path=str(self.dir / "cnn14_audioset_fp16.tflite"), num_threads=2)
        interp.allocate_tensors()
        mel_basis = np.fromfile(self.dir / "mel_basis.bin", dtype=np.float32).reshape(N_MELS, N_FFT // 2 + 1)
        labels = (self.dir / "audioset_labels.txt").read_text(encoding="utf-8").splitlines()
        index = {name: i for i, name in enumerate(self.yamnet_labels)}
        # за всеки клас на CNN14 – индексът му при YAMNet
        mapping = np.array([index[EXTRA_LABELS.get(name, name)] for name in labels])
        return interp, mel_basis, mapping

    def infer(self, interp, mel_basis, mapping, audio_44k: np.ndarray) -> np.ndarray:
        inp = interp.get_input_details()[0]["index"]
        interp.set_tensor(inp, model_input(audio_44k, mel_basis))
        interp.invoke()
        probs = interp.get_tensor(interp.get_output_details()[0]["index"]).reshape(-1)
        scores = np.zeros(len(self.yamnet_labels), np.float32)
        np.maximum.at(scores, mapping, probs)
        return scores

    def _run(self) -> None:
        try:
            self._download()
            interp, mel_basis, mapping = self._load()
        except Exception as exc:
            if not self._stop.is_set():
                self.state = "error"
                self.error = str(exc)
            else:
                self.state = "idle"
            return
        self.state = "ready"
        self.error = None
        while not self._stop.is_set():
            started = time.monotonic()
            if self.engine.running:
                try:
                    self._scores = self.infer(interp, mel_basis, mapping, self.engine.recent_audio(WINDOW_SECONDS))
                    self._scores_t = time.time()
                except Exception as exc:
                    self.error = str(exc)
            self._stop.wait(max(0.2, INTERVAL - (time.monotonic() - started)))
        self.state = "idle"
