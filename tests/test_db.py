import math
import sqlite3
from datetime import datetime

import numpy as np
import pytest

from db import DOSE_STANDARDS, Database, energy_mean, noise_dose, sound_exposure


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


START = datetime(2026, 10, 26, 12, 0, 0).timestamp()   # обед, местно време


def make_session(db: Database, levels: list[float], start: float = START) -> int:
    sid = db.create_session("тест", 0.0, None)
    db.add_measurements(sid, [
        {"t": start + i, "laeq": v, "lafmax": v + 3, "lafmin": v - 3, "lceq": v + 1, "lzeq": v + 2,
         "lzpeak": v + 10, "laimax": v + 4, "lcpeak": v + 12}
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
    assert s["laimax"] == 84 and s["lcpeak"] == 92
    assert s["ln"]["95"] == 50 and s["ln"]["5"] == 80


def test_sel_of_constant_level():
    # 60 dB за 10 s: SEL = 60 + 10·lg(10) = 70 dB
    assert sound_exposure(np.full(10, 60.0)) == pytest.approx(70.0)


def test_report_workplace_and_intervals(tmp_path):
    db = Database(tmp_path / "t.db")
    sid = make_session(db, [85.0] * 3600)   # един час при 85 dB(A)
    report = db.report(sid)
    # LEX,8h за 1 час при 85 dB = 85 + 10·lg(1/8) = 75.97
    assert report["workplace"]["lex"] == pytest.approx(85 + 10 * math.log10(1 / 8), abs=0.01)
    assert report["workplace"]["level"] is None      # LEX ≈ 76 < 80 и пик 97 dB(C) < 135
    minutes = report["intervals"]["60"]
    assert len(minutes) == 60 and minutes[0]["laeq"] == 85.0


def test_report_environment_periods(tmp_path):
    db = Database(tmp_path / "t.db")
    day = datetime(2026, 10, 26, 18, 59, 0).timestamp()      # 60 s ден + 60 s вечер
    sid = make_session(db, [50.0] * 60 + [40.0] * 60, start=day)
    env = db.report(sid)["environment"]
    assert env["day"]["laeq"] == 50 and env["day"]["seconds"] == 60
    assert env["evening"]["laeq"] == 40
    assert env["night"]["laeq"] is None and env["lden"] is None


def test_dashboard_heatmap_profile_and_forecast(tmp_path):
    db = Database(tmp_path / "t.db")
    # 8 дни по 2 часа (10–12 ч) при 50 dB, а в 11 ч – 60 dB
    for day in range(8):
        start = datetime(2026, 10, 10 + day, 10, 0, 0).timestamp()
        levels = [50.0] * 3600 + [60.0] * 3600
        make_session(db, levels, start=start)
    now = datetime(2026, 10, 17, 23, 30).timestamp()
    dash = db.dashboard(days=30, now=now)
    assert dash["days_covered"] == 8
    cell = next(c for c in dash["heatmap"] if c["date"] == "2026-10-12" and c["hour"] == 11)
    assert cell["laeq"] == 60.0 and cell["minutes"] == 60
    # Прогнозата за утре в 11 ч (неделя) идва от профила – медианата там е 60 dB
    tomorrow_11 = next(f for f in dash["forecast"] if datetime.fromtimestamp(f["t"]).hour == 11)
    assert tomorrow_11["median"] == 60.0
    assert len(dash["forecast"]) == 24
    night = next(f for f in dash["forecast"] if datetime.fromtimestamp(f["t"]).hour == 3)
    assert night["median"] is None          # в 3 ч никога не е мерено – празно, не нула


def test_dashboard_without_a_week_has_no_forecast(tmp_path):
    db = Database(tmp_path / "t.db")
    make_session(db, [55.0] * 600)
    assert db.dashboard(days=30, now=START + 3600)["forecast"] == []


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


def test_custom_sound_counts_recordings_not_windows(tmp_path):
    db = Database(tmp_path / "noise.db")
    sid = db.save_custom_sound({"name": "Лай", "icon": "🐕", "alert": False})
    db.add_custom_examples(sid, [np.ones(1024)] * 7)      # един запис от 4 s → 7 прозореца
    db.add_custom_examples(sid, [np.ones(1024)] * 7)
    sound = db.custom_sounds()[0]
    assert sound["examples"] == 14
    assert sound["recordings"] == 2
