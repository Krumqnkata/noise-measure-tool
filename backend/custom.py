"""Собствени звуци и откриване на аномалии върху embeddings на YAMNet.

Собствени звуци: потребителят записва няколко примера („кучето на съседа“); всеки нов
звук се сравнява с примерите по косинусово сходство (средното на най-близките 3).
Прагът се изчислява от самите примери – колко си приличат помежду си.

Аномалии: „научава“ как звучи нормално (стая, машина, помпа) за няколко минути.
Оценката е разстоянието до най-близките научени секунди, разделено на прага, плюс
проверка за необичайна сила. Оценка ≥ 1 значи „необичайно“. Само numpy, без нови пакети.
"""

import time

import numpy as np

TOP_K = 3
DEFAULT_THRESHOLD = 0.8           # при по-малко от 3 примера
MIN_THRESHOLD, MAX_THRESHOLD = 0.55, 0.95
LOUDNESS_MARGIN = 6.0             # dB над 99-ия процентил от обучението
MIN_ANOMALY_DISTANCE = 0.02


def normalize(m: np.ndarray) -> np.ndarray:
    m = np.atleast_2d(np.asarray(m, dtype=np.float32))
    return m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)


def top_k_similarity(examples: np.ndarray, emb: np.ndarray, k: int = TOP_K) -> float:
    sims = examples @ emb
    k = min(k, len(sims))
    return float(np.mean(np.sort(sims)[-k:]))


def leave_one_out(examples: np.ndarray, k: int = TOP_K) -> np.ndarray:
    """За всеки пример – сходството му с най-близките k от останалите."""
    sims = examples @ examples.T
    np.fill_diagonal(sims, -np.inf)
    k = min(k, len(examples) - 1)
    return np.mean(np.sort(sims, axis=1)[:, -k:], axis=1)


def sound_threshold(examples: np.ndarray) -> float:
    if len(examples) < 3:
        return DEFAULT_THRESHOLD
    loo = leave_one_out(examples)
    return float(np.clip(np.percentile(loo, 10) - 0.05, MIN_THRESHOLD, MAX_THRESHOLD))


class CustomSoundMatcher:
    def __init__(self):
        self.sounds: list[dict] = []

    def load(self, sounds: list[dict], examples: dict[int, list[np.ndarray]]) -> None:
        self.sounds = []
        for s in sounds:
            embs = examples.get(s["id"], [])
            if not embs:
                continue
            m = normalize(np.array(embs))
            self.sounds.append({**s, "examples": m, "threshold": sound_threshold(m)})

    def match(self, embedding: np.ndarray) -> dict | None:
        if not self.sounds:
            return None
        e = normalize(embedding)[0]
        scored = sorted(((top_k_similarity(s["examples"], e), s) for s in self.sounds),
                        key=lambda item: item[0], reverse=True)
        similarity, best = scored[0]
        if similarity < best["threshold"]:
            return None
        # Ако два звука са почти еднакво близки, не можем да кажем кой е
        if len(scored) > 1 and similarity - scored[1][0] < 0.02:
            return None
        return {"id": best["id"], "name": best["name"], "icon": best["icon"], "alert": bool(best["alert"]),
                "similarity": round(similarity, 3), "threshold": round(best["threshold"], 3)}


def train_anomaly_profile(embeddings: list[np.ndarray], levels: list[float]) -> dict:
    """Праг: 99.5-ият процентил на разстоянията на обучаващите секунди до останалите, ×1.2."""
    m = normalize(np.array(embeddings))
    distances = 1 - leave_one_out(m)
    return {
        "embeddings": m,
        "threshold": float(max(np.percentile(distances, 99.5) * 1.2, MIN_ANOMALY_DISTANCE)),
        "level_p99": float(np.percentile(levels, 99)),
    }


def anomaly_score(profile: dict, embedding: np.ndarray, level: float) -> float:
    distance = 1 - top_k_similarity(profile["embeddings"], normalize(embedding)[0])
    score = distance / profile["threshold"]
    # Необичайно силен звук е аномалия дори да „прилича“ на нормалното
    loud = (level - profile["level_p99"]) / LOUDNESS_MARGIN
    return float(max(score, loud))


class AnomalyLearner:
    """Събира секунди за нов профил, докато не мине зададеното време."""

    def __init__(self, name: str, seconds: int):
        self.name = name
        self.seconds = seconds
        self.started = time.time()
        self.embeddings: list[np.ndarray] = []
        self.levels: list[float] = []

    @property
    def progress(self) -> float:
        return min(1.0, (time.time() - self.started) / self.seconds)

    def add(self, embedding: np.ndarray, level: float) -> bool:
        """Връща True, когато обучението е завършило."""
        self.embeddings.append(np.asarray(embedding, dtype=np.float32))
        self.levels.append(level)
        return self.progress >= 1.0 and len(self.embeddings) >= 10


class EventTracker:
    """Събитие от ML (собствен звук, аномалия): започва след `min_on` поредни
    секунди със сработване и свършва след `release` секунди без."""

    def __init__(self, min_on: int = 2, release: float = 3.0):
        self.min_on = min_on
        self.release = release
        self.on_count = 0
        self.active = False
        self.last_on = 0.0
        self.started = 0.0
        self.peak = -np.inf

    def update(self, on: bool, level: float, now: float) -> str | None:
        """Връща "start", "end" или None."""
        if on:
            self.on_count += 1
            self.last_on = now
            self.peak = max(self.peak, level)
            if not self.active and self.on_count >= self.min_on:
                self.active = True
                self.started = now - (self.min_on - 1)
                return "start"
        else:
            self.on_count = 0
            if self.active and now - self.last_on >= self.release:
                self.active = False
                return "end"
        if not self.active and not on:
            self.peak = -np.inf
        return None
