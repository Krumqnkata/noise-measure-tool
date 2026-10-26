"""SQLite база (един файл): записи (сесии), едносекундни измервания и събития от алармата."""

import math
import sqlite3
import threading
import time
from datetime import datetime

import numpy as np

from norms import ENV_HOURS, env_period, lden, lex_8h, workplace_level

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL,
    started_at         REAL NOT NULL,
    ended_at           REAL,
    calibration_offset REAL NOT NULL,
    device             TEXT,
    note               TEXT NOT NULL DEFAULT '',
    schedule_id        INTEGER
);

CREATE TABLE IF NOT EXISTS schedules (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    days    TEXT NOT NULL,          -- дни от седмицата: 0 = понеделник … 6 = неделя, напр. "0123456"
    start_time TEXT NOT NULL,       -- "23:00"
    end_time   TEXT NOT NULL,       -- "07:00" (може да е след полунощ)
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS measurements (
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    t          REAL NOT NULL,
    laeq       REAL NOT NULL,
    lafmax     REAL NOT NULL,
    lafmin     REAL NOT NULL,
    lceq       REAL NOT NULL,
    lzeq       REAL NOT NULL,
    lzpeak     REAL NOT NULL,
    laimax     REAL,
    lcpeak     REAL
);
CREATE INDEX IF NOT EXISTS idx_measurements_session ON measurements(session_id, t);

CREATE TABLE IF NOT EXISTS sources (
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    t          REAL NOT NULL,
    category   TEXT NOT NULL,
    score      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_session ON sources(session_id);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    started_at REAL NOT NULL,
    ended_at   REAL,
    threshold  REAL NOT NULL,
    max_level  REAL NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'alarm',   -- alarm / anomaly / custom
    label      TEXT                             -- напр. името на собствения звук
);

-- Собствени звуци и примерите им (embedding на YAMNet, 1024 × float32)
CREATE TABLE IF NOT EXISTS custom_sounds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT '🔔',
    alert      INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_examples (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sound_id   INTEGER NOT NULL REFERENCES custom_sounds(id) ON DELETE CASCADE,
    embedding  BLOB NOT NULL,
    created_at REAL NOT NULL
);

-- Профили за откриване на аномалии: всички научени embeddings в един BLOB (n × 1024)
CREATE TABLE IF NOT EXISTS anomaly_profiles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at REAL NOT NULL,
    seconds    INTEGER NOT NULL,
    threshold  REAL NOT NULL,
    level_p99  REAL NOT NULL,
    embeddings BLOB NOT NULL
);

-- Аудио клипове на събития (WAV файлове в папка clips/)
CREATE TABLE IF NOT EXISTS clips (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    t          REAL NOT NULL,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    event_id   INTEGER REFERENCES events(id) ON DELETE SET NULL,
    reason     TEXT NOT NULL,
    label      TEXT,
    file       TEXT NOT NULL,
    seconds    REAL NOT NULL,
    bytes      INTEGER NOT NULL
);
"""

MEASUREMENT_FIELDS = ("t", "laeq", "lafmax", "lafmin", "lceq", "lzeq", "lzpeak", "laimax", "lcpeak")
REPORT_THRESHOLDS = (60, 70, 80, 85, 90)
MAX_SERIES_POINTS = 1500
PERCENTILES = (1, 5, 10, 50, 90, 95, 99)          # Ln в отчета
INTERVALS = (60, 300, 900, 3600)                   # LAeq по интервали, s

# Сън – насоките на СЗО: в спалнята LAFmax не бива да минава 45 dB(A) повече от 10–15 пъти
# на нощ (Guidelines for Community Noise, 1999); средно навън Lnight ≤ 40 dB (Night Noise
# Guidelines for Europe, 2009).
SLEEP_EVENT_LEVEL = 45.0
SLEEP_EVENT_GAP = 5          # s – по-близки превишавания са едно събитие
SLEEP_MAX_EVENTS = 10
SLEEP_LNIGHT = 40.0

# Стандарти за шумова доза: критерий (dB за 8 ч = 100%), обменен коефициент
# (с колко dB повече времето се намалява наполовина) и праг, под който не се брои.
DOSE_STANDARDS = {
    "niosh": {"criterion": 85.0, "exchange": 3.0, "threshold": 80.0},
    "osha": {"criterion": 90.0, "exchange": 5.0, "threshold": 80.0},
}
WORK_DAY = 8 * 3600


class _LeqAggregate:
    """SQL агрегат leq(x): енергийно средно на нива в dB – 10·log10(средно(10^(x/10)))."""

    def __init__(self):
        self.total = 0.0
        self.n = 0

    def step(self, value):
        if value is not None:
            self.total += 10 ** (value / 10)
            self.n += 1

    def finalize(self):
        return 10 * math.log10(self.total / self.n) if self.n else None


def energy_mean(levels: np.ndarray) -> float:
    return float(10 * np.log10(np.mean(10 ** (levels / 10))))


def sound_exposure(levels: np.ndarray) -> float:
    """SEL / LAE – енергията на събитието, отнесена към 1 s: 10·lg(Σ 10^(L/10)), всеки ред е 1 s."""
    return float(10 * np.log10(np.sum(10 ** (levels / 10))))


def interval_levels(t: np.ndarray, laeq: np.ndarray, seconds: int) -> list[dict]:
    """LAeq по последователни интервали, подравнени към часовника (напр. 14:00, 14:15…)."""
    offset = time.localtime(float(t[0])).tm_gmtoff
    keys = np.floor((t + offset) / seconds).astype(np.int64)
    out = []
    for key in np.unique(keys):
        mask = keys == key
        out.append({"t": float(key * seconds - offset), "laeq": round(energy_mean(laeq[mask]), 1),
                    "seconds": int(mask.sum())})
    return out


def sleep_analysis(t: np.ndarray, laeq: np.ndarray, lafmax: np.ndarray, sources: list[tuple]) -> dict:
    """Шумови събития, които могат да събудят: LAFmax ≥ 45 dB(A), обединени ако са на ≤ 5 s."""
    over = np.nonzero(lafmax >= SLEEP_EVENT_LEVEL)[0]
    events = []
    for i in over:
        if events and t[i] - events[-1]["end"] <= SLEEP_EVENT_GAP:
            ev = events[-1]
            ev["end"] = float(t[i])
            if lafmax[i] > ev["max"]:
                ev["max"], ev["at"] = float(lafmax[i]), float(t[i])
        else:
            events.append({"start": float(t[i]), "end": float(t[i]), "max": float(lafmax[i]), "at": float(t[i])})

    # Източникът – най-честата разпозната категория по време на събитието
    src_t = np.array([s[0] for s in sources]) if sources else np.array([])
    for ev in events:
        ev["source"] = None
        if len(src_t):
            mask = (src_t >= ev["start"] - 1) & (src_t <= ev["end"] + 1)
            cats = [sources[k][1] for k in np.nonzero(mask)[0] if sources[k][1] not in ("silence", "unknown")]
            if cats:
                ev["source"] = max(set(cats), key=cats.count)
    return {
        "threshold": SLEEP_EVENT_LEVEL,
        "max_events": SLEEP_MAX_EVENTS,
        "lnight_guideline": SLEEP_LNIGHT,
        "laeq": energy_mean(laeq),
        "events": events,
    }


def environment_periods(t: np.ndarray, laeq: np.ndarray) -> dict:
    """Lден, Lвечер, Lнощ (Наредба № 6/2006) и колко от всеки период е покрит от записа."""
    periods = np.array([env_period(datetime.fromtimestamp(float(x)).hour) for x in t])
    out = {}
    for name, hours in ENV_HOURS.items():
        mask = periods == name
        n = int(mask.sum())
        out[name] = {
            "laeq": round(energy_mean(laeq[mask]), 1) if n else None,
            "seconds": n,
            "coverage": min(1.0, n / (hours * 3600)),
        }
    out["lden"] = lden(*(out[p]["laeq"] for p in ("day", "evening", "night")))
    return out


def noise_dose(laeq_seconds: np.ndarray, criterion: float, exchange: float, threshold: float) -> dict:
    """Доза в % от допустимото за работен ден. При ниво L допустимото време е
    8 ч / 2^((L − критерий) / обменен коефициент); всеки ред е 1 секунда."""
    levels = laeq_seconds[laeq_seconds >= threshold]
    allowed = WORK_DAY / 2 ** ((levels - criterion) / exchange)
    dose = float(100 * np.sum(1 / allowed))
    # TWA – постоянното ниво за 8 ч, което би дало същата доза
    twa = criterion + exchange / math.log10(2) * math.log10(dose / 100) if dose > 0 else None
    return {
        "dose": dose,
        "twa": twa,
        "projected": dose * WORK_DAY / len(laeq_seconds),
    }


class Database:
    def __init__(self, path):
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.create_aggregate("leq", 1, _LeqAggregate)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)
        self._migrate()
        self._close_interrupted()

    def _add_column(self, table: str, column: str, declaration: str) -> None:
        columns = {r["name"] for r in self._conn.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")

    def _migrate(self) -> None:
        """Обновява стари бази до текущата схема. Версията се пази в PRAGMA user_version;
        всяка миграция е безопасна и при повторно пускане (новите бази вече имат колоните от SCHEMA)."""
        migrations = [
            lambda: self._add_column("sessions", "note", "TEXT NOT NULL DEFAULT ''"),
            lambda: (self._add_column("measurements", "laimax", "REAL"),
                     self._add_column("measurements", "lcpeak", "REAL")),
            lambda: self._add_column("sessions", "schedule_id", "INTEGER"),
            lambda: (self._add_column("events", "kind", "TEXT NOT NULL DEFAULT 'alarm'"),
                     self._add_column("events", "label", "TEXT")),
        ]
        version = self._conn.execute("PRAGMA user_version").fetchone()[0]
        with self._conn:
            for step in migrations[version:]:
                step()
            self._conn.execute(f"PRAGMA user_version = {len(migrations)}")

    def _close_interrupted(self) -> None:
        """Записи, останали „отворени“ след срив, приключват при последното си измерване."""
        with self._lock, self._conn:
            self._conn.execute(
                """UPDATE sessions SET ended_at = COALESCE(
                       (SELECT MAX(t) FROM measurements WHERE session_id = sessions.id), started_at)
                   WHERE ended_at IS NULL"""
            )
            self._conn.execute(
                "UPDATE events SET ended_at = started_at WHERE ended_at IS NULL"
            )

    # --- записи -------------------------------------------------------------

    def create_session(self, name: str, calibration_offset: float, device: str | None,
                       schedule_id: int | None = None) -> int:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO sessions (name, started_at, calibration_offset, device, schedule_id) VALUES (?, ?, ?, ?, ?)",
                (name, time.time(), calibration_offset, device, schedule_id),
            )
            return cur.lastrowid

    def end_session(self, session_id: int) -> None:
        with self._lock, self._conn:
            self._conn.execute("UPDATE sessions SET ended_at = ? WHERE id = ?", (time.time(), session_id))

    def update_session(self, session_id: int, name: str | None = None, note: str | None = None) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "UPDATE sessions SET name = COALESCE(?, name), note = COALESCE(?, note) WHERE id = ?",
                (name, note, session_id),
            )
            return cur.rowcount > 0

    def delete_session(self, session_id: int) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            return cur.rowcount > 0

    def add_measurements(self, session_id: int, rows: list[dict]) -> None:
        if not rows:
            return
        with self._lock, self._conn:
            self._conn.executemany(
                f"INSERT INTO measurements (session_id, {', '.join(MEASUREMENT_FIELDS)}) "
                f"VALUES (?, {', '.join('?' * len(MEASUREMENT_FIELDS))})",
                [(session_id, *(r.get(f) for f in MEASUREMENT_FIELDS)) for r in rows],
            )

    def add_sources(self, session_id: int, results: list[dict]) -> None:
        if not results:
            return
        with self._lock, self._conn:
            self._conn.executemany(
                "INSERT INTO sources (session_id, t, category, score) VALUES (?, ?, ?, ?)",
                [(session_id, r["t"], r["category"], r["score"]) for r in results],
            )

    def sources(self, session_id: int) -> list[dict]:
        """Колко време (в разпознавания, ~1 s всяко) е чуван всеки източник."""
        with self._lock:
            rows = self._conn.execute(
                """SELECT category, COUNT(*) AS seconds FROM sources
                   WHERE session_id = ? GROUP BY category ORDER BY seconds DESC""",
                (session_id,),
            ).fetchall()
        total = sum(r["seconds"] for r in rows)
        return [{"category": r["category"], "seconds": r["seconds"], "share": r["seconds"] / total} for r in rows]

    def source_points(self, session_id: int) -> list[tuple]:
        with self._lock:
            return [tuple(r) for r in self._conn.execute(
                "SELECT t, category FROM sources WHERE session_id = ? ORDER BY t", (session_id,))]

    # --- табло --------------------------------------------------------------

    def dashboard(self, days: int, now: float | None = None) -> dict:
        """Дългосрочен преглед от всички записи: карта ден × час, профил по час от
        седмицата (за прогноза) и водещ източник по час. Работи с минутни LAeq."""
        now = now or time.time()
        since = now - days * 86400
        with self._lock:
            minutes = self._conn.execute(
                """SELECT CAST(t / 60 AS INTEGER) AS m, leq(laeq) AS laeq FROM measurements
                   WHERE t >= ? GROUP BY m ORDER BY m""", (since,)).fetchall()
            src = self._conn.execute(
                "SELECT t, category FROM sources WHERE t >= ? AND category NOT IN ('silence', 'unknown')",
                (since,)).fetchall()

        cells: dict[tuple[str, int], list[float]] = {}
        week: list[list[float]] = [[] for _ in range(168)]   # понеделник 0 ч … неделя 23 ч
        dates = set()
        for row in minutes:
            dt = datetime.fromtimestamp(row["m"] * 60)
            key = (dt.strftime("%Y-%m-%d"), dt.hour)
            cells.setdefault(key, []).append(row["laeq"])
            week[dt.weekday() * 24 + dt.hour].append(row["laeq"])
            dates.add(key[0])

        heatmap = [{"date": d, "hour": h, "laeq": round(energy_mean(np.array(v)), 1), "minutes": len(v)}
                   for (d, h), v in sorted(cells.items())]
        profile = [None if len(v) < 10 else {
            "median": round(float(np.median(v)), 1),
            "p10": round(float(np.percentile(v, 10)), 1),
            "p90": round(float(np.percentile(v, 90)), 1),
            "minutes": len(v),
        } for v in week]

        # Прогноза: следващите 24 часа по профила (смислено едва след седмица данни).
        # Часовете без данни остават празни (median = None), за да не се свързват на графиката.
        forecast = []
        if len(dates) >= 7:
            start = datetime.fromtimestamp(now).replace(minute=0, second=0, microsecond=0)
            for i in range(1, 25):
                dt = datetime.fromtimestamp(start.timestamp() + i * 3600)
                p = profile[dt.weekday() * 24 + dt.hour] or {"median": None, "p10": None, "p90": None, "minutes": 0}
                forecast.append({"t": dt.timestamp(), **p})

        by_hour: dict[int, dict[str, int]] = {}
        for row in src:
            hour = datetime.fromtimestamp(row["t"]).hour
            by_hour.setdefault(hour, {}).setdefault(row["category"], 0)
            by_hour[hour][row["category"]] += 1
        sources = []
        for hour, counts in sorted(by_hour.items()):
            category, n = max(counts.items(), key=lambda item: item[1])
            sources.append({"hour": hour, "category": category, "share": n / sum(counts.values())})

        return {"days": days, "dates": sorted(dates), "days_covered": len(dates), "heatmap": heatmap,
                "forecast": forecast, "sources_by_hour": sources}

    # --- график -------------------------------------------------------------

    def schedules(self) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute("SELECT * FROM schedules ORDER BY start_time")]

    def save_schedule(self, data: dict, schedule_id: int | None = None) -> int:
        fields = ("name", "days", "start_time", "end_time", "enabled")
        with self._lock, self._conn:
            if schedule_id is None:
                cur = self._conn.execute(
                    f"INSERT INTO schedules ({', '.join(fields)}) VALUES (?, ?, ?, ?, ?)",
                    tuple(data[f] for f in fields))
                return cur.lastrowid
            self._conn.execute(
                f"UPDATE schedules SET {', '.join(f'{f} = ?' for f in fields)} WHERE id = ?",
                (*(data[f] for f in fields), schedule_id))
            return schedule_id

    def delete_schedule(self, schedule_id: int) -> bool:
        with self._lock, self._conn:
            return self._conn.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,)).rowcount > 0

    def list_sessions(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                """SELECT s.*, COUNT(m.t) AS seconds, leq(m.laeq) AS laeq, MAX(m.lafmax) AS lafmax
                   FROM sessions s LEFT JOIN measurements m ON m.session_id = s.id
                   GROUP BY s.id ORDER BY s.started_at DESC"""
            ).fetchall()
        return [dict(r) for r in rows]

    def get_session(self, session_id: int) -> dict | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return dict(row) if row else None

    def measurements(self, session_id: int) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(
                f"SELECT {', '.join(MEASUREMENT_FIELDS)} FROM measurements WHERE session_id = ? ORDER BY t",
                (session_id,),
            ).fetchall()

    def report(self, session_id: int) -> dict | None:
        session = self.get_session(session_id)
        if session is None:
            return None
        rows = self.measurements(session_id)
        events = self.events(session_id=session_id)
        end = session["ended_at"] or time.time()
        report = {"session": session, "duration": end - session["started_at"], "events": events,
                  "summary": None, "series": None, "histogram": None, "above": None, "dose": None,
                  "sources": self.sources(session_id), "sleep": None}
        if not rows:
            return report

        # LAImax и LCpeak липсват в записи от стари версии – там остават NaN
        data = np.array([[np.nan if v is None else v for v in r] for r in rows], dtype=float)
        t, laeq, lafmax, lafmin, lceq, lzeq, lzpeak, laimax, lcpeak = data.T
        nan_max = lambda x: None if np.all(np.isnan(x)) else float(np.nanmax(x))  # noqa: E731
        summary = {
            "seconds": len(t),
            "laeq": energy_mean(laeq),
            "lafmax": float(lafmax.max()),
            "lafmin": float(lafmin.min()),
            "laimax": nan_max(laimax),
            "lceq": energy_mean(lceq),
            "lzeq": energy_mean(lzeq),
            "lzpeak": float(lzpeak.max()),
            "lcpeak": nan_max(lcpeak),
            "lae": sound_exposure(laeq),
            # Статистически нива от едносекундните LAeq: L10 е надвишено 10% от времето и т.н.
            "ln": {str(p): float(np.percentile(laeq, 100 - p)) for p in PERCENTILES},
            "loudest_at": float(t[int(np.argmax(lafmax))]),
        }
        summary.update(l10=summary["ln"]["10"], l50=summary["ln"]["50"], l90=summary["ln"]["90"])
        report["summary"] = summary
        report["above"] = [{"threshold": thr, "seconds": int(np.sum(laeq >= thr))} for thr in REPORT_THRESHOLDS]
        report["dose"] = {name: noise_dose(laeq, **std) for name, std in DOSE_STANDARDS.items()}
        lex = lex_8h(summary["laeq"], len(t))
        report["workplace"] = {"lex": lex, "lcpeak": summary["lcpeak"],
                               "level": workplace_level(lex, summary["lcpeak"])}
        report["environment"] = environment_periods(t, laeq)
        # Нощен анализ – когато записът е предимно през нощта или е по график
        night_share = report["environment"]["night"]["seconds"] / len(t)
        if night_share >= 0.5 or session.get("schedule_id"):
            report["sleep"] = sleep_analysis(t, laeq, lafmax, self.source_points(session_id))
        report["intervals"] = {str(s): interval_levels(t, laeq, s) for s in INTERVALS}
        for e in events:
            mask = (t >= math.floor(e["started_at"])) & (t <= (e["ended_at"] or end) + 1)
            e["sel"] = sound_exposure(laeq[mask]) if mask.any() else None

        # Хистограма през 2 dB
        lo = math.floor(laeq.min() / 2) * 2
        hi = math.ceil(laeq.max() / 2) * 2 + 2
        counts, edges = np.histogram(laeq, bins=np.arange(lo, hi + 1, 2))
        report["histogram"] = {"edges": edges.tolist(), "counts": counts.tolist()}

        # За дълги записи групираме точките, за да не пращаме десетки хиляди
        if len(t) > MAX_SERIES_POINTS:
            groups = np.array_split(np.arange(len(t)), MAX_SERIES_POINTS)
            report["series"] = {
                "t": [float(t[g[0]]) for g in groups],
                "laeq": [round(energy_mean(laeq[g]), 1) for g in groups],
                "lafmax": [round(float(lafmax[g].max()), 1) for g in groups],
            }
        else:
            report["series"] = {
                "t": t.tolist(),
                "laeq": np.round(laeq, 1).tolist(),
                "lafmax": np.round(lafmax, 1).tolist(),
            }
        return report

    # --- събития ------------------------------------------------------------

    def start_event(self, session_id: int | None, started_at: float, threshold: float, level: float,
                    kind: str = "alarm", label: str | None = None) -> int:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO events (session_id, started_at, threshold, max_level, kind, label) VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, started_at, threshold, level, kind, label),
            )
            return cur.lastrowid

    def end_event(self, event_id: int, ended_at: float, max_level: float) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE events SET ended_at = ?, max_level = ? WHERE id = ?", (ended_at, max_level, event_id)
            )

    def events(self, session_id: int | None = None, limit: int | None = None) -> list[dict]:
        # Клипът към събитието (ако има) – за пускане направо от списъка
        sql = "SELECT e.*, (SELECT MIN(c.id) FROM clips c WHERE c.event_id = e.id) AS clip_id FROM events e"
        params: list = []
        if session_id is not None:
            sql += " WHERE e.session_id = ?"
            params.append(session_id)
        sql += " ORDER BY e.started_at DESC"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    # --- собствени звуци -------------------------------------------------------

    def custom_sounds(self) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(
                # всички прозорци от един запис имат едно и също време → брой записи
                """SELECT s.*, COUNT(e.id) AS examples, COUNT(DISTINCT e.created_at) AS recordings FROM custom_sounds s
                   LEFT JOIN custom_examples e ON e.sound_id = s.id GROUP BY s.id ORDER BY s.created_at""")]

    def custom_examples(self) -> dict[int, list[np.ndarray]]:
        out: dict[int, list[np.ndarray]] = {}
        with self._lock:
            for r in self._conn.execute("SELECT sound_id, embedding FROM custom_examples"):
                out.setdefault(r["sound_id"], []).append(np.frombuffer(r["embedding"], dtype=np.float32))
        return out

    def save_custom_sound(self, data: dict, sound_id: int | None = None) -> int:
        with self._lock, self._conn:
            if sound_id is None:
                cur = self._conn.execute(
                    "INSERT INTO custom_sounds (name, icon, alert, created_at) VALUES (?, ?, ?, ?)",
                    (data["name"], data.get("icon") or "🔔", int(data.get("alert", False)), time.time()))
                return cur.lastrowid
            for field in ("name", "icon", "alert"):
                if data.get(field) is not None:
                    self._conn.execute(f"UPDATE custom_sounds SET {field} = ? WHERE id = ?",
                                       (int(data[field]) if field == "alert" else data[field], sound_id))
            return sound_id

    def delete_custom_sound(self, sound_id: int) -> bool:
        with self._lock, self._conn:
            return self._conn.execute("DELETE FROM custom_sounds WHERE id = ?", (sound_id,)).rowcount > 0

    def add_custom_examples(self, sound_id: int, embeddings: list[np.ndarray]) -> None:
        now = time.time()
        with self._lock, self._conn:
            self._conn.executemany(
                "INSERT INTO custom_examples (sound_id, embedding, created_at) VALUES (?, ?, ?)",
                [(sound_id, np.asarray(e, dtype=np.float32).tobytes(), now) for e in embeddings])

    def clear_custom_examples(self, sound_id: int) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM custom_examples WHERE sound_id = ?", (sound_id,))

    # --- профили за аномалии ----------------------------------------------------

    def anomaly_profiles(self, with_data: bool = False) -> list[dict]:
        cols = "*" if with_data else "id, name, created_at, seconds, threshold, level_p99"
        with self._lock:
            rows = [dict(r) for r in self._conn.execute(f"SELECT {cols} FROM anomaly_profiles ORDER BY created_at")]
        for r in rows:
            if with_data:
                r["embeddings"] = np.frombuffer(r["embeddings"], dtype=np.float32).reshape(-1, 1024)
        return rows

    def save_anomaly_profile(self, name: str, seconds: int, profile: dict) -> int:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO anomaly_profiles (name, created_at, seconds, threshold, level_p99, embeddings) VALUES (?, ?, ?, ?, ?, ?)",
                (name, time.time(), seconds, profile["threshold"], profile["level_p99"],
                 np.asarray(profile["embeddings"], dtype=np.float32).tobytes()))
            return cur.lastrowid

    def delete_anomaly_profile(self, profile_id: int) -> bool:
        with self._lock, self._conn:
            return self._conn.execute("DELETE FROM anomaly_profiles WHERE id = ?", (profile_id,)).rowcount > 0

    # --- клипове -------------------------------------------------------------------

    def add_clip(self, data: dict) -> int:
        fields = ("t", "session_id", "event_id", "reason", "label", "file", "seconds", "bytes")
        with self._lock, self._conn:
            cur = self._conn.execute(
                f"INSERT INTO clips ({', '.join(fields)}) VALUES ({', '.join('?' * len(fields))})",
                tuple(data.get(f) for f in fields))
            return cur.lastrowid

    def clips(self, limit: int = 100) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute("SELECT * FROM clips ORDER BY t DESC LIMIT ?", (limit,))]

    def clip(self, clip_id: int) -> dict | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM clips WHERE id = ?", (clip_id,)).fetchone()
        return dict(row) if row else None

    def delete_clip(self, clip_id: int) -> dict | None:
        clip = self.clip(clip_id)
        if clip:
            with self._lock, self._conn:
                self._conn.execute("DELETE FROM clips WHERE id = ?", (clip_id,))
        return clip

    def oldest_clips_over(self, max_bytes: int) -> list[dict]:
        """Клиповете, които трябва да се изтрият, за да се спазят max_bytes (най-старите първо)."""
        with self._lock:
            rows = [dict(r) for r in self._conn.execute("SELECT id, file, bytes FROM clips ORDER BY t DESC")]
        total, out = 0, []
        for r in rows:
            total += r["bytes"]
            if total > max_bytes:
                out.append(r)
        return out
