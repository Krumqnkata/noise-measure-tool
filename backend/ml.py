"""Свързва разпознаването с функциите от машинно обучение: собствени звуци, откриване
на аномалии и аудио клипове на събития. Работи в нишката на разпознаването; съобщенията
към браузърите се трупат тук и главният цикъл ги изпраща."""

import threading
import time
import wave
from pathlib import Path

import numpy as np

from audio import SAMPLE_RATE
from custom import AnomalyLearner, CustomSoundMatcher, EventTracker, anomaly_score, train_anomaly_profile

CLIP_BEFORE = 3.0     # s преди събитието
CLIP_AFTER = 5.0      # s след него


class MLManager:
    def __init__(self, engine, classifier, db, config: dict, clips_dir: Path, current_recording):
        self.engine = engine
        self.classifier = classifier
        self.db = db
        self.config = config
        self.clips_dir = clips_dir
        self.current_recording = current_recording   # функция → текущият запис или None
        self.matcher = CustomSoundMatcher()
        self.learner: AnomalyLearner | None = None
        self.profile: dict | None = None
        self.custom_trackers: dict[int, EventTracker] = {}
        self.custom_events: dict[int, int] = {}
        self.anomaly_tracker = EventTracker()
        self.anomaly_event: int | None = None
        self._messages: list[dict] = []
        self._lock = threading.Lock()
        self.reload_sounds()
        self.activate_profile(config.get("anomaly_profile"))
        classifier.listeners.append(self.on_result)

    # --- управление ----------------------------------------------------------------

    def reload_sounds(self) -> None:
        self.matcher.load(self.db.custom_sounds(), self.db.custom_examples())

    def activate_profile(self, profile_id: int | None) -> None:
        self.profile = None
        if profile_id is not None:
            self.profile = next((p for p in self.db.anomaly_profiles(with_data=True) if p["id"] == profile_id), None)
        self.config["anomaly_profile"] = self.profile["id"] if self.profile else None
        self.anomaly_tracker = EventTracker()

    def start_learning(self, name: str, seconds: int) -> None:
        self.learner = AnomalyLearner(name, seconds)

    def status(self) -> dict:
        return {
            "anomaly_profile": self.config.get("anomaly_profile"),
            "learning": {"name": self.learner.name, "progress": round(self.learner.progress, 3)} if self.learner else None,
        }

    def pop_messages(self) -> list[dict]:
        with self._lock:
            out, self._messages = self._messages, []
        return out

    def _send(self, message: dict) -> None:
        with self._lock:
            self._messages.append(message)

    def _session_id(self) -> int | None:
        rec = self.current_recording()
        return rec["id"] if rec else None

    # --- всяка секунда (нишката на разпознаването) ------------------------------------

    def on_result(self, result: dict, embedding: np.ndarray) -> None:
        now = time.time()
        level = self.engine.level("A", "F")

        # Собствени звуци: при съвпадение заместват категорията (и в записа, и в „Чува се“)
        hit = self.matcher.match(embedding)
        result["custom"] = hit
        if hit:
            result["category"] = f"custom:{hit['id']}"
            result["score"] = hit["similarity"]
        for sound in self.matcher.sounds:
            if not sound["alert"]:
                continue
            tracker = self.custom_trackers.setdefault(sound["id"], EventTracker())
            change = tracker.update(bool(hit and hit["id"] == sound["id"]), level, now)
            self._handle_event(change, "custom", sound["name"], tracker, sound["threshold"], key=sound["id"])

        # Аномалии: обучение или проверка спрямо активния профил
        if self.learner:
            if self.learner.add(embedding, level):
                learner, self.learner = self.learner, None
                profile = train_anomaly_profile(learner.embeddings, learner.levels)
                profile_id = self.db.save_anomaly_profile(learner.name, learner.seconds, profile)
                self.activate_profile(profile_id)
                self._send({"type": "anomaly_learned", "id": profile_id, "name": learner.name})
        elif self.profile:
            score = anomaly_score(self.profile, embedding, level)
            change = self.anomaly_tracker.update(score >= 1.0, level, now)
            self._handle_event(change, "anomaly", self.profile["name"], self.anomaly_tracker, 1.0)
            result["anomaly"] = {"score": round(score, 2), "active": self.anomaly_tracker.active}
        result["ml"] = self.status()

    def _handle_event(self, change: str | None, kind: str, label: str, tracker: EventTracker,
                      threshold: float, key: int | None = None) -> None:
        if change == "start":
            event_id = self.db.start_event(self._session_id(), tracker.started, threshold, tracker.peak, kind, label)
            if kind == "custom":
                self.custom_events[key] = event_id
            else:
                self.anomaly_event = event_id
            self._send({"type": "ml_event", "kind": kind, "label": label, "active": True,
                        "started_at": tracker.started, "max_level": round(tracker.peak, 1)})
            self.save_clip(kind, label, event_id)
        elif change == "end":
            event_id = self.custom_events.pop(key, None) if kind == "custom" else self.anomaly_event
            if kind == "anomaly":
                self.anomaly_event = None
            if event_id:
                self.db.end_event(event_id, tracker.last_on, tracker.peak)
            self._send({"type": "ml_event", "kind": kind, "label": label, "active": False})

    # --- клипове -----------------------------------------------------------------------

    def save_clip(self, reason: str, label: str | None, event_id: int | None) -> None:
        cfg = self.config
        if not cfg.get("clips_enabled", True) or reason not in cfg.get("clips_on", ["alarm", "anomaly", "custom"]):
            return
        latest = self.classifier.latest
        if cfg.get("clips_skip_speech", True) and latest and latest.get("category") == "people":
            return   # не пазим записи на разговори
        session_id = self._session_id()
        trigger = time.time()
        timer = threading.Timer(CLIP_AFTER, self._write_clip, (reason, label, event_id, session_id, trigger))
        timer.daemon = True
        timer.start()

    def _write_clip(self, reason, label, event_id, session_id, trigger) -> None:
        audio = self.engine.recent_audio(CLIP_BEFORE + CLIP_AFTER)
        if not len(audio):
            return
        self.clips_dir.mkdir(parents=True, exist_ok=True)
        name = f"{time.strftime('%Y%m%d-%H%M%S', time.localtime(trigger))}-{reason}-{int(trigger * 1000) % 1000:03d}.wav"
        path = self.clips_dir / name
        pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
        with wave.open(str(path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(pcm.tobytes())
        clip_id = self.db.add_clip({"t": trigger - CLIP_BEFORE, "session_id": session_id, "event_id": event_id,
                                    "reason": reason, "label": label, "file": name,
                                    "seconds": len(audio) / SAMPLE_RATE, "bytes": path.stat().st_size})
        # Ограничение на мястото: трием най-старите
        for old in self.db.oldest_clips_over(int(self.config.get("clips_max_mb", 200) * 1024 * 1024)):
            self.delete_clip(old["id"])
        self._send({"type": "clip", "id": clip_id, "reason": reason, "label": label})

    def delete_clip(self, clip_id: int) -> bool:
        clip = self.db.delete_clip(clip_id)
        if clip:
            (self.clips_dir / clip["file"]).unlink(missing_ok=True)
        return clip is not None
