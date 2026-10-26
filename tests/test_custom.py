import numpy as np
import pytest

from custom import (CustomSoundMatcher, EventTracker, anomaly_score, normalize, sound_threshold,
                    train_anomaly_profile)

RNG = np.random.default_rng(0)


def cluster(center: np.ndarray, n: int, spread: float = 0.05) -> list[np.ndarray]:
    """Embeddings около даден център – като примери на един и същ звук."""
    return [np.abs(center + spread * RNG.standard_normal(center.shape)) for _ in range(n)]


CENTERS = {name: np.abs(RNG.standard_normal(1024)) for name in ("dog", "fridge", "music")}


def matcher() -> CustomSoundMatcher:
    m = CustomSoundMatcher()
    sounds = [{"id": i, "name": n, "icon": "🔔", "alert": 0} for i, n in enumerate(CENTERS, 1)]
    examples = {i: cluster(CENTERS[n], 6) for i, n in enumerate(CENTERS, 1)}
    m.load(sounds, examples)
    return m


def test_matches_the_right_sound():
    m = matcher()
    for i, name in enumerate(CENTERS, 1):
        hit = m.match(cluster(CENTERS[name], 1)[0])
        assert hit is not None and hit["id"] == i


def test_unknown_sound_is_not_matched():
    assert matcher().match(np.abs(RNG.standard_normal(1024)) * 3) is None


def test_threshold_from_examples_is_clamped():
    tight = normalize(np.array(cluster(CENTERS["dog"], 5, spread=0.001)))
    assert sound_threshold(tight) == pytest.approx(0.95, abs=1e-5)
    assert sound_threshold(tight[:2]) == 0.8


def test_anomaly_detection():
    normal = cluster(CENTERS["fridge"], 120, spread=0.1)
    profile = train_anomaly_profile(normal, list(RNG.normal(40, 1, 120)))
    assert anomaly_score(profile, cluster(CENTERS["fridge"], 1, spread=0.1)[0], 40) < 1
    assert anomaly_score(profile, CENTERS["music"], 40) > 1            # различен звук
    assert anomaly_score(profile, cluster(CENTERS["fridge"], 1)[0], 60) > 1   # същият, но много по-силен


def test_event_tracker_needs_two_hits_and_releases_after_three_seconds():
    tr = EventTracker()
    assert tr.update(True, 50, 0) is None
    assert tr.update(True, 55, 1) == "start" and tr.started == 0
    assert tr.update(False, 40, 2) is None
    assert tr.update(False, 40, 3) is None
    assert tr.update(False, 40, 4) == "end" and tr.peak == 55
