import sqlite3

import numpy as np
import pytest

from db import DOSE_STANDARDS, Database, energy_mean, noise_dose


def test_energy_mean_is_not_arithmetic():
    # 60 и 70 dB: енергийното средно е 67.4, а не 65
    assert energy_mean(np.array([60.0, 70.0])) == pytest.approx(67.4, abs=0.05)


@pytest.mark.parametrize("standard, level, hours", [
    ("niosh", 85, 8), ("niosh", 94, 1), ("osha", 90, 8), ("osha", 95, 4),
])
def test_noise_dose_reaches_100_percent(standard, level, hours):
    result = noise_dose(np.full(hours * 3600, float(level)), **DOSE_STANDARDS[standard])
    assert result["dose"] == pytest.approx(100, rel=1e-6)


def test_noise_dose_ignores_levels_below_threshold():
    assert noise_dose(np.full(3600, 79.0), **DOSE_STANDARDS["niosh"])["dose"] == 0


def make_session(db: Database, levels: list[float]) -> int:
    sid = db.create_session("тест", 0.0, None)
    db.add_measurements(sid, [
        {"t": 1000.0 + i, "laeq": v, "lafmax": v + 3, "lafmin": v - 3, "lceq": v + 1, "lzeq": v + 2, "lzpeak": v + 10}
        for i, v in enumerate(levels)
    ])
    db.end_session(sid)
    return sid


def test_report_summary(tmp_path):
    db = Database(tmp_path / "t.db")
    sid = make_session(db, [50.0] * 90 + [80.0] * 10)
    report = db.report(sid)
    s = report["summary"]
    assert s["seconds"] == 100
    assert s["laeq"] == pytest.approx(energy_mean(np.array([50.0] * 90 + [80.0] * 10)))
    assert s["lafmax"] == 83
    assert s["l90"] == 50
    above_80 = next(a for a in report["above"] if a["threshold"] == 80)
    assert above_80["seconds"] == 10


def test_migrates_old_database(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute("""CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                    started_at REAL NOT NULL, ended_at REAL, calibration_offset REAL NOT NULL, device TEXT)""")
    conn.execute("INSERT INTO sessions (name, started_at, calibration_offset) VALUES ('стар', 1, 0)")
    conn.commit()
    conn.close()

    db = Database(path)
    assert db.get_session(1)["note"] == ""
    version = db._conn.execute("PRAGMA user_version").fetchone()[0]
    Database(path)   # второ отваряне не трябва да мигрира наново
    assert db._conn.execute("PRAGMA user_version").fetchone()[0] == version
